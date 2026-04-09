# About MeshEngine

## What It Is

MeshEngine is a backend simulation platform for modelling self-healing drone mesh networks. Given a set of nodes placed on a 2D grid, it:

- Auto-generates weighted communication links between nearby nodes
- Routes messages hop-by-hop using Dijkstra's shortest-path algorithm
- Propagates real-time failure and recovery events via Redis Pub/Sub
- Streams live topology changes to connected clients over WebSocket

It is not a networking library or a real radio-frequency simulator. It is a controlled environment for testing routing logic, failure scenarios, and real-time event pipelines.

---

## Why It Was Built

Distributed systems research and defence/disaster-recovery planning increasingly rely on drone swarms that form ad-hoc mesh networks. These networks must:

- Continue operating when individual nodes fail unexpectedly
- Re-route traffic around failures without manual intervention (self-healing)
- Give operators real-time visibility into the topology

Existing simulation tools are either too domain-specific (RF propagation simulators) or too general (graph libraries with no async event model). MeshEngine fills that gap: it is purpose-built for async, event-driven mesh routing simulation with an HTTP + WebSocket interface.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                          CONTROL PLANE                             │
│                      (FastAPI + PostgreSQL)                        │
│                                                                    │
│  /network  ─┐                                                      │
│  /node     ─┼──▶  NetworkService / RoutingService / MessageService │
│  /message  ─┘            │                                         │
│                    Dijkstra Engine                                 │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ publish events
                  ┌────────▼────────┐
                  │      Redis      │
                  │  Pub/Sub topics │
                  └────────┬────────┘
                           │ subscribe
           ┌───────────────┼───────────────┐
           │               │               │
     ┌─────▼──────┐  ┌─────▼──────┐  ┌────▼──────────┐
     │ NodeWorker │  │ NodeWorker │  │  WebSocket     │
     │ (worker-1) │  │ (worker-N) │  │  /ws/stream    │
     └────────────┘  └────────────┘  └────────────────┘
```

---

## Key Components

### Control Plane (`control-plane/`)

FastAPI application. Owns the REST API, persistence, and routing logic.

| Module | Responsibility |
|---|---|
| `app/api/network.py` | Create networks, inspect topology |
| `app/api/node.py` | Inject failures / recoveries |
| `app/api/message.py` | Send messages, retrieve route logs |
| `app/api/simulation.py` | Batch simulation runs |
| `app/api/websocket.py` | Live event stream (WebSocket) |
| `app/api/auth.py` | User registration + JWT login |
| `app/api/nodes.py` | Authenticated node CRUD |
| `app/api/history.py` | Per-user action log |
| `app/engine/dijkstra.py` | Failure-aware Dijkstra |
| `app/core/redis_client.py` | Shared Redis connection |
| `app/core/connection_manager.py` | WebSocket fan-out |

### Routing Engine (`app/engine/dijkstra.py`)

Pure Python implementation of Dijkstra's algorithm operating on an adjacency dictionary. Nodes with `status=DOWN` are excluded from the graph before traversal. Complexity: O((V+E) log V).

### Redis Pub/Sub Layer

Three channels:
- `mesh:message:flow` — hop-by-hop delivery events
- `mesh:node:events` — failure and recovery notifications
- `mesh:simulation:*` — simulation start/end and progress frames

### Node Workers (`node-worker/`)

Async Python processes that subscribe to Redis channels and log events. In a real deployment, these would represent actual edge-compute units. In simulation, they demonstrate that the event bus decouples producers from consumers correctly.

### Persistence (PostgreSQL)

SQLAlchemy async ORM. Four tables:
- `networks` — topology metadata
- `nodes` — drone node positions and status
- `links` — weighted edges between nodes
- `messages` — message history and route logs

Additional tables added for auth/history:
- `users` — user accounts
- `action_history` — per-user action audit log

---

## Design Decisions

**FastAPI over Flask/Django** — native async support is essential for WebSocket fan-out and concurrent Pub/Sub subscriptions without a thread pool.

**Dijkstra over A\*** — simpler to reason about and sufficient for small-to-medium grids (< 500 nodes). A* would be preferable for very large grids with meaningful heuristics.

**Redis Pub/Sub over Kafka/RabbitMQ** — Redis is already a dependency (for caching/rate limiting). Pub/Sub keeps the dependency count low and delivers sub-millisecond fanout for simulation purposes. For production scale, Kafka would be the right replacement.

**PostgreSQL over SQLite** — real async support (asyncpg driver). SQLite has limited async story and no concurrent writes.

**JWT over session cookies** — stateless auth suits a horizontally-scalable API; no shared session store needed.

**In-process rate limiting with Redis counters** — avoids an external API gateway for demo/development. Production deployments should push this to Nginx or a CDN.

---

## Limitations

1. **No real RF propagation** — links are modelled by Euclidean distance only. Signal interference, obstacles, and power levels are not simulated.

2. **Single-region Redis** — Pub/Sub is not replicated. A Redis failure silently drops events.

3. **Dijkstra recalculates on every send** — there is no persistent routing table. For dense networks (> 1000 nodes) this is a bottleneck.

4. **Node workers are stateless loggers** — in a real system, workers would execute payloads, maintain state, and report back. Here they only demonstrate subscription patterns.

5. **No TLS between internal services** — suitable for local/demo deployments only.

6. **JWT is not revocable** — a stolen token is valid until expiry. A token blocklist (Redis SET) is the standard fix; not yet implemented.

---

## Future Scope

| Area | Enhancement |
|---|---|
| Routing | Adaptive routing with real-time link-weight updates based on congestion |
| Workers | Stateful workers that execute arbitrary payloads (Python, WASM, containers) |
| Persistence | Time-series storage (TimescaleDB) for latency and throughput analytics |
| Auth | OAuth 2.0 / OIDC integration, token revocation |
| Deployment | Helm chart for Kubernetes, Terraform for GCP provisioning |
| Simulation | Probabilistic failure injection (Chaos Monkey style) |
| Visualization | 3D topology view, animated message traces |
| Multi-network | Cross-network message bridging (gateway nodes) |
