# MeshEngine — User Guide

## Getting Started

### 1. Access the Platform

Navigate to `http://localhost:3000` (dev) or your deployed frontend URL.

### 2. Create an Account

**Option A — Username + Password:**
1. Click **Register** on the home page
2. Enter a username, email, and password
3. You are automatically logged in

**Option B — OAuth (Google or GitHub):**
1. Click **Sign in with Google** or **Sign in with GitHub** on the Login page
2. Complete the provider authorization flow
3. Redirected back and authenticated automatically

> OAuth requires backend environment variables to be configured. See DEPLOYMENT_GUIDE.md.

---

## Dashboard Navigation

The dashboard has 10 tabs:

| Tab | Purpose |
|-----|---------|
| Live Visualization | SVG network graph with WebSocket hops |
| All Nodes | Table of registered nodes with block/start |
| Create Node | Create a new node record |
| Update Node | Modify node properties |
| Delete Node | Remove a node (with confirmation) |
| History | Action history for your account |
| **Simulation Lab** | Deploy networks, run simulations, inject failures |
| **Network Visualizer** | Full graph renderer with route animation |
| **Observability** | System status, event timeline, route insights |
| **Failure Control** | Per-node failure injection and recovery |

Tabs marked **bold** are new in v2.0.

---

## Simulation Lab

### Running a Preset Scenario

1. Open the **Simulation Lab** tab
2. Click **Deploy + Load** on any preset
3. The network is created and loaded automatically
4. In the **Message Sender** panel, source and destination are pre-selected
5. Optionally toggle failure injection nodes (red buttons)
6. Click **Run Simulation**
7. Results appear inline with path, latency, hops, and routing explanation

### Available Presets

| Preset | Nodes | Demonstrates |
|--------|-------|-------------|
| Dense Grid | 9 (3×3) | Multiple redundant paths, hub failure reroute |
| Sparse Web | 6 | Single bridge failure → partition |
| Star Hub | 6 (1+5) | Hub-and-spoke fragility |
| Mid-Route Failure | 5 | In-simulation failure injection |

### Custom Network

1. Under **Custom Network Builder**, select Grid or Random layout
2. Set rows/columns (grid) or node count (random)
3. Set link threshold (Euclidean distance units)
4. Click **Create Network**
5. Use the **Message Sender** to configure and run a simulation

### Reading Simulation Results

```
Initial path: [A → B → C → D]
Failed nodes:  [B]

Self-healing reroute activated.
New path: [A → E → F → D]
```

The **ROUTING EXPLANATION** block translates Dijkstra decisions into plain language:
- Which nodes were excluded due to DOWN status
- Whether reroute was needed (failed node was on the active path)
- Total latency and hop count for each path

---

## Network Visualizer

### Selecting a Network

1. Open **Network Visualizer**
2. Use the **Network** dropdown to select any deployed network
3. The topology renders immediately from the API
4. WebSocket events animate packet hops in real time

### Reading the Graph

| Visual | Meaning |
|--------|---------|
| Green circle | Node UP |
| Red × | Node DOWN |
| Blue glow + ring | Node is currently part of a packet hop |
| Yellow glow | Node is on the last computed route |
| Animated dashed edge | Active packet traversal |
| Edge label (ms) | Link latency during active hop |

When you run a simulation in the Lab tab:
1. `ROUTE_COMPUTED` event → route path highlighted in yellow for 5s
2. `MESSAGE_HOP` events → each edge/node pair animates blue for 900ms
3. `NODE_DOWN` events → node turns red immediately

---

## Observability

### System Status Panel

Polls `/health` and `/network/list` every 5 seconds:
- **WebSocket** — connection state to `/ws/simulation`
- **Backend Health** — `/health` endpoint reachability
- **WS Clients** — active WebSocket client count
- **Total / Active / DOWN Nodes** — across all networks
- **Events / min** — event rate from the WS stream

### Event Timeline

- Chronological log of all WebSocket events
- **Filter** buttons: ALL / SIMULATION / ROUTE / NODE / MESSAGE
- **Pause** button stops auto-scroll (events still accumulate)
- Shows event type, timestamp, and key fields per event type

### Route Insights

Displays the last `ROUTE_COMPUTED` or `ROUTE_RECOMPUTED` event:
- **Path** — ordered node list with → separators
- **Latency** — total path cost in ms
- **Hops** — number of edges traversed
- **Rerouted** — YES/NO
- **ROUTING ENGINE EXPLANATION** — plain-English interpretation of Dijkstra decisions

---

## Failure Control

### Injecting a Failure

1. Open **Failure Control**
2. Select a network from the dropdown
3. Click **Fail** on any UP node
4. The node immediately turns DOWN in the grid
5. A `NODE_DOWN` event is emitted — visible in Observability and Simulation Lab

### Recovering a Node

- Click **Recover** on any DOWN node, or
- Click **Recover All** to restore all DOWN nodes at once

### Impact Analysis

The panel automatically computes and displays:
- **HEALTHY** — all nodes UP, full Dijkstra coverage
- **IMPAIRED** — 1+ nodes DOWN, reroutes possible
- **DEGRADED** — ≥25% nodes DOWN, partition risk
- **CRITICAL** — ≥50% nodes DOWN, likely partition

The **DIJKSTRA IMPACT** block explains which nodes are excluded from the routing graph.

---

## WebSocket Connection

The WS indicator (small dot) appears in the dashboard top bar:
- **Green pulse** — connected to `/ws/simulation`
- **Yellow** — connecting / reconnecting
- **Gray** — disconnected

On disconnect, the client auto-reconnects with exponential backoff (1s → 2s → 4s… max 30s). All new tabs will receive buffered events when reconnection completes.

---

## Keyboard Shortcuts

No custom keyboard shortcuts defined. Tab navigation is mouse/pointer-driven.

---

## FAQ

**Q: I deployed a preset but the graph doesn't show up in Network Visualizer.**  
A: Switch to the **Network Visualizer** tab and use the dropdown to select the deployed network. If you ran it from the Lab tab, the network ID is automatically shared — just switch tabs.

**Q: Simulation returns "NO_ROUTE" after failure injection.**  
A: The network is partitioned — no path exists between source and destination with the failed nodes excluded. Use **Failure Control** to recover nodes or choose a different failure combination.

**Q: OAuth login fails with "OAuth provider communication failed".**  
A: Check that backend `OAUTH_GOOGLE_CLIENT_ID` / `OAUTH_GITHUB_CLIENT_ID` env vars are set and the redirect URI matches your provider app configuration.

**Q: Events are not appearing in the Event Timeline.**  
A: Check the WS indicator in the top bar. If disconnected, wait for reconnection. Events are only buffered after connection.
