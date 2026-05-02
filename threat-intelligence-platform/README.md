# 🛡️ Threat Intelligence Platform (TIP)

A distributed microservices system that ingests, processes, enriches, and stores cybersecurity threat intelligence data using Node.js, Apache Kafka, MySQL, and Docker.

---

## 📐 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        THREAT INTELLIGENCE PLATFORM                             │
│                                                                                 │
│   ┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐              │
│   │  AbuseIPDB   │    │  AlienVault OTX  │    │  (Future APIs)  │              │
│   │   (Mock)     │    │     (Mock)       │    │                 │              │
│   └──────┬───────┘    └────────┬─────────┘    └────────┬────────┘              │
│          │                     │                        │                       │
│          └─────────────────────┼────────────────────────┘                       │
│                                ▼                                                 │
│                   ┌────────────────────────┐                                    │
│                   │   ingestion-service    │  :3001                             │
│                   │  Fetches raw threat    │                                    │
│                   │  data from APIs        │                                    │
│                   └────────────┬───────────┘                                    │
│                                │ POST /extract                                  │
│                                ▼                                                 │
│                   ┌────────────────────────┐                                    │
│                   │  extraction-service    │  :3002                             │
│                   │  Parses JSON, extracts │                                    │
│                   │  IPs and Domains       │                                    │
│                   └────────────┬───────────┘                                    │
│                                │ POST /publish                                  │
│                                ▼                                                 │
│                   ┌────────────────────────┐                                    │
│                   │   producer-service     │  :3003                             │
│                   │  Publishes IOCs to     │                                    │
│                   │  Kafka topic           │                                    │
│                   └────────────┬───────────┘                                    │
│                                │                                                 │
│                    ┌───────────▼──────────┐                                     │
│                    │  Apache Kafka :9092   │                                     │
│                    │  Topic: ioc-topic     │                                     │
│                    └───────────┬──────────┘                                     │
│                                │                                                 │
│                                ▼                                                 │
│                   ┌────────────────────────┐                                    │
│                   │   consumer-service     │  :3004                             │
│                   │  Validates & dedupes   │                                    │
│                   │  IOCs from Kafka       │                                    │
│                   └────────────┬───────────┘                                    │
│                                │ POST /rank                                      │
│                                ▼                                                 │
│                   ┌────────────────────────┐                                    │
│                   │   ranking-service      │  :3005                             │
│                   │  Scores IOCs 0-100     │                                    │
│                   │  Assigns risk level    │                                    │
│                   └────────────┬───────────┘                                    │
│                                │ POST /store                                     │
│                                ▼                                                 │
│                   ┌────────────────────────┐                                    │
│                   │  database-service      │  :3006                             │
│                   │  Persists to MySQL     │                                    │
│                   └────────────┬───────────┘                                    │
│                                │                                                 │
│                    ┌───────────▼──────────┐                                     │
│                    │    MySQL :3306        │                                     │
│                    │    Table: iocs        │                                     │
│                    └───────────┬──────────┘                                     │
│                                │                                                 │
│                   ┌────────────▼───────────┐                                    │
│                   │     api-gateway        │  :3000  ◄── External Clients       │
│                   │  GET /iocs             │                                    │
│                   │  GET /iocs/high        │                                    │
│                   │  GET /iocs/:id         │                                    │
│                   └────────────────────────┘                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
threat-intelligence-platform/
├── docker-compose.yml
├── init.sql
├── README.md
├── ingestion-service/
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
├── extraction-service/
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
├── producer-service/
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
├── consumer-service/
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
├── ranking-service/
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
├── database-service/
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
└── api-gateway/
    ├── server.js
    ├── package.json
    └── Dockerfile
```

---

## 🔄 Data Flow Explanation

1. **Trigger**: Client POSTs to `ingestion-service /ingest`
2. **Ingestion**: Service fetches mock threat data from AbuseIPDB and AlienVault OTX
3. **Extraction**: Raw JSON is parsed; IPs and domain names are extracted using regex
4. **Production**: Extracted IOCs are published as messages to Kafka topic `ioc-topic`
5. **Consumption**: Consumer reads from Kafka, deduplicates and validates each IOC (removes private IPs, malformed entries)
6. **Ranking**: Valid IOCs are scored 0–100 and categorized as low/medium/high risk
7. **Storage**: Enriched IOCs are upserted into MySQL `iocs` table
8. **Query**: API Gateway exposes REST endpoints for downstream consumers

---

## 🚀 Setup & Run Instructions

### Prerequisites
- Docker 20.10+
- Docker Compose v2+

### Step 1 – Start the platform

```bash
docker-compose up --build
```

Wait ~60 seconds for Kafka and MySQL to be fully ready. Watch logs for:
```
[producer-service] Kafka producer connected successfully
[consumer-service] Kafka consumer connected
[database-service] MySQL connected successfully
```

### Step 2 – Trigger the ingestion pipeline

```bash
curl -X POST http://localhost:3001/ingest
```

### Step 3 – Query results

```bash
# All IOCs
curl http://localhost:3000/iocs

# High risk only
curl http://localhost:3000/iocs/high

# By ID
curl http://localhost:3000/iocs/1

# Stats
curl http://localhost:3000/stats
```

---

## 🧪 Testing Instructions

### Run full pipeline test

```bash
# 1. Start services
docker-compose up --build -d

# 2. Wait for readiness (check health endpoints)
curl http://localhost:3001/health
curl http://localhost:3003/health
curl http://localhost:3006/health

# 3. Trigger ingestion
curl -X POST http://localhost:3001/ingest

# 4. Wait ~3 seconds for Kafka pipeline to complete

# 5. Query results
curl http://localhost:3000/iocs | python3 -m json.tool
curl http://localhost:3000/iocs/high | python3 -m json.tool
curl http://localhost:3000/stats | python3 -m json.tool
```

### Sample Expected Output (`GET /iocs/high`)

```json
{
  "status": "success",
  "count": 4,
  "data": [
    {
      "id": 1,
      "type": "ip",
      "value": "185.220.101.45",
      "severity_score": 96,
      "risk_level": "high",
      "created_at": "2024-01-15T12:00:00.000Z"
    },
    {
      "id": 2,
      "type": "domain",
      "value": "evil-c2-server.com",
      "severity_score": 88,
      "risk_level": "high",
      "created_at": "2024-01-15T12:00:01.000Z"
    }
  ]
}
```

### Sample Test JSON (direct extraction-service call)

```bash
curl -X POST http://localhost:3002/extract \
  -H "Content-Type: application/json" \
  -d '{
    "sources": [
      {
        "source": "AbuseIPDB",
        "data": [
          {"ipAddress": "91.108.4.0", "domain": "malicious-test.ru"},
          {"ipAddress": "10.0.0.1", "domain": null}
        ]
      }
    ]
  }'
```

---

## 📡 API Documentation

### API Gateway (port 3000)

| Method | Endpoint      | Description             |
|--------|---------------|-------------------------|
| GET    | /health       | Service health check    |
| GET    | /iocs         | List all IOCs           |
| GET    | /iocs/high    | High-risk IOCs only     |
| GET    | /iocs/:id     | Get IOC by ID           |
| GET    | /stats        | Aggregated stats        |

### Ingestion Service (port 3001)

| Method | Endpoint  | Description                  |
|--------|-----------|------------------------------|
| POST   | /ingest   | Trigger full pipeline        |
| GET    | /health   | Health check                 |

### Individual Service Health Checks

| Service           | Port | Health URL                        |
|-------------------|------|-----------------------------------|
| api-gateway       | 3000 | http://localhost:3000/health      |
| ingestion-service | 3001 | http://localhost:3001/health      |
| extraction-service| 3002 | http://localhost:3002/health      |
| producer-service  | 3003 | http://localhost:3003/health      |
| consumer-service  | 3004 | http://localhost:3004/health      |
| ranking-service   | 3005 | http://localhost:3005/health      |
| database-service  | 3006 | http://localhost:3006/health      |

---

## 🗄️ MySQL Schema

```sql
CREATE TABLE iocs (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  type           VARCHAR(10)  NOT NULL,          -- 'ip' or 'domain'
  value          VARCHAR(255) NOT NULL UNIQUE,   -- The actual IOC value
  severity_score INT          NOT NULL DEFAULT 0, -- 0-100
  risk_level     VARCHAR(10)  NOT NULL DEFAULT 'low', -- low/medium/high
  created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
```

---

## ⚙️ Environment Variables

Each service reads from environment variables set in `docker-compose.yml`:

| Variable               | Service           | Default                    |
|------------------------|-------------------|----------------------------|
| PORT                   | All               | Varies per service         |
| EXTRACTION_SERVICE_URL | ingestion         | http://extraction-service:3002 |
| PRODUCER_SERVICE_URL   | extraction        | http://producer-service:3003   |
| KAFKA_BROKER           | producer/consumer | kafka:9092                 |
| KAFKA_TOPIC            | producer/consumer | ioc-topic                  |
| KAFKA_GROUP_ID         | consumer          | ioc-consumer-group         |
| RANKING_SERVICE_URL    | consumer          | http://ranking-service:3005    |
| DATABASE_SERVICE_URL   | ranking/gateway   | http://database-service:3006   |
| DB_HOST                | database          | mysql                      |
| DB_USER                | database          | tipuser                    |
| DB_PASSWORD            | database          | tippassword                |
| DB_NAME                | database          | threat_intel               |

---

## 🛑 Stopping the Platform

```bash
docker-compose down

# Remove volumes too (clears MySQL data)
docker-compose down -v
```

---

## 🔧 Troubleshooting

**Kafka consumer not receiving messages**
→ Check that `producer-service` logs show "Kafka producer connected"
→ Ensure `consumer-service` logs show "Subscribed to topic: ioc-topic"

**MySQL connection refused**
→ Wait longer; MySQL takes ~30s to initialize
→ Check `docker-compose logs mysql`

**Services restart looping**
→ Normal during startup; services retry until dependencies are ready
→ All services implement exponential backoff retry logic
