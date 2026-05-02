CREATE DATABASE IF NOT EXISTS threat_intel;
USE threat_intel;

CREATE TABLE IF NOT EXISTS iocs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(10) NOT NULL,
  value VARCHAR(255) NOT NULL UNIQUE,
  severity_score INT NOT NULL DEFAULT 0,
  risk_level VARCHAR(10) NOT NULL DEFAULT 'low',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_risk_level (risk_level),
  INDEX idx_type (type)
);
