require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DATABASE_SERVICE_URL = process.env.DATABASE_SERVICE_URL || 'http://localhost:3006';

// ─── Proxy Helper ─────────────────────────────────────────────────────────────

async function proxyGet(url, res) {
  try {
    const response = await axios.get(url, { timeout: 10000 });
    return res.status(200).json(response.data);
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    console.error(`[api-gateway] Upstream error: ${err.message}`);
    return res.status(502).json({ status: 'error', message: 'Upstream service unavailable', details: err.message });
  }
}

// ─── Controllers ─────────────────────────────────────────────────────────────

async function getAllIOCs(req, res) {
  console.log('[api-gateway] GET /iocs');
  await proxyGet(`${DATABASE_SERVICE_URL}/iocs`, res);
}

async function getHighRiskIOCs(req, res) {
  console.log('[api-gateway] GET /iocs/high');
  await proxyGet(`${DATABASE_SERVICE_URL}/iocs/high`, res);
}

async function getIOCById(req, res) {
  const { id } = req.params;
  console.log(`[api-gateway] GET /iocs/${id}`);
  await proxyGet(`${DATABASE_SERVICE_URL}/iocs/${id}`, res);
}

async function getStats(req, res) {
  console.log('[api-gateway] GET /stats');
  await proxyGet(`${DATABASE_SERVICE_URL}/iocs/stats`, res);
}

function healthCheck(req, res) {
  res.json({
    status: 'ok',
    service: 'api-gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      'GET /iocs': 'List all IOCs',
      'GET /iocs/high': 'High-risk IOCs only',
      'GET /iocs/:id': 'Get IOC by ID',
      'GET /stats': 'Aggregated statistics',
      'GET /health': 'Service health'
    }
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', healthCheck);
app.get('/stats', getStats);
app.get('/iocs/high', getHighRiskIOCs);   // Must come before /iocs/:id
app.get('/iocs/:id', getIOCById);
app.get('/iocs', getAllIOCs);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: `Route ${req.method} ${req.path} not found` });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[api-gateway] Running on port ${PORT}`);
  console.log(`[api-gateway] Proxying to database-service at ${DATABASE_SERVICE_URL}`);
});
