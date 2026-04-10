# Changelog

All notable changes to MeshEngine are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.0.0] — 2026-04-10 — Interactive Distributed Systems Lab

### Added — Backend

#### OAuth 2.0 Authentication Extension
- `app/services/oauth_service.py` — Server-side OAuth code exchange for Google and GitHub
- `app/api/oauth.py` — Two new endpoints:
  - `GET /oauth/url/{provider}` — Returns authorization URL for frontend redirect
  - `POST /oauth/callback` — Exchanges code, upserts user, returns MeshEngine JWT
- `app/core/config.py` — Six new optional environment variables for OAuth configuration
- OAuth users are upserted into the existing `User` table without conflicting with password auth

#### Simulation Lab Presets API
- `app/api/lab.py` — Three new endpoints:
  - `GET /lab/presets` — List available preset scenarios
  - `GET /lab/presets/{name}` — Full preset specification
  - `POST /lab/presets/{name}/deploy` — Instantiate preset topology via existing `/network/create`
- Four built-in presets: `dense_grid`, `sparse_web`, `star_hub`, `mid_failure`
- Each preset includes: topology spec, recommended src/dst, failure injection targets, scenario narrative

### Added — Frontend

#### Shared WebSocket Infrastructure
- `src/hooks/useWebSocket.js` — Event-driven WS hook with:
  - Auto-reconnect with exponential backoff (cap 30s)
  - Rolling 200-event ring buffer
  - Type-specific and wildcard subscriber API (`subscribe(type, fn)`)
  - Graceful degradation — UI works if WS fails
- `src/hooks/useSimulation.js` — Simulation state management hook

#### Simulation Lab Tab
- `src/pages/dashboard/SimulationLab.jsx` — Full simulation control center:
  - One-click preset deployment
  - Custom network builder (grid / random layout)
  - MessageSender with source, destination, multi-node failure injection
  - Inline simulation result with path, latency, hops, reroute detection
  - Explainability layer showing routing engine decisions
  - Live event feed filtered to current simulation

#### Network Visualizer Tab
- `src/pages/dashboard/NetworkVisualizer.jsx` — Enhanced SVG graph:
  - Node visual states: ACTIVE (green), DOWN (red cross), HOP (blue glow), ROUTE (yellow)
  - Edge animation: marching dashes on active packet hop edges
  - Pulsing ring animation on hop nodes
  - Per-edge latency label during active hops
  - Network selector with refresh
  - 4s polling + instant WS event updates

#### Observability Tab
- `src/pages/dashboard/Observability.jsx` — Three panels:
  - **SystemStatusPanel**: Backend health, WS state, active node count, event rate
  - **EventTimeline**: Ordered, filterable event log with auto-scroll and pause
  - **RouteInsightsPanel**: Last route with path, latency, hop count + Dijkstra explainability

#### Failure Control Tab
- `src/pages/dashboard/FailureControl.jsx` — Failure injection UI:
  - Network-scoped node grid with per-node FAIL / RECOVER buttons
  - Quick actions: Fail Random, Recover All
  - Impact analysis: HEALTHY / IMPAIRED / DEGRADED / CRITICAL badge + Dijkstra impact explanation
  - Operation log
  - WS node event feed

#### OAuth Callback Page
- `src/pages/OAuthCallback.jsx` — Handles provider redirect at `/oauth/callback`
- `src/App.jsx` — Added `/oauth/callback` route (additive)
- `src/api.js` — Added: `getOAuthUrl`, `oauthCallback`, `getNetworkState`, `createNetwork`, `runSimulation`, `failNode`, `recoverNode`, `listPresets`, `getPreset`, `deployPreset`

### Modified (Integration Points Only)

| File | Change | Impact |
|------|--------|--------|
| `app/main.py` | +2 router includes (`oauth`, `lab`) | No existing routes affected |
| `app/core/config.py` | +6 optional OAuth fields | All have safe defaults; existing config unchanged |
| `frontend/src/App.jsx` | +1 route (`/oauth/callback`) | Existing routes untouched |
| `frontend/src/pages/Dashboard.jsx` | +4 tabs, shared WS hook | Existing 6 tabs called identically |
| `frontend/src/api.js` | +11 new export functions | Existing exports untouched |

### Backward Compatibility
- All existing API endpoints respond identically
- Password-based auth (`/auth/login`, `/auth/register`) unchanged
- Existing dashboard tabs (LiveViz, AllNodes, CreateNode, UpdateNode, DeleteNode, History) unchanged
- Existing WebSocket endpoints (`/ws/stream`, `/ws/simulation`) unchanged

---

## [1.1.0] — Platform UI & Auth Layer

### Added
- JWT + bcrypt authentication (`/auth/register`, `/auth/login`)
- Authenticated CRUD node management (`/nodes`)
- Action history (`/history`)
- Redis sliding-window rate limiter
- Vite + React 18 + Tailwind frontend
- Protected Dashboard with LiveViz, AllNodes, CreateNode, UpdateNode, DeleteNode, History tabs

---

## [1.0.0] — Core Simulation Engine

### Added
- FastAPI control plane with async SQLAlchemy + PostgreSQL
- Dijkstra shortest-path routing engine with failure awareness
- Redis Pub/Sub event backbone (3 channels)
- WebSocket streaming (`/ws/stream`, `/ws/simulation`)
- Network CRUD (`/network/create`, `/network/state`, `/network/list`)
- Node lifecycle (`/node/fail`, `/node/recover`)
- Message routing (`/message/send`)
- Simulation orchestration (`/simulation/start`) with self-healing
- Prometheus-compatible metrics (`/metrics`)
- Node worker execution plane
- 26 unit tests for Dijkstra + network logic
