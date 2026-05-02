require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const PRODUCER_SERVICE_URL = process.env.PRODUCER_SERVICE_URL || 'http://localhost:3003';

// ─── Regex Patterns ───────────────────────────────────────────────────────────

const IP_REGEX = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

// ─── Extraction Logic ─────────────────────────────────────────────────────────

function extractFromAbuseIPDB(source) {
  const iocs = [];
  if (!source || !Array.isArray(source.data)) return iocs;

  for (const entry of source.data) {
    if (entry.ipAddress && IP_REGEX.test(entry.ipAddress)) {
      iocs.push({ type: 'ip', value: entry.ipAddress });
    }
    if (entry.domain && DOMAIN_REGEX.test(entry.domain)) {
      iocs.push({ type: 'domain', value: entry.domain });
    }
  }
  return iocs;
}

function extractFromAlienVaultOTX(source) {
  const iocs = [];
  if (!source || !source.data || !source.data.pulse_info) return iocs;

  const pulses = source.data.pulse_info.pulses || [];
  for (const pulse of pulses) {
    for (const indicator of pulse.indicators || []) {
      if (indicator.type === 'IPv4' && IP_REGEX.test(indicator.indicator)) {
        iocs.push({ type: 'ip', value: indicator.indicator });
      } else if (indicator.type === 'domain' && DOMAIN_REGEX.test(indicator.indicator)) {
        iocs.push({ type: 'domain', value: indicator.indicator });
      }
    }
  }
  return iocs;
}

// ─── Retry Helper ─────────────────────────────────────────────────────────────

async function postWithRetry(url, data, retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(url, data, { timeout: 10000 });
      return response.data;
    } catch (err) {
      console.error(`[extraction-service] Attempt ${attempt}/${retries} to ${url} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delay * attempt));
    }
  }
}

// ─── Controllers ─────────────────────────────────────────────────────────────

async function extractData(req, res) {
  console.log('[extraction-service] Received raw data, starting extraction...');

  try {
    const { sources } = req.body;
    if (!sources || !Array.isArray(sources)) {
      return res.status(400).json({ status: 'error', message: 'Invalid payload: sources array required' });
    }

    let allIocs = [];

    for (const source of sources) {
      if (source.source === 'AbuseIPDB') {
        const extracted = extractFromAbuseIPDB(source);
        console.log(`[extraction-service] Extracted ${extracted.length} IOCs from AbuseIPDB`);
        allIocs = allIocs.concat(extracted);
      } else if (source.source === 'AlienVaultOTX') {
        const extracted = extractFromAlienVaultOTX(source);
        console.log(`[extraction-service] Extracted ${extracted.length} IOCs from AlienVaultOTX`);
        allIocs = allIocs.concat(extracted);
      } else {
        console.warn(`[extraction-service] Unknown source: ${source.source}, skipping.`);
      }
    }

    console.log(`[extraction-service] Total IOCs extracted: ${allIocs.length}`);

    if (allIocs.length === 0) {
      return res.status(200).json({ status: 'success', message: 'No IOCs extracted', count: 0 });
    }

    console.log('[extraction-service] Forwarding to producer-service...');
    const result = await postWithRetry(`${PRODUCER_SERVICE_URL}/publish`, { iocs: allIocs });

    return res.status(200).json({
      status: 'success',
      extracted: allIocs.length,
      producerResult: result
    });
  } catch (err) {
    console.error('[extraction-service] Error:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

function healthCheck(req, res) {
  res.json({ status: 'ok', service: 'extraction-service', timestamp: new Date().toISOString() });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', healthCheck);
app.post('/extract', extractData);

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[extraction-service] Running on port ${PORT}`);
});
