# MeshEngine — Architecture

## System Overview

MeshEngine is a production-grade distributed mesh network simulation platform. It simulates self-healing drone mesh networks: routing messages across nodes, injecting failures, computing Dijkstra reroutes in real time, and streaming all events to connected clients.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MeshEngine v2.0                                │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Frontend (React 18)                          │  │
│  │                                                                      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │  │
│  │  │  Sim Lab │  │Visualizer│  │Observabil│  │ Failure  │  ← NEW     │  │
│  │  │(Control) │  │(Viz)     │  │(Observe) │  │ Control  │            │  │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │  │
│  │       └─────────────┴──────────────┴──────────────┘                │  │
│  │                           useWebSocket hook (shared)               │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │     Existing: LiveViz │ AllNodes │ CreateNode │ History ...   │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────┬─────────────────────────────────────────┘  │
│                             │ HTTP + WebSocket                             │
│  ┌──────────────────────────▼─────────────────────────────────────────┐  │
│  │                    FastAPI Control Plane                            │  │
│  │                                                                     │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐   │  │
│  │  │ network │ │  node   │ │message  │ │simulat. │ │ websocket│   │  │
│  │  │  /api   │ │  /api   │ │  /api   │ │  /api   │ │  /ws/*   │   │  │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬─────┘   │  │
│  │       │            │           │            │           │          │  │
│  │  ┌────▼────┐ ┌─────▼────┐ ┌───▼──────┐ ┌──▼─────────┐           │  │
│  │  │ Network │ │  auth/   │ │  OAuth   │ │    Lab     │  ← NEW     │  │
│  │  │ Service │ │  nodes/  │ │  /oauth  │ │   /lab     │            │  │
│  │  └────┬────┘ └─────┬────┘ └───┬──────┘ └────────────┘           │  │
│  │       │            │           │  OAuthService (new)              │  │
│  │  ┌────▼────────────▼───────────▼───────────────────────────────┐  │  │
│  │  │             Dijkstra Routing Engine                          │  │  │
│  │  │       MeshGraph · fail_node · recover_node · dijkstra()     │  │  │
│  │  └────────────────────────┬────────────────────────────────────┘  │  │
│  │                           │ emit_event()                           │  │
│  │  ┌────────────────────────▼───────────────────────────────────┐   │  │
│  │  │                    EventBus                                 │   │  │
│  │  │  Redis Pub/Sub ←──── emit_event() ────→ ConnectionManager  │   │  │
│  │  │  (mesh:message:flow, mesh:node:events, mesh:simulation:*) │   │  │
│  │  └──────────┬────────────────────────────────┬────────────────┘   │  │
│  └─────────────┼────────────────────────────────┼────────────────────┘  │
│                │                                │                         │
│  ┌─────────────▼──────┐          ┌──────────────▼──────┐                │
│  │     PostgreSQL      │          │      Node Worker     │                │
│  │  (async ORM)        │          │  (Redis subscriber)  │                │
│  │  Networks, Nodes,   │          │  Execution plane     │                │
│  │  Links, Messages,   │          │  node-worker/        │                │
│  │  Users, History     │          └─────────────────────┘                │
│  └─────────────────────┘                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Boundary Layers

| Layer | Components | Responsibility |
|-------|-----------|----------------|
| **Simulation** | NetworkService, RoutingService, SimulationService, Dijkstra | Topology, routing computation, message delivery |
| **Visualization** | NetworkVisualizer.jsx | Renders topology + animates WS events |
| **Control** | SimulationLab.jsx, Lab API | UI for creating networks, running simulations |
| **Observability** | Observability.jsx | Monitors WS events, route insights, system health |
| **Failure** | FailureControl.jsx, /node/fail, /node/recover | Failure injection and recovery |
| **Auth** | core/auth.py, OAuthService, api/oauth.py | JWT issuance, OAuth 2.0 mediation |

---

## Event-Driven Architecture

All state changes flow through a single dual-publish event bus:

```
Service.method()
    └─→ emit_event(channel_key, event_dict)
            ├─→ redis.publish(channel)   → /ws/stream + node-workers
            └─→ ConnectionManager.broadcast()  → /ws/simulation
```

### Event Types

| Event | Channel | Trigger |
|-------|---------|---------|
| `SIMULATION_STARTED` | simulation | POST /simulation/start |
| `ROUTE_COMPUTED` | simulation | Initial Dijkstra |
| `NODE_DOWN` | node | /node/fail or fail_nodes in simulation |
| `NODE_RECOVERED` | node | /node/recover |
| `ROUTE_RECOMPUTED` | simulation | Self-healing reroute |
| `SIMULATION_COMPLETED` | simulation | Successful message delivery |
| `SIMULATION_FAILED` | simulation | No route after failure |
| `MESSAGE_SENT` | message | Message enqueued |
| `MESSAGE_HOP` | message | Packet traverses an edge |
| `MESSAGE_DELIVERED` | message | Destination reached |
| `MESSAGE_FAILED` | message | Delivery failure |

---

## OAuth 2.0 Flow

```
Frontend                    Backend                     Provider
   │                           │                           │
   │─ GET /oauth/url/google ──→│                           │
   │←── { url: "https://..." } │                           │
   │                           │                           │
   │──── redirect to url ─────────────────────────────────→│
   │←──────── code + state ───────────────────────────────│
   │                           │                           │
   │─ POST /oauth/callback ───→│                           │
   │  { provider, code, uri }  │── POST /token ───────────→│
   │                           │←── access_token ─────────│
   │                           │── GET /userinfo ──────────→│
   │                           │←── { sub, email, name } ─│
   │                           │                           │
   │                           │── upsert User (DB) ──→ PostgreSQL
   │                           │── create_access_token()   │
   │←── { access_token: JWT } ─│                           │
   │                           │                           │
   │ store JWT, navigate /dashboard                        │
```

---

## Routing Engine

Dijkstra runs from a fresh graph snapshot per request:

```python
graph = MeshGraph()
for node in network.nodes:
    graph.add_node(node.id)
    if node.status == "DOWN":
        graph.fail_node(node.id)  # Excluded from traversal

for link in network.links:
    graph.add_edge(link.source_id, link.target_id, link.weight)

path, cost = graph.dijkstra(source_id, destination_id)
```

**Key properties:**
- Stateless per request — no shared mutable graph
- DOWN nodes are removed from the graph, not soft-skipped
- Edge weight = Euclidean distance × 0.5ms (configurable)
- Deterministic: same topology → same path (tie-break on node_id)

---

## Database Schema

```
Network ─── has many ──→ Node
        └── has many ──→ Link (source_node ↔ target_node, bidirectional flag)
        └── has many ──→ Message

User ──────────────────→ (password or OAuth upsert)
ActionHistory ─────────→ User (actor)
```

---

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| API | FastAPI | 0.111.0 |
| ORM | SQLAlchemy async | 2.0.x |
| DB | PostgreSQL | 15 |
| Cache/PubSub | Redis | 7 |
| Auth | python-jose + bcrypt | latest |
| OAuth HTTP | httpx | 0.27.0 |
| Frontend | React | 18.3.x |
| Build | Vite | 5.3.x |
| Styles | Tailwind CSS | 3.4.x |
| Container | Docker + Compose | 3.9 |

---

## Failure Modes and Degradation

| Failure | Behavior |
|---------|---------|
| Redis down | Events lost; WS stream disconnects; routing still works via DB |
| PostgreSQL down | All API calls fail; WS stream stays connected |
| WebSocket disconnect | Frontend auto-reconnects with exponential backoff |
| OAuth provider down | POST /oauth/callback returns 502; password login unaffected |
| New tab crash | Existing tabs unaffected (isolated state domains) |
| Lab deploy failure | Error displayed in UI; no state corruption |
