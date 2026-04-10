# About MeshEngine

## What It Is

MeshEngine is a production-grade interactive distributed systems laboratory. It simulates self-healing drone mesh networks for disaster recovery and defence communication scenarios.

Given a set of nodes placed on a 2D coordinate grid, MeshEngine:

1. **Auto-generates a weighted graph** — links all node pairs within a configurable Euclidean distance threshold
2. **Routes messages via Dijkstra** — computes shortest paths weighted by link latency
3. **Simulates failures** — marks nodes DOWN, removes them from the routing graph
4. **Self-heals** — immediately recomputes routes around failed nodes
5. **Streams all events** — Redis Pub/Sub + WebSocket deliver every hop, failure, and reroute in real time
6. **Visualizes the topology** — interactive SVG graph with live packet animations
7. **Explains routing decisions** — plain-English explainability layer maps Dijkstra choices to system state

---

## Why It Was Built

Mesh networks are the backbone of resilient communication in environments where centralized infrastructure is unavailable or has been destroyed — disaster zones, military operations, autonomous drone swarms. Understanding how these networks route, self-heal, and degrade under failure is critical for system designers.

MeshEngine provides a safe, observable, interactive environment to:
- **Learn** distributed routing concepts visually
- **Experiment** with failure injection without real-world consequences
- **Demonstrate** self-healing properties to stakeholders
- **Validate** routing algorithms against real topology scenarios

---

## What's New in v2.0 — Interactive Lab Edition

### Simulation Lab
A full interactive control center:
- **Preset scenarios** — one-click topologies: Dense Grid, Sparse Web, Star Hub, Mid-Route Failure
- **Custom networks** — Grid and Random generators with configurable parameters
- **MessageSender** — select nodes, inject failures, run simulations, see results instantly
- **Explainability** — "Node C excluded due to DOWN status during routing computation"

### Network Visualizer
- Enhanced SVG topology renderer
- Live packet animation on WebSocket events
- Visual state system: ACTIVE (green), DOWN (red ×), HOP (blue glow), ROUTE (yellow)
- Marching-dashes edge animation during packet traversal

### Observability
- System status panel (Redis, WS, nodes, event rate)
- Filterable event timeline with 200-event buffer
- Route insights with Dijkstra explainability layer

### Failure Control
- Per-node FAIL / RECOVER buttons
- Quick actions: Fail Random, Recover All
- Impact analysis: HEALTHY / IMPAIRED / DEGRADED / CRITICAL
- Dijkstra impact explanation per failure state

### OAuth 2.0 Authentication
- Google and GitHub OAuth in addition to username/password
- Server-side code exchange — secrets never leave the backend
- Issues same JWT format — no frontend auth changes required

---

## Design Principles

### 1. Event-Driven
Every system state change emits an event. No polling the database for state. Consumers subscribe to events.

### 2. Fail-Safe Extensions
New components are isolated. If the Simulation Lab tab fails to render, the existing LiveViz and AllNodes tabs still work. If WebSocket disconnects, existing polling-based tabs are unaffected.

### 3. Observability First
Every significant operation logs a structured JSON event. The Observability tab surfaces these without any additional backend work.

### 4. Explainability by Design
The routing engine's decisions are not a black box. Every route computation includes an explanation that maps algorithmic choices (exclude DOWN nodes, minimize edge weight sum) to observable system state.

### 5. Additive Architecture
v2.0 added zero modifications to existing business logic. New features are isolated modules that consume existing APIs and events through clearly defined interfaces.

---

## Known Limitations

- **WebSocket fan-out is per-instance** — multi-instance deployments require a Redis-backed broadcast strategy for the ConnectionManager
- **Routing graph is rebuilt per request** — intentional for correctness; may be slow for very large networks (1000+ nodes)
- **In-memory rate limiter** — the sliding window uses Redis keys tied to the process; effective for single-instance but not distributed rate limiting
- **OAuth accounts and password accounts are separate** — logging in with Google creates a separate user from an existing password account with the same email (unless they share the same username marker)
- **No persistent event store** — WebSocket events are in-memory only; the event timeline resets on page refresh

---

## Future Directions

- **Graph partitioning detection** — automatically detect when the network splits into disconnected components
- **Multi-path routing** — expose k-shortest paths for redundancy analysis
- **Latency simulation** — add variable edge weights that change over time
- **Replay mode** — record and replay a simulation for training / presentation
- **Multi-tenant networks** — isolate networks per user account
- **Distributed WebSocket** — Redis-backed ConnectionManager for horizontal scaling
- **Protocol simulation** — BGP / OSPF-style convergence timing
