# MeshEngine — Run & Test Guide

> End-to-end instructions: start stack → hit APIs → run demo → check logs.

---

## Table of Contents

1. [Step-by-Step Run Flow](#step-by-step-run-flow)
2. [Unit Tests](#unit-tests)
3. [API Testing — curl Reference](#api-testing--curl-reference)
4. [Full Demo Script](#full-demo-script)
5. [WebSocket Testing](#websocket-testing)
6. [Metrics & Tracing](#metrics--tracing)
7. [Functional Test Scenarios](#functional-test-scenarios)
8. [Debugging Guide](#debugging-guide)

---

## Step-by-Step Run Flow

### Prerequisites

Docker Desktop must be running. All commands from project root.

### 1 — Start all services

```bash
docker compose up --build
```

Wait for these log lines (order matters):

```
postgres-1     | database system is ready to accept connections
redis-1        | Ready to accept connections
control_plane-1 | database tables created
control_plane-1 | Application startup complete.
node_worker-1  | subscribed channels=['mesh:message:flow', 'mesh:node:events', 'mesh:simulation:events']
```

### 2 — Confirm health

```bash
curl -s http://localhost:8000/health | jq .
```

Expected:
```json
{
  "status": "ok",
  "database": "connected",
  "redis": "connected"
}
```

If anything shows `"error"`, check [Debugging Guide](#debugging-guide).

### 3 — Open the dashboard (optional but useful)

```
http://localhost:8000/dashboard
```

The SVG dashboard live-updates as you send API requests. Keep it open in a browser tab while running tests.

### 4 — Run the automated demo

```bash
chmod +x scripts/demo.sh
bash scripts/demo.sh
```

This script exercises the full happy path + failure injection in one run. See [Full Demo Script](#full-demo-script) for what it does.

### 5 — Stop services

```bash
docker compose down           # stop, keep postgres data
docker compose down -v        # stop + wipe postgres volume (clean slate)
```

---

## Unit Tests

The test suite is pure Python — no Docker, no DB, no Redis required.

```bash
cd control-plane
source .venv/bin/activate         # or: python3.11 -m venv .venv && pip install -r requirements.txt

python -m pytest tests/ -v
```

Expected output:

```
tests/test_dijkstra.py::test_simple_path PASSED
tests/test_dijkstra.py::test_node_failure_reroute PASSED
tests/test_dijkstra.py::test_isolated_node PASSED
...
26 passed in 0.11s
```

Run a single test file:
```bash
python -m pytest tests/test_dijkstra.py -v
```

Run with output on failure:
```bash
python -m pytest tests/ -v -s
```

---

## API Testing — curl Reference

Replace `NETWORK_ID`, `NODE_ID`, `MSG_ID` with values from prior responses.

### Health

```bash
curl -s http://localhost:8000/health | jq .
```

---

### Network

**Create a 6-node mesh network:**

```bash
curl -s -X POST http://localhost:8000/network/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-net",
    "link_threshold": 150.0,
    "nodes": [
      {"name": "node-A", "x": 0,   "y": 50,  "latency_ms": 5},
      {"name": "node-B", "x": 100, "y": 10,  "latency_ms": 5},
      {"name": "node-C", "x": 100, "y": 100, "latency_ms": 5},
      {"name": "node-D", "x": 200, "y": 50,  "latency_ms": 5},
      {"name": "node-E", "x": 150, "y": 25,  "latency_ms": 5},
      {"name": "node-F", "x": 300, "y": 50,  "latency_ms": 5}
    ]
  }' | jq .
```

Capture the network ID:
```bash
NETWORK_ID=$(curl -s -X POST http://localhost:8000/network/create \
  -H "Content-Type: application/json" \
  -d '{"name":"net1","link_threshold":150.0,"nodes":[{"name":"A","x":0,"y":50,"latency_ms":5},{"name":"B","x":100,"y":10,"latency_ms":5},{"name":"C","x":100,"y":100,"latency_ms":5},{"name":"D","x":200,"y":50,"latency_ms":5},{"name":"F","x":300,"y":50,"latency_ms":5}]}' \
  | jq -r '.id')
echo "NETWORK_ID=$NETWORK_ID"
```

**Get network state:**

```bash
curl -s http://localhost:8000/network/state/${NETWORK_ID} | jq .
```

---

### Node Failure & Recovery

```bash
# Extract a node ID by name
NODE_B=$(curl -s http://localhost:8000/network/state/${NETWORK_ID} \
  | jq -r '.nodes[] | select(.name=="B") | .id')

# Fail the node
curl -s -X POST http://localhost:8000/node/fail/${NODE_B} | jq '{id, name, status}'

# Recover the node
curl -s -X POST http://localhost:8000/node/recover/${NODE_B} | jq '{id, name, status}'
```

---

### Send a Message

```bash
NODE_A=$(curl -s http://localhost:8000/network/state/${NETWORK_ID} \
  | jq -r '.nodes[] | select(.name=="A") | .id')
NODE_F=$(curl -s http://localhost:8000/network/state/${NETWORK_ID} \
  | jq -r '.nodes[] | select(.name=="F") | .id')

curl -s -X POST http://localhost:8000/message/send \
  -H "Content-Type: application/json" \
  -d "{
    \"network_id\": \"${NETWORK_ID}\",
    \"source_id\": \"${NODE_A}\",
    \"destination_id\": \"${NODE_F}\",
    \"payload\": \"hello from A to F\"
  }" | jq '{id, status, path, total_latency_ms, hops_completed}'
```

**Retrieve message by ID:**

```bash
MSG_ID=<paste message id here>
curl -s http://localhost:8000/message/${MSG_ID} | jq .
```

**Get full hop trace:**

```bash
curl -s http://localhost:8000/message/${MSG_ID}/trace | jq .
```

---

### Run a Full Simulation

```bash
curl -s -X POST http://localhost:8000/simulation/start \
  -H "Content-Type: application/json" \
  -d "{
    \"network_id\": \"${NETWORK_ID}\",
    \"source_id\": \"${NODE_A}\",
    \"destination_id\": \"${NODE_F}\",
    \"payload\": \"sim payload\",
    \"fail_nodes\": [\"${NODE_B}\"]
  }" | jq '{simulation_id, initial_path, rerouted, final_path, final_latency_ms}'
```

Expected output shows `"rerouted": true` and `final_path` avoiding node B.

---

### Metrics

```bash
# Global metrics
curl -s http://localhost:8000/metrics | jq .

# Per-network metrics
curl -s http://localhost:8000/metrics/${NETWORK_ID} | jq .

# Reset all metrics (dev only)
curl -s -X DELETE http://localhost:8000/metrics/reset
```

---

## Full Demo Script

The `scripts/demo.sh` script runs the canonical 6-step demonstration end-to-end:

```
Step 1  Create 6-node mesh network (A, B, C, D, E, F)
Step 2  Send message A→F        — route: A→B→D→F (optimal, 157.6ms)
Step 3  Inject failure on B     — node B goes DOWN
Step 4  Resend A→F              — reroutes: A→C→D→F (self-healed)
Step 5  Full simulation run     — automated with fail_nodes=[B]
Step 6  Print final network state
```

```bash
# Run with defaults (localhost:8000)
bash scripts/demo.sh

# Run against a different host
BASE_URL=http://my-server:8000 bash scripts/demo.sh
```

**Prerequisites:** `curl` and `jq` must be installed.

**Expected final output:**
```
  Before failure:  A → B → D → F  (optimal path)
  Node B fails:    ██ partitioned from path
  After reroute:   A → C → D → F  (self-healed)
```

---

## WebSocket Testing

### Using websocat (CLI)

```bash
# Install
brew install websocat         # macOS
cargo install websocat        # or via cargo
npm install -g wscat          # or via npm
# Connect to event stream
websocat ws://localhost:8000/ws/stream

# Connect to simulation WebSocket (gets direct push events)
websocat ws://localhost:8000/ws/simulation
```

In a second terminal, fire a message send — you will see events printed in the websocat terminal in real time:

```json
{"event_type": "MESSAGE_SENT", "message_id": "...", "trace_id": "...", ...}
{"event_type": "MESSAGE_HOP", "hop": 1, "from_node_id": "...", ...}
{"event_type": "MESSAGE_HOP", "hop": 2, ...}
{"event_type": "MESSAGE_DELIVERED", "total_latency_ms": 157.6, ...}
```

### Using the browser dashboard

1. Open `http://localhost:8000/dashboard`
2. The dashboard connects to `/ws/simulation` automatically
3. Run the demo script in a terminal — watch the SVG graph animate in real time

### Using Postman

1. New request → select **WebSocket** tab
2. URL: `ws://localhost:8000/ws/simulation`
3. Connect → send any text to keep-alive
4. Fire REST API calls — events appear in the messages panel

---

## Metrics & Tracing

### Check metrics after a simulation run

```bash
# Run demo first
bash scripts/demo.sh

# Then query metrics
curl -s http://localhost:8000/metrics | jq '{
  messages_sent,
  messages_delivered,
  messages_failed,
  avg_latency_ms,
  success_rate_pct,
  reroutes
}'
```

### Trace a specific message

Every message has a `trace_id`. Messages routed within a simulation share the simulation ID as their `trace_id`.

```bash
MSG_ID=<from message/send response>
curl -s http://localhost:8000/message/${MSG_ID}/trace | jq '{
  trace_id,
  path_names,
  total_latency_ms,
  hops_completed,
  hops: [.hops[] | {hop, from_node_name, to_node_name, link_latency_ms, cumulative_latency_ms}]
}'
```

---

## Functional Test Scenarios

Work through these manually to validate the system end-to-end.

### Scenario 1 — Basic routing

1. Create a 4-node network: A(0,0), B(50,0), C(100,0), D(150,0) — threshold 100
2. Send message A→D
3. **Expected:** path `[A, B, C, D]`, status `DELIVERED`

### Scenario 2 — Self-healing reroute

1. Create the 6-node demo network (see demo.sh)
2. Send A→F — confirm path is `A→B→D→F`
3. Fail node B: `POST /node/fail/{B_id}`
4. Send A→F again — confirm path is `A→C→D→F`
5. Recover node B: `POST /node/recover/{B_id}`
6. Send A→F again — confirm optimal path `A→B→D→F` is restored

### Scenario 3 — No route (isolated node)

1. Create network with two disconnected clusters (link_threshold very small, e.g. 10.0)
2. Send message between two unconnected nodes
3. **Expected:** HTTP 409 or `status: FAILED` with `"no_route"` reason

### Scenario 4 — Metrics accumulation

1. Send 5 messages on the same network
2. `GET /metrics/{network_id}`
3. **Expected:** `messages_total: 5`, `messages_delivered: 5`, `avg_latency_ms` > 0

### Scenario 5 — Simulation auto-reroute

1. `POST /simulation/start` with `fail_nodes: [<node_B_id>]`
2. **Expected response:** `rerouted: true`, `initial_path` includes B, `final_path` does not

---

## Debugging Guide

### Where logs are

**Docker:**
```bash
docker compose logs control_plane --tail 50 --follow
docker compose logs node_worker --tail 50 --follow
docker compose logs postgres --tail 20
docker compose logs redis --tail 20
```

**Local (non-Docker):**
Logs print to stdout as structured JSON (`structlog`). Use `| jq .` to pretty-print:
```bash
PYTHONPATH=. uvicorn app.main:app 2>&1 | jq .
```

### Trace a failed request

All log lines include `request_id`, `network_id`, `message_id`, and `trace_id` fields. Grep them:

```bash
docker compose logs control_plane | grep '"message_id":"<your-id>"'
```

### Validate Redis is receiving events

```bash
# Subscribe to all mesh channels in one terminal
redis-cli psubscribe "mesh:*"

# Fire an API call in another terminal — events appear here in real time
```

### Check database state directly

```bash
# Connect to postgres container
docker compose exec postgres psql -U meshuser -d meshengine

# Useful queries
SELECT id, name, status FROM nodes WHERE network_id = '<id>';
SELECT id, status, path, total_latency_ms FROM messages ORDER BY created_at DESC LIMIT 10;
SELECT COUNT(*) FROM links;
\q
```

### Validate all services are running

```bash
docker compose ps
# All four services should show "running" or "healthy"
```

### Common error → fix

| Error | Cause | Fix |
|-------|-------|-----|
| `{"detail":"Network not found"}` | Wrong NETWORK_ID in request | Re-query `GET /network/state/{id}` or recreate network |
| `{"detail":"No route available"}` | Source/dest disconnected or both nodes are DOWN | Check node statuses; recover nodes; verify link_threshold is large enough |
| `WebSocket connection closed` | Container restarting or port not exposed | `docker compose ps` → restart unhealthy service |
| `asyncpg.exceptions.TooManyConnectionsError` | Connection pool exhausted | Restart control_plane container |
| `WRONGTYPE Operation against a key holding the wrong value` | Redis key type collision (rare after reset) | `DELETE /metrics/reset` or `redis-cli FLUSHDB` (dev only) |
| `422 Unprocessable Entity` | Malformed request body | Check `curl` JSON — all UUIDs must be strings, not ints |

### Confirm Dijkstra is working (unit test)

```bash
cd control-plane
python -m pytest tests/test_dijkstra.py -v -s
```

If these 26 tests pass, the routing engine is correct regardless of DB/Redis state.
