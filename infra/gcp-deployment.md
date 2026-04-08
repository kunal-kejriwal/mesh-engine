# MeshEngine — GCP Production Deployment Plan

## Architecture on GCP

```
┌─────────────────────────────────────────────────────────────────┐
│  GCP Project: meshengine-prod                                   │
│                                                                 │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │  Cloud Run       │    │  Cloud Run       │                  │
│  │  control-plane   │───▶│  node-worker     │                  │
│  │  (min 1, max 10) │    │  (min 1, max 20) │                  │
│  └──────┬───────────┘    └──────┬───────────┘                  │
│         │                       │                               │
│         ▼                       ▼                               │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │  Cloud SQL       │    │  Memorystore     │                  │
│  │  PostgreSQL 15   │    │  Redis 7         │                  │
│  │  (HA, 2 vCPU)   │    │  (1GB, standard) │                  │
│  └──────────────────┘    └──────────────────┘                  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  VPC: meshengine-vpc  (private IP for DB + Redis)        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

```bash
gcloud auth login
gcloud config set project meshengine-prod
gcloud services enable \
  run.googleapis.com \
  sql-component.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  vpcaccess.googleapis.com \
  artifactregistry.googleapis.com
```

## Step 1: VPC & Serverless VPC Connector

```bash
# Create VPC
gcloud compute networks create meshengine-vpc --subnet-mode=auto

# Serverless VPC connector (Cloud Run → Cloud SQL / Redis)
gcloud compute networks vpc-access connectors create meshengine-connector \
  --network meshengine-vpc \
  --region us-central1 \
  --range 10.8.0.0/28
```

## Step 2: Cloud SQL (PostgreSQL)

```bash
gcloud sql instances create meshengine-db \
  --database-version=POSTGRES_15 \
  --tier=db-custom-2-4096 \
  --region=us-central1 \
  --network=meshengine-vpc \
  --no-assign-ip \
  --availability-type=REGIONAL \
  --backup-start-time=03:00

gcloud sql databases create meshengine \
  --instance=meshengine-db

gcloud sql users create meshuser \
  --instance=meshengine-db \
  --password=CHANGE_ME_IN_PROD
```

## Step 3: Memorystore (Redis)

```bash
gcloud redis instances create meshengine-redis \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_7_0 \
  --network=projects/meshengine-prod/global/networks/meshengine-vpc \
  --tier=STANDARD_HA

# Get Redis host
REDIS_HOST=$(gcloud redis instances describe meshengine-redis \
  --region=us-central1 --format='value(host)')
```

## Step 4: Artifact Registry & Container Build

```bash
gcloud artifacts repositories create meshengine \
  --repository-format=docker \
  --location=us-central1

# Build and push control-plane
gcloud builds submit ./control-plane \
  --tag us-central1-docker.pkg.dev/meshengine-prod/meshengine/control-plane:latest

# Build and push node-worker
gcloud builds submit ./node-worker \
  --tag us-central1-docker.pkg.dev/meshengine-prod/meshengine/node-worker:latest
```

## Step 5: Deploy Control Plane (Cloud Run)

```bash
DB_HOST=$(gcloud sql instances describe meshengine-db \
  --format='value(ipAddresses[0].ipAddress)')

gcloud run deploy control-plane \
  --image us-central1-docker.pkg.dev/meshengine-prod/meshengine/control-plane:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 10 \
  --memory 512Mi \
  --cpu 1 \
  --port 8000 \
  --vpc-connector meshengine-connector \
  --vpc-egress all-traffic \
  --set-env-vars \
    DATABASE_URL="postgresql+asyncpg://meshuser:CHANGE_ME_IN_PROD@${DB_HOST}/meshengine",\
    REDIS_URL="redis://${REDIS_HOST}:6379",\
    LOG_LEVEL=INFO
```

## Step 6: Deploy Node Worker (Cloud Run)

```bash
gcloud run deploy node-worker \
  --image us-central1-docker.pkg.dev/meshengine-prod/meshengine/node-worker:latest \
  --region us-central1 \
  --platform managed \
  --no-allow-unauthenticated \
  --min-instances 1 \
  --max-instances 20 \
  --memory 256Mi \
  --cpu 1 \
  --vpc-connector meshengine-connector \
  --vpc-egress all-traffic \
  --set-env-vars \
    REDIS_URL="redis://${REDIS_HOST}:6379",\
    WORKER_ID=worker-gcp-1,\
    LOG_LEVEL=INFO
```

## Step 7: Cloud Monitoring

```bash
# Uptime check for control-plane health endpoint
gcloud monitoring uptime-checks create http meshengine-health \
  --display-name="MeshEngine Health" \
  --uri="$(gcloud run services describe control-plane \
    --region us-central1 --format='value(status.url)')/health"
```

## Environment Variables Reference

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | Async PostgreSQL DSN | `postgresql+asyncpg://user:pass@host/db` |
| `REDIS_URL` | Redis connection string | `redis://host:6379` |
| `LOG_LEVEL` | Logging verbosity | `INFO` |
| `DEFAULT_LINK_THRESHOLD` | Auto-link distance threshold | `150.0` |
| `LATENCY_DISTANCE_FACTOR` | ms per distance unit | `0.5` |
| `WORKER_ID` | Unique worker identifier | `worker-gcp-1` |

## Cost Estimate (Monthly)

| Resource | Spec | ~Cost/month |
|---|---|---|
| Cloud Run (control-plane) | 1 CPU, 512MB, min-1 | ~$20 |
| Cloud Run (node-worker) | 1 CPU, 256MB, min-1 | ~$15 |
| Cloud SQL PostgreSQL | db-custom-2-4096, HA | ~$130 |
| Memorystore Redis | 1GB, Standard | ~$50 |
| VPC / Networking | Egress + connector | ~$10 |
| **Total** | | **~$225/month** |
