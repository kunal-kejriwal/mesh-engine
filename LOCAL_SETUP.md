# MeshEngine — Local Setup Guide

> FastAPI + PostgreSQL + Redis + Docker — distributed mesh network simulation platform.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start (Docker — recommended)](#quick-start-docker)
3. [Manual Setup (no Docker)](#manual-setup-no-docker)
4. [Environment Variables](#environment-variables)
5. [Service Details](#service-details)
6. [Verification Checklist](#verification-checklist)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Docker Desktop | 24+ | https://docs.docker.com/get-docker/ |
| Docker Compose | v2 (bundled with Docker Desktop) | — |
| Python | 3.11 | https://python.org/downloads/ |
| `curl` | any | pre-installed on Linux/macOS; Git Bash on Windows |
| `jq` | any | `brew install jq` / `apt install jq` / https://jqlang.github.io/jq/ | `winget install jqlang.jq`

> **Windows users:** all shell commands below are written for bash. Use Git Bash or WSL2 — do NOT use PowerShell or CMD.

---

## Quick Start (Docker)

This is the recommended path. One command brings up all four services.

```bash
# Clone / enter the project
cd /path/to/MeshEngine

# Copy env template
cp .env.example .env          # values are already correct for Docker networking

# Build and start all services (postgres, redis, control_plane, node_worker)
docker compose up --build

# In a second terminal — confirm everything is healthy
docker compose ps
```

Expected output from `docker compose ps`:

```
NAME              STATUS         PORTS
meshengine-postgres-1        healthy        0.0.0.0:5432->5432/tcp
meshengine-redis-1           healthy        0.0.0.0:6379->6379/tcp
meshengine-control_plane-1   running        0.0.0.0:8000->8000/tcp
meshengine-node_worker-1     running
```

Once running:

| Endpoint | URL |
|----------|-----|
| REST API | http://localhost:8000 |
| Interactive docs (Swagger) | http://localhost:8000/docs |
| ReDoc | http://localhost:8000/redoc |
| Health check | http://localhost:8000/health |
| Live dashboard | http://localhost:8000/dashboard |
| WebSocket stream | ws://localhost:8000/ws/stream |
| WebSocket simulation | ws://localhost:8000/ws/simulation |

**Stop everything:**

```bash
docker compose down            # stop containers, keep volumes
docker compose down -v         # stop containers AND wipe the postgres volume
```

---

## Manual Setup (no Docker)

Use this if you want to run services on the host for faster iteration (hot-reload without container rebuild).

### Step 1 — Install PostgreSQL 15

**macOS:**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Ubuntu/Debian:**
```bash
sudo apt update && sudo apt install -y postgresql-15
sudo systemctl start postgresql
```

**Create the database and user:**
```bash
psql -U postgres -c "CREATE USER meshuser WITH PASSWORD 'meshpass';"
psql -U postgres -c "CREATE DATABASE meshengine OWNER meshuser;"
```

### Step 2 — Install Redis 7

**macOS:**
```bash
brew install redis
brew services start redis
```

**Ubuntu/Debian:**
```bash
sudo apt install -y redis-server
sudo systemctl start redis-server
```

**Verify:**
```bash
redis-cli ping          # → PONG
```

### Step 3 — Python virtual environment (control-plane)

```bash
cd control-plane
python3.11 -m venv .venv
source .venv/bin/activate       # Windows Git Bash: source .venv/Scripts/activate

pip install --upgrade pip
pip install -r requirements.txt
```

### Step 4 — Python virtual environment (node-worker)

```bash
cd ../node-worker
python3.11 -m venv .venv
source .venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt
```

### Step 5 — Environment file

```bash
cd ..                           # back to project root
cp .env.example .env
```

The default values in `.env.example` are already correct for a local (non-Docker) setup:

```
DATABASE_URL=postgresql+asyncpg://meshuser:meshpass@localhost/meshengine
REDIS_URL=redis://localhost:6379
LOG_LEVEL=INFO
DEFAULT_LINK_THRESHOLD=150.0
```

### Step 6 — Run the control plane

The app auto-creates all database tables on startup (SQLAlchemy `create_all`). No manual migration step required.

```bash
cd control-plane
source .venv/bin/activate
PYTHONPATH=. uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Expected startup log lines:
```
[info] database tables created
[info] redis connection pool ready
[info] connection manager initialised
[info] Application startup complete.
```

### Step 7 — Run the node worker

Open a new terminal:

```bash
cd node-worker
source .venv/bin/activate
PYTHONPATH=. REDIS_URL=redis://localhost:6379 CONTROL_PLANE_URL=http://localhost:8000 WORKER_ID=worker-local python -m worker.main
```

---

## Environment Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://meshuser:meshpass@localhost/meshengine` | Yes | asyncpg connection string |
| `REDIS_URL` | `redis://localhost:6379` | Yes | Redis connection URL |
| `LOG_LEVEL` | `INFO` | No | `DEBUG` / `INFO` / `WARNING` |
| `DEFAULT_LINK_THRESHOLD` | `150.0` | No | Auto-link Euclidean distance threshold |
| `LATENCY_DISTANCE_FACTOR` | `0.5` | No | ms-per-distance-unit edge weight multiplier |

**Node worker additional variables (set via docker-compose env or shell):**

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTROL_PLANE_URL` | `http://control_plane:8000` | Control plane base URL |
| `WORKER_ID` | `worker-1` | Unique worker identifier shown in logs |

> **Never commit `.env` to Git.** The `.env.example` file is the safe template.

---

## Service Details

### PostgreSQL

- Port: `5432`
- DB: `meshengine`
- User/pass: `meshuser` / `meshpass`
- Tables are auto-created by SQLAlchemy on first startup — no `alembic` migrations needed for development.

### Redis

- Port: `6379`
- Used for: Pub/Sub event fan-out, atomic metrics counters
- Channels: `mesh:message:flow`, `mesh:node:events`, `mesh:simulation:events`
- Metric keys: `mesh:metrics:global:*`, `mesh:metrics:net:{id}:*`

### Control Plane (FastAPI/uvicorn)

- Port: `8000`
- Auto-reload enabled in docker-compose (`--reload` flag)
- PYTHONPATH set to `/app` inside container

### Node Worker

- No inbound port
- Subscribes to all Redis channels
- Logs structured JSON to stdout
- Restarts on failure (`restart: on-failure` in docker-compose)

---

## Verification Checklist

Run these after startup to confirm every layer is healthy:

```bash
# 1. Health check
curl -s http://localhost:8000/health | jq .
# Expected: {"status":"ok","database":"connected","redis":"connected"}

# 2. Swagger UI
open http://localhost:8000/docs          # macOS
xdg-open http://localhost:8000/docs      # Linux

# 3. Redis connectivity
redis-cli ping                           # PONG

# 4. PostgreSQL connectivity
psql postgresql://meshuser:meshpass@localhost/meshengine -c "\dt"
# Lists: links, messages, networks, nodes

# 5. Worker subscription (check worker container logs)
docker compose logs node_worker --tail 20
# Expected lines include: "subscribed channels" with mesh:* channels listed
```

---

## Troubleshooting

### `connection refused` on port 5432 / 6379

```bash
# Check if containers are running
docker compose ps

# Check if host services are running (manual setup)
pg_isready -h localhost -U meshuser
redis-cli ping
```

### `FATAL: database "meshengine" does not exist`

```bash
psql -U postgres -c "CREATE DATABASE meshengine OWNER meshuser;"
# OR wipe the Docker volume and restart:
docker compose down -v && docker compose up --build
```

### `ModuleNotFoundError` when running locally

```bash
# Ensure PYTHONPATH is set
PYTHONPATH=. uvicorn app.main:app ...
# Or activate the venv first
source .venv/bin/activate
```

### Port 8000 already in use

```bash
# Find and kill the process using port 8000
lsof -ti:8000 | xargs kill -9      # macOS/Linux
# Then restart
```

### `asyncpg.exceptions.InvalidPasswordError`

Verify `.env` credentials match what was used when creating the PostgreSQL user. The `.env.example` defaults are `meshuser` / `meshpass`.

### Docker build fails (pip install errors)

```bash
# Force a clean rebuild without cache
docker compose build --no-cache
docker compose up
```

### Node worker exits immediately

```bash
docker compose logs node_worker
# Most common cause: Redis not yet healthy when worker started
# Fix: wait a few seconds and docker compose restart node_worker
```
