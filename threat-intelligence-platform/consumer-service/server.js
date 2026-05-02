require('dotenv').config();
const express = require('express');
const { Kafka } = require('kafkajs');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3004;
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'ioc-topic';
const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID || 'ioc-consumer-group';
const RANKING_SERVICE_URL = process.env.RANKING_SERVICE_URL || 'http://localhost:3005';

// ─── Kafka Setup ──────────────────────────────────────────────────────────────

const kafka = new Kafka({
  clientId: 'consumer-service',
  brokers: [KAFKA_BROKER],
  retry: {
    initialRetryTime: 3000,
    retries: 10,
    factor: 2,
    maxRetryTime: 30000
  }
});

const consumer = kafka.consumer({ groupId: KAFKA_GROUP_ID });

// ─── Deduplication Cache ──────────────────────────────────────────────────────

const seenValues = new Set();

// ─── Validation ───────────────────────────────────────────────────────────────

const IP_REGEX = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^127\./,
  /^0\./
];

function isPrivateIP(ip) {
  return PRIVATE_IP_RANGES.some(r => r.test(ip));
}

function validateIOC(ioc) {
  if (!ioc || !ioc.type || !ioc.value) return false;

  if (ioc.type === 'ip') {
    if (!IP_REGEX.test(ioc.value)) return false;
    if (isPrivateIP(ioc.value)) {
      console.log(`[consumer-service] Skipping private IP: ${ioc.value}`);
      return false;
    }
    return true;
  }

  if (ioc.type === 'domain') {
    return DOMAIN_REGEX.test(ioc.value);
  }

  return false;
}

// ─── Retry Helper ─────────────────────────────────────────────────────────────

async function postWithRetry(url, data, retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(url, data, { timeout: 10000 });
      return response.data;
    } catch (err) {
      console.error(`[consumer-service] Attempt ${attempt}/${retries} to ${url} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delay * attempt));
    }
  }
}

// ─── Message Processor ────────────────────────────────────────────────────────

async function processMessage(message) {
  let ioc;
  try {
    ioc = JSON.parse(message.value.toString());
  } catch (err) {
    console.error('[consumer-service] Failed to parse message:', err.message);
    return;
  }

  // Deduplication
  if (seenValues.has(ioc.value)) {
    console.log(`[consumer-service] Duplicate IOC skipped: ${ioc.value}`);
    return;
  }

  // Validation
  if (!validateIOC(ioc)) {
    console.warn(`[consumer-service] Invalid IOC rejected: ${JSON.stringify(ioc)}`);
    return;
  }

  seenValues.add(ioc.value);
  console.log(`[consumer-service] Valid IOC accepted: [${ioc.type}] ${ioc.value}`);

  // Forward to ranking service
  try {
    const result = await postWithRetry(`${RANKING_SERVICE_URL}/rank`, { ioc });
    console.log(`[consumer-service] Ranking result for ${ioc.value}:`, result.status);
  } catch (err) {
    console.error(`[consumer-service] Failed to rank IOC ${ioc.value}:`, err.message);
  }
}

// ─── Kafka Consumer Start ─────────────────────────────────────────────────────

async function startConsumer() {
  let attempts = 0;
  const maxAttempts = 15;

  while (attempts < maxAttempts) {
    try {
      await consumer.connect();
      console.log('[consumer-service] Kafka consumer connected');

      await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: false });
      console.log(`[consumer-service] Subscribed to topic: ${KAFKA_TOPIC}`);

      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          console.log(`[consumer-service] Message received from ${topic}[${partition}]`);
          await processMessage(message);
        }
      });

      console.log('[consumer-service] Consumer is running and listening for messages...');
      return;
    } catch (err) {
      attempts++;
      console.error(`[consumer-service] Connect attempt ${attempts}/${maxAttempts} failed: ${err.message}`);
      if (attempts < maxAttempts) {
        const wait = Math.min(5000 * attempts, 30000);
        console.log(`[consumer-service] Retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  console.error('[consumer-service] Could not start Kafka consumer after all attempts');
}

// ─── HTTP Routes ──────────────────────────────────────────────────────────────

function healthCheck(req, res) {
  res.json({
    status: 'ok',
    service: 'consumer-service',
    seenIOCs: seenValues.size,
    timestamp: new Date().toISOString()
  });
}

app.get('/health', healthCheck);

app.get('/stats', (req, res) => {
  res.json({ deduplicatedCache: seenValues.size });
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  await startConsumer();
  app.listen(PORT, () => {
    console.log(`[consumer-service] HTTP server running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('[consumer-service] Fatal startup error:', err.message);
  process.exit(1);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

process.on('SIGTERM', async () => {
  console.log('[consumer-service] Shutting down...');
  await consumer.disconnect();
  process.exit(0);
});
