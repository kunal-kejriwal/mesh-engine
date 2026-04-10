# MeshEngine — Deployment Guide

## Local Development

### Prerequisites

- Docker Desktop (for docker-compose)
- Node.js 18+ (for frontend dev server)
- Python 3.11+ (optional, for running tests locally)

### Quick Start

```bash
# 1. Clone and configure
git clone <repo>
cd MeshEngine
cp .env.example .env
# Edit .env with your values

# 2. Start backend services
docker-compose up -d postgres redis

# 3. Start control plane
docker-compose up -d control_plane

# 4. Start frontend (dev mode)
cd frontend
npm install
npm run dev
# Opens on http://localhost:3000
```

### Environment Variables

#### Backend (`.env`)

```env
# Database
DATABASE_URL=postgresql+asyncpg://meshuser:meshpass@localhost/meshengine

# Redis
REDIS_URL=redis://localhost:6379

# Logging
LOG_LEVEL=INFO

# Auth
JWT_SECRET=change-me-use-a-long-random-string-in-production
JWT_EXPIRY_SECONDS=3600

# Rate limiting
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_WINDOW_SECONDS=60

# OAuth — Google (optional, leave empty to disable)
OAUTH_GOOGLE_CLIENT_ID=
OAUTH_GOOGLE_CLIENT_SECRET=

# OAuth — GitHub (optional, leave empty to disable)
OAUTH_GITHUB_CLIENT_ID=
OAUTH_GITHUB_CLIENT_SECRET=

# OAuth redirect URI (must match provider app config)
OAUTH_REDIRECT_URI=http://localhost:3000/oauth/callback
```

#### Frontend (`.env.local`)

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

> For production, point these to your deployed backend URL.

---

## OAuth Provider Setup

### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Add Authorized redirect URIs: `https://yourdomain.com/oauth/callback`
4. Copy Client ID and Client Secret to `.env`:
   ```env
   OAUTH_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   OAUTH_GOOGLE_CLIENT_SECRET=GOCSPX-...
   OAUTH_REDIRECT_URI=https://yourdomain.com/oauth/callback
   ```

### GitHub OAuth

1. Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Set Authorization callback URL: `https://yourdomain.com/oauth/callback`
3. Copy Client ID and Client Secret to `.env`:
   ```env
   OAUTH_GITHUB_CLIENT_ID=Ov23li...
   OAUTH_GITHUB_CLIENT_SECRET=...
   ```

> Both providers use the same `OAUTH_REDIRECT_URI`. The frontend passes a `provider` parameter so the backend knows which exchange to perform.

---

## Full Docker Compose Deployment

```bash
docker-compose up --build
```

Services started:
- `postgres` on port 5432
- `redis` on port 6379
- `control_plane` on port 8000
- `node_worker` (internal)
- `frontend` on port 3000 (nginx)

### Production Docker Compose Overrides

Create `docker-compose.prod.yml`:

```yaml
version: '3.9'
services:
  control_plane:
    environment:
      - JWT_SECRET=${JWT_SECRET}
      - OAUTH_GOOGLE_CLIENT_ID=${OAUTH_GOOGLE_CLIENT_ID}
      - OAUTH_GOOGLE_CLIENT_SECRET=${OAUTH_GOOGLE_CLIENT_SECRET}
      - OAUTH_GITHUB_CLIENT_ID=${OAUTH_GITHUB_CLIENT_ID}
      - OAUTH_GITHUB_CLIENT_SECRET=${OAUTH_GITHUB_CLIENT_SECRET}
      - OAUTH_REDIRECT_URI=${OAUTH_REDIRECT_URI}
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

Run with:
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## GCP Cloud Run Deployment

See `infra/DEPLOY.md` for full GCP deployment instructions.

### Summary

1. Build and push Docker images to GCR:
   ```bash
   gcloud builds submit --tag gcr.io/PROJECT_ID/meshengine-backend ./control-plane
   gcloud builds submit --tag gcr.io/PROJECT_ID/meshengine-frontend ./frontend
   ```

2. Deploy control plane to Cloud Run with secrets via Secret Manager:
   ```bash
   gcloud run deploy meshengine-backend \
     --image gcr.io/PROJECT_ID/meshengine-backend \
     --set-env-vars="DATABASE_URL=..." \
     --set-secrets="JWT_SECRET=jwt-secret:latest,OAUTH_GOOGLE_CLIENT_SECRET=google-secret:latest"
   ```

3. Deploy frontend (static) to Cloud Run or Cloud Storage + CDN

4. Set `OAUTH_REDIRECT_URI` to your Cloud Run frontend URL

---

## Running Tests

```bash
# Backend unit tests (no DB/Redis required)
cd control-plane
PYTHONPATH=. pytest tests/ -v

# Expected: 26 tests, all passing
```

---

## Health Verification

After deployment, verify:

```bash
# Backend health
curl https://api.yourdomain.com/health
# Expected: {"status": "healthy", "service": "MeshEngine Control Plane", ...}

# OAuth URL generation
curl https://api.yourdomain.com/oauth/url/google
# Expected: {"url": "https://accounts.google.com/...", "provider": "google"}

# Lab presets
curl https://api.yourdomain.com/lab/presets
# Expected: list of 4 preset objects

# WebSocket (requires wscat)
wscat -c wss://api.yourdomain.com/ws/simulation
# Expected: {"event_type": "CONNECTED", ...}
```

---

## Security Checklist

- [ ] `JWT_SECRET` is a random 64+ character string (not the default)
- [ ] OAuth client secrets are in environment variables or Secret Manager, not code
- [ ] `OAUTH_REDIRECT_URI` matches exactly what's configured in provider apps
- [ ] CORS origins in `main.py` restricted to your frontend domain (currently `*` — change for prod)
- [ ] Rate limiting configured appropriately for your traffic
- [ ] PostgreSQL and Redis not exposed to public internet (internal network only)
- [ ] HTTPS enforced for all frontend and backend URLs
