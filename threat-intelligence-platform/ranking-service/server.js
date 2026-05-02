require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3005;
const DATABASE_SERVICE_URL = process.env.DATABASE_SERVICE_URL || 'http://localhost:3006';

// ─── Known Malicious Indicators ───────────────────────────────────────────────

const HIGH_RISK_DOMAINS = ['malicious-domain.ru', 'evil-c2-server.com', 'phishing-site.net', 'malware-dropper.xyz', 'ransomware-c2.top', 'ransom-payment.onion.to'];
const HIGH_RISK_IPS = ['185.220.101.45', '5.188.86.172', '91.108.4.0'];
const MEDIUM_RISK_IPS = ['45.153.160.2', '103.21.244.0'];

// ─── Scoring Engine ───────────────────────────────────────────────────────────

function computeScore(ioc) {
  let score = 0;
  const val = ioc.value.toLowerCase();

  if (ioc.type === 'ip') {
    if (HIGH_RISK_IPS.includes(ioc.value)) {
      score = 85 + Math.floor(Math.random() * 15); // 85-100
    } else if (MEDIUM_RISK_IPS.includes(ioc.value)) {
      score = 40 + Math.floor(Math.random() * 30); // 40-70
    } else {
      // Heuristic scoring
      const octets = ioc.value.split('.').map(Number);
      if (octets[0] >= 185 && octets[0] <= 198) score += 40;
      if (octets[0] >= 91  && octets[0] <= 103) score += 30;
      score += Math.floor(Math.random() * 30);
    }
  } else if (ioc.type === 'domain') {
    if (HIGH_RISK_DOMAINS.includes(val)) {
      score = 80 + Math.floor(Math.random() * 20); // 80-100
    } else {
      // Heuristic: suspicious TLDs
      const suspiciousTLDs = ['.ru', '.cn', '.xyz', '.top', '.tk', '.ml', '.ga', '.cf'];
      if (suspiciousTLDs.some(tld => val.endsWith(tld))) score += 40;
      // Long domain names are suspicious
      if (val.length > 30) score += 20;
      // Hyphens can indicate DGA
      const hyphenCount = (val.match(/-/g) || []).length;
      if (hyphenCount > 3) score += 15;
      score += Math.floor(Math.random() * 25);
    }
  }

  return Math.min(100, Math.max(0, score));
}

function getRiskLevel(score) {
  if (score >= 70) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

// ─── Retry Helper ─────────────────────────────────────────────────────────────

async function postWithRetry(url, data, retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(url, data, { timeout: 10000 });
      return response.data;
    } catch (err) {
      console.error(`[ranking-service] Attempt ${attempt}/${retries} to ${url} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delay * attempt));
    }
  }
}

// ─── Controllers ─────────────────────────────────────────────────────────────

async function rankIOC(req, res) {
  const { ioc } = req.body;

  if (!ioc || !ioc.type || !ioc.value) {
    return res.status(400).json({ status: 'error', message: 'Invalid payload: ioc object with type and value required' });
  }

  try {
    const severity_score = computeScore(ioc);
    const risk_level = getRiskLevel(severity_score);

    const enrichedIOC = {
      type: ioc.type,
      value: ioc.value,
      severity_score,
      risk_level,
      rankedAt: new Date().toISOString()
    };

    console.log(`[ranking-service] Ranked ${ioc.type} ${ioc.value}: score=${severity_score}, risk=${risk_level}`);

    const result = await postWithRetry(`${DATABASE_SERVICE_URL}/store`, { ioc: enrichedIOC });

    return res.status(200).json({
      status: 'success',
      enriched: enrichedIOC,
      storageResult: result
    });
  } catch (err) {
    console.error('[ranking-service] Error:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

// Batch rank (optional direct call)
async function rankBatch(req, res) {
  const { iocs } = req.body;
  if (!Array.isArray(iocs)) {
    return res.status(400).json({ status: 'error', message: 'iocs array required' });
  }

  const results = [];
  for (const ioc of iocs) {
    const severity_score = computeScore(ioc);
    const risk_level = getRiskLevel(severity_score);
    results.push({ ...ioc, severity_score, risk_level });
  }

  return res.status(200).json({ status: 'success', results });
}

function healthCheck(req, res) {
  res.json({ status: 'ok', service: 'ranking-service', timestamp: new Date().toISOString() });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', healthCheck);
app.post('/rank', rankIOC);
app.post('/rank/batch', rankBatch);

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[ranking-service] Running on port ${PORT}`);
});
