# MeshEngine — Distributed Mesh Network Simulation Platform

> Simulates a self-healing drone mesh network inspired by disaster-recovery and defence communication systems. Built with FastAPI, Redis Pub/Sub, PostgreSQL, and Dijkstra's routing algorithm.

---

## Problem Statement

In disaster recovery and defence scenarios, drone swarms form ad-hoc mesh networks where individual nodes can fail without warning. The network must:

- Route messages across potentially dozens of hops
- Detect and exclude failed nodes in real time
- Automatically find alternative routes (self-healing)
- Provide operators with live visibility into message flow and topology state

MeshEngine is a backend simulation platform for modelling and testing exactly this behaviour.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                          CONTROL PLANE                             │
│                      (FastAPI + PostgreSQL)                        │
│                                                                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌─────────────────┐  │
│  │ /network │  │  /node   │  │ /message  │  │  /simulation    │  │
│  │  create  │  │ fail /   │  │  send /   │  │    start        │  │
│  │  state   │  │ recover  │  │  get      │  │                 │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └────────┬────────┘  │
│       │              │              │                  │           │
│  ┌────▼──────────────▼──────────────▼──────────────────▼────────┐ │
│  │              Service Layer                                    │ │
│  │  NetworkService  RoutingService  MessageService  SimSvc       │ │
│  └────────────────────────┬──────────────────────────────────────┘ │
│                           │                                        │
│  ┌────────────────────────▼──────────────────────────────────────┐ │
│  │           Dijkstra Engine  (app/engine/dijkstra.py)           │ │
│  │   Weighted graph | Failure-aware traversal                    │ │
│  │   Path reconstruction | O((V+E) log V) complexity             │ │
│  └───────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ pub/sub events
                    ┌──────────▼──────────┐
                    │       Redis          │
                    │   mesh:message:flow  │
                    │   mesh:node:events   │
                    │   mesh:simulation:*  │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼────────────────────┐
         │                     │                    │
   ┌─────▼──────┐       ┌──────▼─────┐    ┌────────▼───────┐
   │ NodeWorker │       │ NodeWorker │    │  WebSocket     │
   │ (worker-1) │       │ (worker-N) │    │  /ws/stream    │
   └────────────┘       └────────────┘    └────────────────┘
           Execution Plane (independent async subscribers)
```

### Component Breakdown

| Component | Technology | Responsibility |
|---|---|---|
| Control Plane | FastAPI + SQLAlchemy | REST API, topology, routing decisions |
| Routing Engine | Pure Python (Dijkstra) | Shortest-path with failure exclusion |
| Messaging Layer | Redis Pub/Sub | Event-driven hop-by-hop delivery events |
| Execution Plane | Async Python workers | Subscribe, log, and react to mesh events |
| Persistence | PostgreSQL | Network topology, message history |
| Real-time Stream | WebSocket | Live event feed to dashboards/clients |

---

## Folder Structure

```
MeshEngine/
├── control-plane/               # FastAPI control plane service
│   ├── app/
│   │   ├── main.py              # FastAPI app + lifespan hooks
│   │   ├── api/                 # Route handlers (thin, delegate to services)
│   │   │   ├── network.py
│   │   │   ├── node.py
│   │   │   ├── message.py
│   │   │   ├── simulation.py
│   │   │   └── websocket.py
│   │   ├── core/                # Cross-cutting concerns
│   │   │   ├── config.py        # Pydantic Settings
│   │   │   ├── database.py      # SQLAlchemy async engine
│   │   │   ├── redis_client.py  # Shared Redis connection
│   │   │   ├── exceptions.py    # Typed domain exceptions
│   │   │   └── logging.py       # Structured logging (structlog)
│   │   ├── models/              # SQLAlchemy ORM models
│   │   │   ├── network.py
│   │   │   ├── node.py
│   │   │   ├── link.py
│   │   │   └── message.py
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   │   ├── network.py
│   │   │   ├── node.py
│   │   │   ├── message.py
│   │   │   └── simulation.py
│   │   ├── services/            # Business logic (testable, DB-injected)
│   │   │   ├── network_service.py
│   │   │   ├── routing_service.py
│   │   │   ├── message_service.py
│   │   │   └── simulation_service.py
│   │   └── engine/
│   │       └── dijkstra.py      # Core routing algorithm
│   ├── tests/
│   │   ├── conftest.py
│   │   ├── test_dijkstra.py     # 18 unit tests — pure Python, no DB
│   │   └── test_network.py      # Topology correctness tests
│   ├── Dockerfile
│   └── requirements.txt
├── node-worker/                 # Execution plane workers
│   ├── worker/
│   │   ├── main.py              # Entry point + signal handling
│   │   ├── node_worker.py       # Redis subscriber + event handlers
│   │   └── state_manager.py     # Local in-memory node state cache
│   ├── Dockerfile
│   └── requirements.txt
├── infra/
│   └── gcp-deployment.md        # Step-by-step GCP deployment guide
├── scripts/
│   └── demo.sh                  # Full automated demo (curl + jq)
├── docker-compose.yml
└── .env.example
```

---

## Quick Start

### Prerequisites

- Docker + Docker Compose
- `curl` and `jq` (for the demo script)

### 1. Start the Stack

```bash
docker compose up --build
```

Services start in dependency order:
- PostgreSQL → Redis → Control Plane → Node Worker
- API: http://localhost:8000
- Swagger UI: http://localhost:8000/docs

### 2. Run the Full Demo

```bash
chmod +x scripts/demo.sh
./scripts/demo.sh
```

### 3. Run Tests (no Docker needed)

```bash
cd control-plane
pip install -r requirements.txt
pytest tests/ -v
```

---

## API Reference

### Network

#### `POST /network/create`

Create a mesh network. Links are auto-generated for every node pair within `link_threshold` Euclidean distance. Edge weight = `distance × 0.5 ms`.

```bash
curl -X POST http://localhost:8000/network/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "alpha-network",
    "link_threshold": 150.0,
    "nodes": [
      {"name": "node-A", "x": 0,   "y": 50,  "latency_ms": 5},
      {"name": "node-B", "x": 100, "y": 10,  "latency_ms": 5},
      {"name": "node-C", "x": 100, "y": 100, "latency_ms": 5},
      {"name": "node-D", "x": 200, "y": 50,  "latency_ms": 5},
      {"name": "node-E", "x": 150, "y": 25,  "latency_ms": 5},
      {"name": "node-F", "x": 300, "y": 50,  "latency_ms": 5}
    ]
  }'
```

#### `GET /network/state/{network_id}`

Returns live topology: node statuses, link count, active/down counts.

---

### Node

#### `POST /node/fail/{node_id}`

Marks node DOWN. Dijkstra excludes it from all future routing computations.

```bash
curl -X POST http://localhost:8000/node/fail/<node_id>
```

#### `POST /node/recover/{node_id}`

Re-admits a DOWN node. Future routes may traverse it again.

```bash
curl -X POST http://localhost:8000/node/recover/<node_id>
```

---

### Message

#### `POST /message/send`

Routes a message source → destination. Returns full path, per-hop latency log, total latency.

```bash
curl -X POST http://localhost:8000/message/send \
  -H "Content-Type: application/json" \
  -d '{
    "network_id": "<network_id>",
    "source_id": "<node_a_id>",
    "destination_id": "<node_f_id>",
    "payload": "HELLO from drone A"
  }'
```

**Response (abridged):**
```json
{
  "id": "msg-111-...",
  "status": "DELIVERED",
  "path": ["<A>", "<B>", "<D>", "<F>"],
  "hops_completed": 3,
  "total_latency_ms": 157.6,
  "hop_log": [
    {"hop": 1, "from_node_id": "<A>", "to_node_id": "<B>", "link_latency_ms": 53.85, "cumulative_latency_ms": 53.85},
    {"hop": 2, "from_node_id": "<B>", "to_node_id": "<D>", "link_latency_ms": 53.85, "cumulative_latency_ms": 107.70},
    {"hop": 3, "from_node_id": "<D>", "to_node_id": "<F>", "link_latency_ms": 50.00, "cumulative_latency_ms": 157.70}
  ]
}
```

#### `GET /message/{message_id}`

Retrieve full routing history for a previously sent message.

---

### Simulation

#### `POST /simulation/start`

Runs a complete self-healing scenario automatically.

```bash
curl -X POST http://localhost:8000/simulation/start \
  -H "Content-Type: application/json" \
  -d '{
    "network_id": "<network_id>",
    "source_id": "<node_a_id>",
    "destination_id": "<node_f_id>",
    "payload": "SIMULATION PAYLOAD",
    "fail_nodes": ["<node_b_id>"]
  }'
```

**Response:**
```json
{
  "simulation_id": "sim-xyz-...",
  "status": "SUCCESS",
  "initial_path": ["<A>", "<B>", "<D>", "<F>"],
  "initial_latency_ms": 157.6,
  "rerouted": true,
  "final_path": ["<A>", "<C>", "<D>", "<F>"],
  "final_latency_ms": 161.8,
  "failed_nodes": ["<B>"],
  "message_id": "msg-222-...",
  "explanation": "Initial path: node-A → node-B → node-D → node-F. Nodes failed: [<B>]. Self-healing reroute activated. New path: node-A → node-C → node-D → node-F."
}
```

---

### Real-time WebSocket

```
ws://localhost:8000/ws/stream
```

Connect to receive a live stream of all mesh events (message deliveries, node failures, simulation phases, route recomputes).

```bash
# Using websocat
websocat ws://localhost:8000/ws/stream
```

**Event types streamed:**
```
CONNECTED          — subscription confirmed
SIMULATION_STARTED — simulation phase begins
ROUTE_COMPUTED     — initial path found
NODE_FAILED        — node marked DOWN
ROUTE_RECOMPUTED   — self-healing path found
MESSAGE_DELIVERED  — message successfully routed
SIMULATION_COMPLETED — full simulation done
PING               — heartbeat (idle keepalive)
```

---

## Demo Walkthrough

### 6-node scenario: drone B loses contact mid-mission

```
Node coordinates:

  A(0,50)                              F(300,50)
    |  \                              /
    |   B(100,10) ─── D(200,50) ────
    |  /             / \
    | /            E(150,25)
    C(100,100) ───┘
```

**Before failure — Dijkstra selects shortest path:**
```
A → B → D → F      157.6ms   (3 hops)
```

**Node B fails:**
```
Node B status: UP → DOWN
Dijkstra graph: B excluded from traversal
```

**Self-healing reroute:**
```
A → C → D → F      161.8ms   (3 hops, +4.2ms penalty)
```

**Worker log output:**
```
[worker-1] SIMULATION_STARTED   sim=xyz  node-A → node-F
[worker-1] ROUTE_COMPUTED       phase=initial  path=[A → B → D → F]  latency=157.60ms
[worker-1] NODE_FAILED          node=node-B   down_nodes=['node-B']
[worker-1] ROUTE_RECOMPUTED     rerouted=True  new_path=[A → C → D → F]  latency=161.80ms
[worker-1] MESSAGE_DELIVERED    id=msg-...  path=[A → C → D → F]  latency=161.80ms  hops=3
[worker-1] SIMULATION_COMPLETED sim=xyz  msg=msg-...  final_path=[A → C → D → F]
```

---

## Design Decisions

### Why Dijkstra (not A\*)?
The graph has no admissible heuristic without real geographic coordinates baked into the cost function. Dijkstra is exact, O((V+E) log V), and deterministic — appropriate for a simulation platform where correctness matters over speed at sub-100-node scale.

### Why Redis Pub/Sub (not Kafka)?
Kafka adds significant operational overhead. For a simulation platform where message history is already persisted in PostgreSQL, Redis Pub/Sub provides low-latency fan-out to the WebSocket layer without requiring durability guarantees on the event bus itself.

### Why async SQLAlchemy + asyncpg?
All DB operations are I/O-bound. Async execution allows hundreds of concurrent routing requests without blocking the event loop — critical when WebSocket connections are held open simultaneously alongside REST calls.

### Stateless routing service
`RoutingService` rebuilds the MeshGraph from DB state on every call. This ensures node failures are always reflected in the very next routing decision without requiring distributed cache invalidation. At 6–100 nodes, the rebuild overhead is microseconds.

---

## Observability

### Structured logs

```
2026-04-07T10:01:23Z [info    ] network_created  nodes=6  links=8  threshold=150.0
2026-04-07T10:01:24Z [info    ] route_computed   path=['A','B','D','F']  latency_ms=157.6  hops=3
2026-04-07T10:01:25Z [warning ] node_failed      node_id=bbb-...  name=node-B
2026-04-07T10:01:25Z [info    ] route_computed   path=['A','C','D','F']  latency_ms=161.8  hops=3
2026-04-07T10:01:25Z [info    ] message_delivered  id=msg-...  latency_ms=161.8
```

### Per-message metrics

| Metric | Field |
|---|---|
| End-to-end latency | `total_latency_ms` |
| Hop count | `hops_completed` |
| Per-link breakdown | `hop_log[].link_latency_ms` |
| Delivery status | `status` (DELIVERED / FAILED) |

---

## Running Tests

```bash
cd control-plane
pip install pytest
pytest tests/ -v --tb=short
```

18 unit tests + 7 topology tests — all pure Python, no DB or Redis needed.

---

## GCP Deployment

See [infra/gcp-deployment.md](infra/gcp-deployment.md) for the complete step-by-step guide:

- Cloud Run (control-plane, auto-scaled 1–10 instances)
- Cloud Run (node-worker, auto-scaled 1–20 instances)
- Cloud SQL PostgreSQL 15 (HA)
- Memorystore Redis 7 (Standard tier)
- VPC + Serverless VPC Connector (private DB/Redis access)
- Cloud Monitoring uptime check
- Estimated cost: ~$225/month
