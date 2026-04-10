# MeshEngine — Troubleshooting Guide

## Backend Issues

### Control Plane Won't Start

**Symptom:** `docker-compose up control_plane` exits immediately or loops.

**Checks:**
```bash
docker-compose logs control_plane
```

Common causes:
- `DATABASE_URL` wrong or PostgreSQL not ready → wait for health check
- `REDIS_URL` wrong or Redis not ready → check redis service
- Import error in new modules → check Python syntax in `app/api/oauth.py` or `app/api/lab.py`

**Fix:**
```bash
docker-compose up -d postgres redis
# Wait for health checks to pass
docker-compose up control_plane
```

---

### 500 Error on `/oauth/callback`

**Symptom:** POST to `/oauth/callback` returns 500 or 502.

**Checks:**
1. Provider client secret is set: `echo $OAUTH_GOOGLE_CLIENT_SECRET`
2. Redirect URI matches exactly what's in the provider app config
3. Authorization code has not expired (codes are single-use, ~60s TTL)

**Logs:**
```bash
docker-compose logs control_plane | grep oauth
# Look for: oauth_exchange_failed, oauth_unexpected_error
```

---

### OAuth URL Returns 503

**Symptom:** `GET /oauth/url/google` returns `503 Service Unavailable`.

**Cause:** `OAUTH_GOOGLE_CLIENT_ID` (or GitHub equivalent) is empty.

**Fix:** Add the client ID to your `.env` and restart the control plane.

---

### Lab Preset Deploy Fails

**Symptom:** POST to `/lab/presets/{name}/deploy` returns 500.

**Checks:**
```bash
docker-compose logs control_plane | grep lab_deploy_failed
```

Common cause: Database connection issue during network creation.

**Fix:** Ensure PostgreSQL is healthy and `DATABASE_URL` is correct.

---

### JWT Token Rejected (401)

**Symptom:** API calls return 401 after login.

**Checks:**
1. `JWT_SECRET` in backend `.env` matches what was used to sign the token
2. Token has not expired (`JWT_EXPIRY_SECONDS` default: 3600)
3. `localStorage.getItem('token')` returns a valid token in browser devtools

**Fix:** Log out, log back in. If persistent, check `JWT_SECRET` consistency across restarts.

---

### Rate Limit Errors (429)

**Symptom:** API returns 429 Too Many Requests.

**Cause:** Default rate limit is 10 requests/60 seconds per IP.

**Fix (dev):** Increase in `.env`:
```env
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_SECONDS=60
```

---

## Frontend Issues

### WebSocket Never Connects

**Symptom:** WS indicator stays gray/red. Observability shows `disconnected`.

**Checks:**
1. Backend is running: `curl http://localhost:8000/health`
2. `VITE_WS_URL` in `.env.local` matches backend URL
3. Browser console for WebSocket errors

**Common error:**
```
WebSocket connection to 'ws://localhost:8000/ws/simulation' failed
```

**Fix:** Ensure control plane is running and `VITE_WS_URL=ws://localhost:8000` in frontend `.env.local`.

---

### OAuth Callback Shows "Authorization Code Missing"

**Symptom:** After provider authorization, `/oauth/callback` shows an error.

**Cause:** Provider redirected without a `code` parameter — usually because the user denied authorization.

**Fix:** Try the OAuth flow again and click "Allow" or "Authorize".

---

### OAuth Callback Shows "Unknown OAuth Provider"

**Symptom:** After redirect, provider cannot be determined.

**Cause:** The `provider` parameter was not passed in the redirect URI or state.

**Fix:** The frontend `OAuthCallback.jsx` uses `_inferProvider()` as a fallback. Ensure the login page uses `getOAuthUrl()` from `api.js` which includes the provider in the URL construction. If the backend `/oauth/url/{provider}` endpoint is used, the state parameter is available.

**Workaround:** Append `?provider=google` or `?provider=github` manually to the callback URL for testing.

---

### Network Visualizer Shows Empty Graph

**Symptom:** Selecting a network shows nothing.

**Checks:**
1. The selected network ID is valid: `GET /network/state/{id}` returns nodes
2. The network has ≥2 nodes with coordinates
3. Browser console for API errors

**Fix:** Deploy a preset from Simulation Lab first, then select the new network in the visualizer.

---

### Simulation Returns "NO_ROUTE_AFTER_FAILURE"

**Symptom:** Simulation status is FAILED with reason `NO_ROUTE_AFTER_FAILURE`.

**Cause:** The failed nodes partitioned the network — no alternate path exists.

**This is expected behavior.** It demonstrates a correctly partitioned network.

**Resolution options:**
1. Choose different failure targets (not bridge nodes)
2. Use a denser network (more link redundancy)
3. Recover all failed nodes in **Failure Control**, then retry

---

### Simulation Lab Event Feed Is Empty

**Symptom:** Run simulation succeeds but live event feed shows nothing.

**Cause:** WebSocket is not connected when the simulation runs.

**Fix:** Check WS indicator at top of dashboard. Wait for connection (green pulse) before running. Events that occur before connection are not retransmitted.

---

## Database Issues

### `asyncpg.exceptions.InvalidCatalogNameError`

**Symptom:** Backend log shows database `meshengine` not found.

**Fix:**
```bash
docker-compose exec postgres psql -U meshuser -c "CREATE DATABASE meshengine;"
# Or restart postgres service — the healthcheck creates it automatically
docker-compose restart postgres
```

---

### Migration Errors After Upgrade

**Symptom:** New tables (`User`, `ActionHistory`) don't exist.

**Cause:** `create_tables()` in lifespan creates tables on boot but doesn't run migrations for existing databases.

**Fix:** The `create_tables()` call uses `checkfirst=True` via SQLAlchemy — it's safe to restart. If tables are missing, restart the control plane:
```bash
docker-compose restart control_plane
```

---

## Running Tests

```bash
cd control-plane
PYTHONPATH=. pytest tests/ -v --tb=short
```

All 26 tests are pure Python — no DB or Redis required. If tests fail:
- Check Python version: `python --version` (requires 3.11+)
- Check dependencies: `pip install -r requirements.txt`
- Run in the venv: `source venv/Scripts/activate` (Windows) or `source venv/bin/activate`

---

## Getting Detailed Logs

### Backend structured logs

```bash
# Tail all control plane logs
docker-compose logs -f control_plane

# Filter by event
docker-compose logs control_plane | grep "oauth\|lab\|route"
```

Log format is JSON-structured (structlog). Key fields:
- `event` — log event name (e.g., `route_computed`, `oauth_login_success`)
- `level` — INFO / WARNING / ERROR
- `timestamp` — ISO-8601

### Frontend console

Open browser DevTools → Console. Look for:
- `WebSocket` errors → connection issues
- Axios 4xx/5xx → API call failures
