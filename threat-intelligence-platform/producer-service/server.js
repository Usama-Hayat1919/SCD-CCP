require('dotenv').config();
const express = require('express');
const { Kafka, Partitioners } = require('kafkajs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3003;
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'ioc-topic';

// ─── Kafka Setup ──────────────────────────────────────────────────────────────

const kafka = new Kafka({
  clientId: 'producer-service',
  brokers: [KAFKA_BROKER],
  retry: {
    initialRetryTime: 3000,
    retries: 10,
    factor: 2,
    maxRetryTime: 30000
  }
});

const producer = kafka.producer({
  createPartitioner: Partitioners.LegacyPartitioner
});

let producerReady = false;

async function connectProducer() {
  let attempts = 0;
  const maxAttempts = 15;

  while (attempts < maxAttempts) {
    try {
      await producer.connect();
      producerReady = true;
      console.log('[producer-service] Kafka producer connected successfully');
      return;
    } catch (err) {
      attempts++;
      console.error(`[producer-service] Kafka connect attempt ${attempts}/${maxAttempts} failed: ${err.message}`);
      if (attempts < maxAttempts) {
        const wait = Math.min(5000 * attempts, 30000);
        console.log(`[producer-service] Retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  console.error('[producer-service] Failed to connect to Kafka after all attempts');
}

// ─── Kafka Error Handling ─────────────────────────────────────────────────────

producer.on('producer.disconnect', async () => {
  console.warn('[producer-service] Kafka producer disconnected. Reconnecting...');
  producerReady = false;
  await connectProducer();
});

// ─── Controllers ─────────────────────────────────────────────────────────────

async function publishIOCs(req, res) {
  const { iocs } = req.body;

  if (!iocs || !Array.isArray(iocs) || iocs.length === 0) {
    return res.status(400).json({ status: 'error', message: 'Invalid payload: iocs array required' });
  }

  if (!producerReady) {
    return res.status(503).json({ status: 'error', message: 'Kafka producer not ready' });
  }

  try {
    const messages = iocs.map(ioc => ({
      key: ioc.value,
      value: JSON.stringify({
        ...ioc,
        publishedAt: new Date().toISOString()
      })
    }));

    await producer.send({
      topic: KAFKA_TOPIC,
      messages
    });

    console.log(`[producer-service] Published ${messages.length} IOCs to topic '${KAFKA_TOPIC}'`);

    return res.status(200).json({
      status: 'success',
      published: messages.length,
      topic: KAFKA_TOPIC
    });
  } catch (err) {
    console.error('[producer-service] Failed to publish messages:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

function healthCheck(req, res) {
  res.json({
    status: 'ok',
    service: 'producer-service',
    kafkaReady: producerReady,
    timestamp: new Date().toISOString()
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', healthCheck);
app.post('/publish', publishIOCs);

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  await connectProducer();
  app.listen(PORT, () => {
    console.log(`[producer-service] Running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('[producer-service] Fatal startup error:', err.message);
  process.exit(1);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

process.on('SIGTERM', async () => {
  console.log('[producer-service] Shutting down...');
  await producer.disconnect();
  process.exit(0);
});
