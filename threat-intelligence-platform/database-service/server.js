require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3006;

// ─── MySQL Connection Pool ────────────────────────────────────────────────────

let pool;

async function createPool(retries = 15, delay = 5000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'tipuser',
        password: process.env.DB_PASSWORD || 'tippassword',
        database: process.env.DB_NAME || 'threat_intel',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });

      // Test connection
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      console.log('[database-service] MySQL connected successfully');
      return;
    } catch (err) {
      console.error(`[database-service] MySQL connect attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt < retries) {
        console.log(`[database-service] Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error('[database-service] Could not connect to MySQL after all attempts');
}

// ─── Ensure Table Exists ──────────────────────────────────────────────────────

async function ensureTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS iocs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      type VARCHAR(10) NOT NULL,
      value VARCHAR(255) NOT NULL UNIQUE,
      severity_score INT NOT NULL DEFAULT 0,
      risk_level VARCHAR(10) NOT NULL DEFAULT 'low',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_risk_level (risk_level),
      INDEX idx_type (type)
    )
  `);
  console.log('[database-service] Table iocs verified/created');
}

// ─── Controllers ─────────────────────────────────────────────────────────────

async function storeIOC(req, res) {
  const { ioc } = req.body;

  if (!ioc || !ioc.type || !ioc.value) {
    return res.status(400).json({ status: 'error', message: 'Invalid payload: ioc object required' });
  }

  try {
    const [rows] = await pool.execute(
      `INSERT INTO iocs (type, value, severity_score, risk_level)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         severity_score = VALUES(severity_score),
         risk_level = VALUES(risk_level)`,
      [ioc.type, ioc.value, ioc.severity_score || 0, ioc.risk_level || 'low']
    );

    const action = rows.affectedRows === 1 ? 'inserted' : 'updated';
    console.log(`[database-service] IOC ${action}: [${ioc.type}] ${ioc.value} (score=${ioc.severity_score}, risk=${ioc.risk_level})`);

    return res.status(200).json({
      status: 'success',
      action,
      ioc: { type: ioc.type, value: ioc.value, severity_score: ioc.severity_score, risk_level: ioc.risk_level }
    });
  } catch (err) {
    console.error('[database-service] Store error:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

async function getAllIOCs(req, res) {
  try {
    const [rows] = await pool.execute('SELECT * FROM iocs ORDER BY created_at DESC');
    return res.status(200).json({ status: 'success', count: rows.length, data: rows });
  } catch (err) {
    console.error('[database-service] Query error:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

async function getHighRiskIOCs(req, res) {
  try {
    const [rows] = await pool.execute("SELECT * FROM iocs WHERE risk_level = 'high' ORDER BY severity_score DESC");
    return res.status(200).json({ status: 'success', count: rows.length, data: rows });
  } catch (err) {
    console.error('[database-service] Query error:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

async function getIOCById(req, res) {
  const { id } = req.params;
  try {
    const [rows] = await pool.execute('SELECT * FROM iocs WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'IOC not found' });
    }
    return res.status(200).json({ status: 'success', data: rows[0] });
  } catch (err) {
    console.error('[database-service] Query error:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

async function getStats(req, res) {
  try {
    const [total] = await pool.execute('SELECT COUNT(*) as total FROM iocs');
    const [byRisk] = await pool.execute('SELECT risk_level, COUNT(*) as count FROM iocs GROUP BY risk_level');
    const [byType] = await pool.execute('SELECT type, COUNT(*) as count FROM iocs GROUP BY type');
    return res.status(200).json({
      status: 'success',
      total: total[0].total,
      byRiskLevel: byRisk,
      byType
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

function healthCheck(req, res) {
  res.json({ status: 'ok', service: 'database-service', timestamp: new Date().toISOString() });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', healthCheck);
app.post('/store', storeIOC);
app.get('/iocs', getAllIOCs);
app.get('/iocs/high', getHighRiskIOCs);
app.get('/iocs/stats', getStats);
app.get('/iocs/:id', getIOCById);

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  await createPool();
  await ensureTable();
  app.listen(PORT, () => {
    console.log(`[database-service] Running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('[database-service] Fatal startup error:', err.message);
  process.exit(1);
});
