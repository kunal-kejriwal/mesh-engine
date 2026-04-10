# MeshEngine — API Documentation

Base URL: `http://localhost:8000`  
Interactive docs: `http://localhost:8000/docs` (Swagger UI) / `http://localhost:8000/redoc`

---

## Authentication

All protected endpoints require a Bearer token:

```
Authorization: Bearer <access_token>
```

Obtain a token via `/auth/login` (password) or `/oauth/callback` (OAuth 2.0).

---

## Auth Endpoints

### POST /auth/register

Register a new user with username + password.

**Request:**
```json
{ "username": "alice", "email": "alice@example.com", "password": "secret123" }
```

**Response `200`:**
```json
{ "access_token": "<JWT>", "token_type": "bearer" }
```

---

### POST /auth/login

Authenticate with username + password.

**Request:**
```json
{ "username": "alice", "password": "secret123" }
```

**Response `200`:**
```json
{ "access_token": "<JWT>", "token_type": "bearer" }
```

---

## OAuth 2.0 Endpoints (New in v2.0)

### GET /oauth/url/{provider}

Get the authorization URL to redirect the user to.  
Supported providers: `google`, `github`

**Response `200`:**
```json
{
  "url": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&response_type=code&scope=openid+email+profile",
  "provider": "google"
}
```

**Error `503`:** Provider not configured (client_id empty in server config).

---

### POST /oauth/callback

Exchange an OAuth authorization code for a MeshEngine JWT.  
The server performs the code-for-token exchange and identity fetch server-side.

**Request:**
```json
{
  "provider": "google",
  "code": "4/0AX4XfWh...",
  "redirect_uri": "http://localhost:3000/oauth/callback"
}
```

**Response `200`:**
```json
{ "access_token": "<JWT>", "token_type": "bearer" }
```

**Errors:**
- `400` — Invalid provider or missing code
- `502` — Provider communication failed (provider down or code expired)

---

## Network Endpoints

### POST /network/create

Create a mesh network with auto-generated links.

**Request:**
```json
{
  "name": "My Network",
  "nodes": [
    { "name": "A", "x": 0, "y": 0, "latency_ms": 10 },
    { "name": "B", "x": 100, "y": 0, "latency_ms": 10 }
  ],
  "link_threshold": 150.0
}
```

Links are auto-generated for node pairs with Euclidean distance ≤ `link_threshold`.  
Edge weight = distance × 0.5ms.

**Response `201`:**
```json
{
  "id": "uuid",
  "name": "My Network",
  "link_threshold": 150.0,
  "nodes": [{ "id": "uuid", "name": "A", "x": 0, "y": 0, "status": "UP", "latency_ms": 10 }],
  "links": [{ "id": "uuid", "source_id": "...", "target_id": "...", "weight": 50.0, "bidirectional": true }],
  "created_at": "2026-04-10T12:00:00Z"
}
```

---

### GET /network/list

List all networks with summary stats.

**Response `200`:**
```json
[{ "id": "uuid", "name": "My Network", "node_count": 5, "link_count": 8, "active_nodes": 4 }]
```

---

### GET /network/state/{network_id}

Get live topology state (nodes + links with current status).

**Response `200`:**
```json
{
  "network_id": "uuid",
  "node_count": 5,
  "active_nodes": 4,
  "down_nodes": 1,
  "link_count": 8,
  "nodes": [...],
  "links": [...]
}
```

**Error `404`:** Network not found.

---

## Node Endpoints

### POST /node/fail/{node_id}

Mark a node as DOWN. Excluded from all subsequent Dijkstra routing.

**Response `200`:** Updated node object with `"status": "DOWN"`.

**Events emitted:** `NODE_DOWN` on `mesh:node:events`

---

### POST /node/recover/{node_id}

Re-admit a DOWN node to the routing graph.

**Response `200`:** Updated node object with `"status": "UP"`.

**Events emitted:** `NODE_RECOVERED` on `mesh:node:events`

---

## Authenticated Node Management (CRUD)

All endpoints under `/nodes` require `Authorization: Bearer <token>`.

### GET /nodes — List all nodes
### POST /nodes — Create node
### PUT /nodes/{id} — Update node
### DELETE /nodes/{id} — Delete node
### POST /nodes/{id}/block — Block node (sets status DOWN)
### POST /nodes/{id}/start — Start node (sets status UP)

---

## Simulation Endpoint

### POST /simulation/start

Run a full self-healing simulation scenario.

**Request:**
```json
{
  "network_id": "uuid",
  "source_id": "uuid",
  "destination_id": "uuid",
  "payload": "HELLO",
  "fail_nodes": ["uuid-of-node-to-fail"]
}
```

`fail_nodes` is optional.

**Simulation phases:**
1. Compute initial shortest path (Dijkstra)
2. Inject failures (if `fail_nodes` provided)
3. Recompute route (self-healing)
4. Deliver message on final path

**Response `200`:**
```json
{
  "simulation_id": "uuid",
  "network_id": "uuid",
  "status": "SUCCESS",
  "initial_path": ["nodeA", "nodeB", "nodeC"],
  "initial_latency_ms": 45.5,
  "rerouted": true,
  "final_path": ["nodeA", "nodeD", "nodeC"],
  "final_latency_ms": 62.0,
  "failed_nodes": ["nodeB"],
  "message_id": "uuid",
  "explanation": "Initial path: A→B→C. Nodes failed: [B]. Self-healing reroute activated. New path: A→D→C."
}
```

---

## Simulation Lab Endpoints (New in v2.0)

### GET /lab/presets

List available preset scenarios.

**Response `200`:**
```json
[
  { "name": "dense_grid", "label": "Dense Grid Network", "description": "...", "node_count": 9 },
  { "name": "sparse_web",  "label": "Sparse Web Network",  "description": "...", "node_count": 6 },
  { "name": "star_hub",   "label": "Star Hub Topology",   "description": "...", "node_count": 6 },
  { "name": "mid_failure", "label": "Mid-Route Failure",   "description": "...", "node_count": 5 }
]
```

### GET /lab/presets/{name}

Get full preset specification.

### POST /lab/presets/{name}/deploy

Instantiate a preset topology. Returns `network_id` and `node_map` for immediate use with `/simulation/start`.

**Response `200`:**
```json
{
  "preset_name": "dense_grid",
  "network_id": "uuid",
  "node_map": { "N1": "uuid-1", "N9": "uuid-9" },
  "recommended_source_id": "uuid-1",
  "recommended_destination_id": "uuid-9",
  "recommended_fail_node_ids": ["uuid-5"],
  "scenario_narrative": "..."
}
```

---

## WebSocket Endpoints

### WS /ws/simulation

Primary real-time event stream (ConnectionManager-backed, low latency).

Connect: `ws://localhost:8000/ws/simulation`

### WS /ws/stream

Redis pub/sub bridge — dedicated subscription per client.

---

## Event Schema Reference

| `event_type` | Key Fields |
|---|---|
| `SIMULATION_STARTED` | `simulation_id`, `network_id`, `source_id`, `destination_id` |
| `ROUTE_COMPUTED` | `simulation_id`, `phase`, `path[]`, `latency_ms`, `hop_count` |
| `NODE_DOWN` | `simulation_id`, `node_id`, `node_name`, `network_id` |
| `NODE_RECOVERED` | `node_id`, `node_name`, `network_id` |
| `ROUTE_RECOMPUTED` | `simulation_id`, `phase`, `path[]`, `latency_ms`, `rerouted`, `failed_nodes[]` |
| `SIMULATION_COMPLETED` | `simulation_id`, `message_id`, `final_path[]` |
| `SIMULATION_FAILED` | `simulation_id`, `reason`, `failed_nodes[]` |
| `MESSAGE_HOP` | `from`, `to`, `message_id`, `timestamp` |
| `MESSAGE_DELIVERED` | `message_id`, `network_id` |
| `MESSAGE_FAILED` | `message_id`, `reason` |

---

## Rate Limiting

Default: 10 requests per 60 seconds per IP (429 when exceeded).  
Configure: `RATE_LIMIT_REQUESTS` + `RATE_LIMIT_WINDOW_SECONDS` env vars.

---

## History

### GET /history

Returns the action history for the authenticated user.

---

## Health + Metrics

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Service health + WS client count |
| `GET /metrics` | Prometheus text format |
| `GET /` | Service index with all route URLs |
| `GET /docs` | Swagger UI |
| `GET /redoc` | ReDoc |
| `GET /dashboard` | Legacy static HTML dashboard |
