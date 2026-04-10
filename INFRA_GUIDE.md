# MeshEngine — Infrastructure Guide

## Local Infrastructure (Docker Compose)

### Services

| Service | Port | Image | Purpose |
|---------|------|-------|---------|
| `postgres` | 5432 | postgres:15-alpine | Primary database |
| `redis` | 6379 | redis:7-alpine | Pub/Sub + rate limiting |
| `control_plane` | 8000 | custom (FastAPI) | API + WebSocket server |
| `node_worker` | — | custom | Event execution plane |
| `frontend` | 3000 | custom (nginx) | React SPA |

### Startup Order

PostgreSQL and Redis must be healthy before the control plane starts.
Docker Compose healthchecks enforce this:

```yaml
depends_on:
  postgres:
    condition: service_healthy
  redis:
    condition: service_healthy
```

### Volumes

- `postgres_data` — persistent volume for PostgreSQL data
- `./control-plane` mounted into `control_plane` container (live reload in dev)

---

## GCP Production Architecture

```
Internet
    │
    ▼
Cloud Load Balancer (HTTPS)
    ├──→ Cloud Run: meshengine-frontend  (static SPA via nginx)
    │
    └──→ Cloud Run: meshengine-backend   (FastAPI uvicorn)
              ├──→ Cloud SQL (PostgreSQL 15)
              └──→ Memorystore (Redis 7)
```

### Cloud Run Configuration

**Backend:**
```bash
gcloud run deploy meshengine-backend \
  --image gcr.io/PROJECT_ID/meshengine-backend:latest \
  --platform managed \
  --region us-central1 \
  --min-instances 1 \
  --max-instances 10 \
  --memory 512Mi \
  --cpu 1 \
  --allow-unauthenticated \
  --set-env-vars="LOG_LEVEL=INFO,RATE_LIMIT_REQUESTS=60" \
  --set-secrets="JWT_SECRET=jwt-secret:latest,DATABASE_URL=db-url:latest,REDIS_URL=redis-url:latest,OAUTH_GOOGLE_CLIENT_SECRET=google-oauth-secret:latest,OAUTH_GITHUB_CLIENT_SECRET=github-oauth-secret:latest"
```

**Frontend:**
```bash
gcloud run deploy meshengine-frontend \
  --image gcr.io/PROJECT_ID/meshengine-frontend:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

### Secret Manager Setup

```bash
# JWT secret
echo -n "your-64-char-random-secret" | \
  gcloud secrets create jwt-secret --data-file=-

# Google OAuth
echo -n "GOCSPX-..." | \
  gcloud secrets create google-oauth-secret --data-file=-

# GitHub OAuth
echo -n "your-github-secret" | \
  gcloud secrets create github-oauth-secret --data-file=-

# Database URL
echo -n "postgresql+asyncpg://user:pass@/meshengine?host=/cloudsql/PROJECT:REGION:INSTANCE" | \
  gcloud secrets create db-url --data-file=-
```

### Cloud SQL Setup

```bash
# Create PostgreSQL instance
gcloud sql instances create meshengine-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1

# Create database and user
gcloud sql databases create meshengine --instance=meshengine-db
gcloud sql users create meshuser --instance=meshengine-db --password=CHANGE_ME

# Connect Cloud Run to Cloud SQL via Cloud SQL Auth Proxy (automatic with --add-cloudsql-instances)
gcloud run services update meshengine-backend \
  --add-cloudsql-instances PROJECT_ID:us-central1:meshengine-db
```

### Memorystore (Redis) Setup

```bash
gcloud redis instances create meshengine-redis \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_7_0

# Get IP
gcloud redis instances describe meshengine-redis --region=us-central1 \
  --format="value(host)"
# Use this IP in REDIS_URL: redis://10.x.x.x:6379
```

> Memorystore is only accessible from VPC. Cloud Run must use Serverless VPC Access connector.

### Serverless VPC Connector

```bash
# Create connector
gcloud compute networks vpc-access connectors create meshengine-connector \
  --region=us-central1 \
  --network=default \
  --range=10.8.0.0/28

# Attach to Cloud Run
gcloud run services update meshengine-backend \
  --vpc-connector=meshengine-connector \
  --vpc-egress=private-ranges-only
```

---

## CI/CD (GitHub Actions)

Recommended pipeline `.github/workflows/deploy.yml`:

```yaml
name: Deploy MeshEngine

on:
  push:
    branches: [master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: {python-version: '3.11'}
      - run: pip install -r control-plane/requirements.txt
      - run: PYTHONPATH=control-plane pytest control-plane/tests/ -v

  build-deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      - uses: google-github-actions/setup-gcloud@v2
      - run: |
          gcloud builds submit --tag gcr.io/$GCP_PROJECT/meshengine-backend ./control-plane
          gcloud run deploy meshengine-backend --image gcr.io/$GCP_PROJECT/meshengine-backend --region us-central1
        env:
          GCP_PROJECT: ${{ secrets.GCP_PROJECT }}
```

---

## Monitoring

### Health Endpoint

```
GET /health
→ { "status": "healthy", "ws_clients": N, "version": "2.0.0" }
```

### Prometheus Metrics

```
GET /metrics
→ Prometheus text format
   meshengine_messages_total
   meshengine_reroutes_total
   meshengine_active_nodes
```

### Structured Logging

All backend logs are JSON-structured via structlog:
```json
{"event": "route_computed", "level": "info", "network_id": "...", "path": [...], "latency_ms": 45.2}
{"event": "oauth_login_success", "level": "info", "provider": "github", "user_id": "..."}
{"event": "lab_preset_deployed", "level": "info", "preset": "dense_grid", "network_id": "..."}
```

Ingest into Cloud Logging, Datadog, or any structured log platform.

---

## Scaling Notes

- **Control plane** is stateless per request (fresh DB graph per route). Scales horizontally.
- **WebSocket connections** are per-instance via ConnectionManager (not distributed). Use sticky sessions or switch to Redis-backed pub/sub fan-out for multi-instance WS.
- **Node workers** are independent Redis subscribers. Scale by adding replicas — each gets the same Redis events.
- **PostgreSQL** is the single source of truth. Use read replicas for metrics/analytics queries.
- **Redis** Pub/Sub does not persist — events lost on restart. This is acceptable for the event-driven animation use case.
