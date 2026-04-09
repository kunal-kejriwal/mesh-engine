# MeshEngine — API Documentation

## Base URL

```
http://localhost:8000          # local development
https://meshengine.dev/api     # production (GCP VM + custom domain)
```

---

## Authentication

All node management and dashboard endpoints require a JWT bearer token.

```
Authorization: Bearer <access_token>
```

Obtain a token via `POST /auth/login`. Token expiry: **1 hour**.

Public endpoints (no auth required): `/health`, `/`, `/network/*`, `/node/*`, `/message/*`, `/simulation/*`, `/metrics`, `/ws/*`

---

## Endpoints

---

### Health

#### `GET /health`

Returns service health and WebSocket client count.

**Response**
```json
{
  "status": "healthy",
  "service": "MeshEngine Control Plane",
  "version": "1.0.0",
  "ws_clients": 3
}
```

---

### Network

#### `POST /network/create`

Provision a mesh network with N drone nodes. Links are auto-generated for every node pair within `link_threshold` Euclidean distance. Edge weight = distance × 0.5 ms.

**Request Body**
```json
{
  "name": "alpha-grid",
  "nodes": [
    { "name": "node-A", "x": 0.0,   "y": 0.0,   "latency_ms": 10 },
    { "name": "node-B", "x": 100.0, "y": 50.0,  "latency_ms": 10 },
    { "name": "node-C", "x": 200.0, "y": 0.0,   "latency_ms": 10 }
  ],
  "link_threshold": 150.0
}
```

| Field | Type | Description |
|---|---|---|
| `name` | string | Network identifier label |
| `nodes` | array | List of node definitions (min 2) |
| `nodes[].name` | string | Node label |
| `nodes[].x` / `y` | float | 2D grid coordinates |
| `nodes[].latency_ms` | float | Processing latency (default 10.0) |
| `link_threshold` | float | Max distance for auto-link (default 150.0) |

**Response** `201 Created`
```json
{
  "id": "3f2a1b...",
  "name": "alpha-grid",
  "link_threshold": 150.0,
  "nodes": [
    { "id": "a1...", "name": "node-A", "x": 0.0, "y": 0.0, "status": "UP", "latency_ms": 10.0 }
  ],
  "links": [
    { "id": "l1...", "source_id": "a1...", "target_id": "b2...", "weight": 55.9, "bidirectional": true }
  ],
  "created_at": "2026-04-08T10:00:00Z"
}
```

**curl**
```bash
curl -X POST http://localhost:8000/network/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "alpha-grid",
    "nodes": [
      {"name":"node-A","x":0,"y":0,"latency_ms":10},
      {"name":"node-B","x":100,"y":50,"latency_ms":10},
      {"name":"node-C","x":200,"y":0,"latency_ms":10}
    ],
    "link_threshold": 150
  }'
```

---

#### `GET /network/state/{network_id}`

Returns live topology: node statuses, all links.

**Response**
```json
{
  "network_id": "3f2a1b...",
  "node_count": 3,
  "active_nodes": 2,
  "down_nodes": 1,
  "link_count": 3,
  "nodes": [...],
  "links": [...]
}
```

---

#### `GET /network/list`

List all networks.

**Response**
```json
[
  {
    "id": "3f2a1b...",
    "name": "alpha-grid",
    "node_count": 5,
    "link_count": 8,
    "active_nodes": 4
  }
]
```

---

### Node

#### `POST /node/fail/{node_id}`

Mark a node as `DOWN`. It is excluded from all future routing path computations.

**Path param:** `node_id` — UUID of the target node

**Response**
```json
{ "id": "a1...", "name": "node-A", "x": 0.0, "y": 0.0, "status": "DOWN", "latency_ms": 10.0 }
```

**curl**
```bash
curl -X POST http://localhost:8000/node/fail/a1b2c3d4-...
```

---

#### `POST /node/recover/{node_id}`

Re-admit a `DOWN` node to the routing graph.

**Response**
```json
{ "id": "a1...", "status": "UP", ... }
```

---

### Node Management (auth required)

#### `GET /nodes`

List all nodes across all networks. Requires JWT.

**Response**
```json
[
  { "id": "...", "name": "node-A", "x": 0.0, "y": 0.0, "status": "UP", "latency_ms": 10.0, "network_id": "...", "created_at": "..." }
]
```

---

#### `POST /nodes`

Create a node in an existing network.

**Request Body**
```json
{ "name": "node-D", "x": 150.0, "y": 100.0, "latency_ms": 10.0, "network_id": "3f2a1b..." }
```

**Response** `201 Created` — node object

---

#### `PUT /nodes/{node_id}`

Update node coordinates or latency.

**Request Body**
```json
{ "x": 175.0, "y": 120.0, "latency_ms": 8.0 }
```

---

#### `DELETE /nodes/{node_id}`

Remove a node and all its links.

**Response** `204 No Content`

---

#### `POST /nodes/{node_id}/block`

Set node status to `DOWN` (alias for fail). Logged to history.

#### `POST /nodes/{node_id}/start`

Set node status to `UP` (alias for recover). Logged to history.

---

### Message

#### `POST /message/send`

Send a message from source to destination. The routing engine computes the shortest path (Dijkstra) and publishes hop-by-hop events to Redis Pub/Sub.

**Request Body**
```json
{
  "network_id": "3f2a1b...",
  "source_id":  "a1...",
  "destination_id": "c3...",
  "payload": "ping"
}
```

**Response**
```json
{
  "message_id": "m1...",
  "path": ["a1...", "b2...", "c3..."],
  "hop_count": 3,
  "total_latency_ms": 25.5,
  "status": "DELIVERED"
}
```

**curl**
```bash
curl -X POST http://localhost:8000/message/send \
  -H "Content-Type: application/json" \
  -d '{"network_id":"...","source_id":"...","destination_id":"...","payload":"ping"}'
```

---

#### `GET /message/{message_id}`

Retrieve a message and its route log.

---

### Simulation

#### `POST /simulation/start`

Start a simulation run — fires random messages across the network at a configurable rate.

**Request Body**
```json
{ "network_id": "3f2a1b...", "message_count": 50, "interval_ms": 500 }
```

**Response**
```json
{ "simulation_id": "s1...", "status": "RUNNING" }
```

---

#### `GET /simulation/status/{simulation_id}`

Poll simulation progress.

---

### Authentication

#### `POST /auth/register`

Create a new user account.

**Request Body**
```json
{
  "name": "Alice Smith",
  "email": "alice@example.com",
  "username": "alice",
  "password": "SecurePass123!",
  "accept_terms": true
}
```

**Response** `201 Created`
```json
{ "id": "u1...", "username": "alice", "email": "alice@example.com" }
```

---

#### `POST /auth/login`

Authenticate and receive a JWT access token.

**Request Body**
```json
{ "username": "alice", "password": "SecurePass123!" }
```

**Response**
```json
{ "access_token": "eyJ...", "token_type": "bearer", "expires_in": 3600 }
```

**curl**
```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"SecurePass123!"}'
```

---

### History

#### `GET /history`

Retrieve the action log for the authenticated user. Requires JWT.

**Response**
```json
[
  {
    "id": "h1...",
    "action": "node_created",
    "node_id": "a1...",
    "timestamp": "2026-04-08T11:00:00Z"
  }
]
```

---

### Metrics

#### `GET /metrics`

Prometheus-compatible metrics endpoint (message counts, latency histograms, node status gauges).

---

### WebSocket

#### `ws://localhost:8000/ws/stream`

Subscribe to the live event stream. Emits JSON frames as mesh events occur.

**Frame format**
```json
{
  "type": "hop",
  "message_id": "m1...",
  "from": "a1...",
  "to": "b2...",
  "latency_ms": 12.3,
  "timestamp": "2026-04-08T11:00:00Z"
}
```

Event types: `hop`, `node_down`, `node_up`, `path_found`, `path_failed`, `simulation_start`, `simulation_end`

---

## Job / Message Lifecycle

```
Client                Control Plane              Redis             Workers
  │                        │                       │                  │
  │── POST /message/send ──▶                       │                  │
  │                        │── Dijkstra path ──▶   │                  │
  │                        │── publish events ────▶│                  │
  │◀── path + latency ─────│                       │──▶ NodeWorkers   │
  │                        │                       │    subscribe &   │
  │── GET /message/{id} ──▶│                       │    log hops      │
  │◀── full route log ─────│                       │                  │
```

States: `PENDING` → `ROUTING` → `DELIVERED` | `FAILED`

---

## Error Handling

All errors return a consistent JSON body:

```json
{ "error": "NODE_NOT_FOUND", "message": "Node a1b2... does not exist" }
```

| HTTP Status | Meaning |
|---|---|
| 400 | Bad request / domain validation error |
| 401 | Missing or invalid JWT |
| 404 | Resource not found |
| 422 | Request body schema validation failure |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

---

## Rate Limiting

**10 requests per minute per IP** on all endpoints.

Exceeding the limit returns:
```json
{ "error": "RATE_LIMIT_EXCEEDED", "message": "Too many requests. Retry after 60s." }
```

Response header: `X-RateLimit-Remaining: 0`

---

## Sample End-to-End Flow

```bash
# 1. Create a network
NET=$(curl -sX POST http://localhost:8000/network/create \
  -H "Content-Type: application/json" \
  -d '{"name":"demo","nodes":[{"name":"A","x":0,"y":0},{"name":"B","x":80,"y":0},{"name":"C","x":160,"y":0}],"link_threshold":100}' \
  | jq -r '.id')

# 2. Get node IDs
NODES=$(curl -s http://localhost:8000/network/state/$NET | jq '.nodes')
SRC=$(echo $NODES | jq -r '.[0].id')
DST=$(echo $NODES | jq -r '.[2].id')

# 3. Send a message
curl -X POST http://localhost:8000/message/send \
  -H "Content-Type: application/json" \
  -d "{\"network_id\":\"$NET\",\"source_id\":\"$SRC\",\"destination_id\":\"$DST\",\"payload\":\"hello\"}"

# 4. Inject a failure + watch rerouting
curl -X POST http://localhost:8000/node/fail/$MID_NODE

# 5. Open WebSocket stream in parallel to watch live hops
wscat -c ws://localhost:8000/ws/stream
```

---

## GCP + Custom Domain

When deployed on a GCP VM with a custom domain (e.g. `meshengine.dev`):

| URL | Resolves to |
|---|---|
| `https://meshengine.dev` | React frontend (served by Nginx) |
| `https://meshengine.dev/api` | FastAPI backend (reverse-proxied by Nginx) |
| `wss://meshengine.dev/ws/stream` | WebSocket (proxied by Nginx) |

**Setup:**
1. Point DNS A record → GCP VM external IP
2. Nginx listens on `:80` / `:443`; serves frontend static files and proxies `/api` → `localhost:8000`
3. Certbot (Let's Encrypt) handles TLS

```nginx
server {
    server_name meshengine.dev;

    location / {
        root /var/www/meshengine/frontend/dist;
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:8000/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```
