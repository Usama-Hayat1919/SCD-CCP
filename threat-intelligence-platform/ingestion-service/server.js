require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const EXTRACTION_SERVICE_URL = process.env.EXTRACTION_SERVICE_URL || 'http://localhost:3002';

// ─── Mock Threat Data Sources ────────────────────────────────────────────────

const mockAbuseIPDB = () => ({
  source: 'AbuseIPDB',
  timestamp: new Date().toISOString(),
  data: [
    { ipAddress: '185.220.101.45', abuseConfidenceScore: 98, countryCode: 'DE', usageType: 'Tor Exit Node', domain: 'torproject.org' },
    { ipAddress: '45.153.160.2',   abuseConfidenceScore: 95, countryCode: 'NL', usageType: 'VPN', domain: 'nordvpn.com' },
    { ipAddress: '192.168.1.1',    abuseConfidenceScore: 0,  countryCode: 'US', usageType: 'Private', domain: null },
    { ipAddress: '10.0.0.1',       abuseConfidenceScore: 0,  countryCode: 'US', usageType: 'Private', domain: null },
    { ipAddress: '103.21.244.0',   abuseConfidenceScore: 72, countryCode: 'CN', usageType: 'Data Center', domain: 'cloudflare.com' },
    { ipAddress: '198.51.100.23',  abuseConfidenceScore: 85, countryCode: 'RU', usageType: 'Unknown', domain: 'malicious-domain.ru' },
  ]
});

const mockAlienVaultOTX = () => ({
  source: 'AlienVaultOTX',
  timestamp: new Date().toISOString(),
  data: {
    pulse_info: {
      count: 2,
      pulses: [
        {
          name: 'Malware Campaign 2024',
          indicators: [
            { type: 'IPv4',  indicator: '91.108.4.0' },
            { type: 'domain', indicator: 'evil-c2-server.com' },
            { type: 'domain', indicator: 'phishing-site.net' },
            { type: 'IPv4',  indicator: '185.220.101.45' },
            { type: 'domain', indicator: 'malware-dropper.xyz' },
          ]
        },
        {
          name: 'Ransomware IOCs',
          indicators: [
            { type: 'IPv4',  indicator: '5.188.86.172' },
            { type: 'domain', indicator: 'ransom-payment.onion.to' },
            { type: 'IPv4',  indicator: '91.108.4.0' },
            { type: 'domain', indicator: 'ransomware-c2.top' },
          ]
        }
      ]
    }
  }
});

// ─── Retry Helper ─────────────────────────────────────────────────────────────

async function postWithRetry(url, data, retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(url, data, { timeout: 10000 });
      return response.data;
    } catch (err) {
      console.error(`[ingestion-service] Attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delay * attempt));
    }
  }
}

// ─── Controllers ─────────────────────────────────────────────────────────────

async function fetchAndIngest(req, res) {
  console.log('[ingestion-service] Starting threat data ingestion...');

  try {
    const abuseData = mockAbuseIPDB();
    console.log(`[ingestion-service] Fetched ${abuseData.data.length} records from AbuseIPDB`);

    const otxData = mockAlienVaultOTX();
    const otxCount = otxData.data.pulse_info.pulses.reduce((acc, p) => acc + p.indicators.length, 0);
    console.log(`[ingestion-service] Fetched ${otxCount} indicators from AlienVaultOTX`);

    const payload = {
      sources: [abuseData, otxData],
      ingestedAt: new Date().toISOString()
    };

    console.log('[ingestion-service] Forwarding to extraction-service...');
    const result = await postWithRetry(`${EXTRACTION_SERVICE_URL}/extract`, payload);
    console.log('[ingestion-service] Extraction service responded:', result);

    return res.status(200).json({
      status: 'success',
      message: 'Ingestion complete. Data forwarded to extraction-service.',
      summary: {
        abuseIPDB: abuseData.data.length,
        alienVaultOTX: otxCount
      },
      extractionResult: result
    });
  } catch (err) {
    console.error('[ingestion-service] Ingestion failed:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

function healthCheck(req, res) {
  res.json({ status: 'ok', service: 'ingestion-service', timestamp: new Date().toISOString() });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', healthCheck);
app.post('/ingest', fetchAndIngest);

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[ingestion-service] Running on port ${PORT}`);
});
