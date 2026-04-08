#!/usr/bin/env bash
# =============================================================================
# MeshEngine — Full Demo Script
#
# Demonstrates:
#   1. Create a 6-node mesh network
#   2. Route message A → F  (path: A → B → D → F)
#   3. Inject failure on node B
#   4. Self-healing reroute A → F  (new path: A → C → D → F)
#
# Prerequisites: jq, curl, running MeshEngine stack (docker compose up)
# =============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

log()    { echo -e "${CYAN}[MESH]${RESET} $*"; }
ok()     { echo -e "${GREEN}[OK]${RESET}   $*"; }
warn()   { echo -e "${YELLOW}[WARN]${RESET} $*"; }
header() { echo -e "\n${BOLD}═══════════════════════════════════════════${RESET}"; echo -e "${BOLD}  $*${RESET}"; echo -e "${BOLD}═══════════════════════════════════════════${RESET}"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' is required but not installed."; exit 1; }
}
require_cmd curl
require_cmd jq

# ─── Health check ──────────────────────────────────────────────────────────
header "0. Health Check"
HEALTH=$(curl -sf "${BASE_URL}/health") || { echo "ERROR: Control Plane not reachable at ${BASE_URL}"; exit 1; }
ok "Control Plane healthy: $(echo "$HEALTH" | jq -r '.status')"

# ─── Step 1: Create 6-node network ─────────────────────────────────────────
header "1. Creating 6-Node Mesh Network"
log "Nodes: A(0,50)  B(100,10)  C(100,100)  D(200,50)  E(150,25)  F(300,50)"
log "Link threshold: 150 units | Edge weight = distance × 0.5 ms"

CREATE_RESP=$(curl -sf -X POST "${BASE_URL}/network/create" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "demo-network",
    "link_threshold": 150.0,
    "nodes": [
      {"name": "node-A", "x": 0,   "y": 50,  "latency_ms": 5},
      {"name": "node-B", "x": 100, "y": 10,  "latency_ms": 5},
      {"name": "node-C", "x": 100, "y": 100, "latency_ms": 5},
      {"name": "node-D", "x": 200, "y": 50,  "latency_ms": 5},
      {"name": "node-E", "x": 150, "y": 25,  "latency_ms": 5},
      {"name": "node-F", "x": 300, "y": 50,  "latency_ms": 5}
    ]
  }')

NETWORK_ID=$(echo "$CREATE_RESP" | jq -r '.id')
ok "Network created: ${NETWORK_ID}"
echo "$CREATE_RESP" | jq '{
  id,
  name,
  nodes: [.nodes[] | {name, x, y, status}],
  link_count: (.links | length),
  links: [.links[] | {source_id, target_id, weight}]
}'

# Extract node IDs by name
get_node_id() {
  echo "$CREATE_RESP" | jq -r --arg name "$1" '.nodes[] | select(.name == $name) | .id'
}

NODE_A=$(get_node_id "node-A")
NODE_B=$(get_node_id "node-B")
NODE_C=$(get_node_id "node-C")
NODE_D=$(get_node_id "node-D")
NODE_F=$(get_node_id "node-F")

log "Node IDs: A=${NODE_A}  B=${NODE_B}  C=${NODE_C}  D=${NODE_D}  F=${NODE_F}"

# ─── Step 2: Initial route A → F ───────────────────────────────────────────
header "2. Sending Message: A → F (no failures)"
log "Expected path: A → B → D → F  (cheapest Dijkstra path)"

MSG_RESP=$(curl -sf -X POST "${BASE_URL}/message/send" \
  -H "Content-Type: application/json" \
  -d "{
    \"network_id\": \"${NETWORK_ID}\",
    \"source_id\": \"${NODE_A}\",
    \"destination_id\": \"${NODE_F}\",
    \"payload\": \"HELLO from drone A to drone F\"
  }")

echo "$MSG_RESP" | jq '{
  message_id: .id,
  status,
  path,
  hop_count: .hops_completed,
  total_latency_ms,
  hop_log: [.hop_log[] | {hop, from_node_id, to_node_id, link_latency_ms, cumulative_latency_ms}]
}'

INITIAL_PATH=$(echo "$MSG_RESP" | jq -r '.path | join(" → ")')
ok "Message delivered via: ${INITIAL_PATH}"

# ─── Step 3: Inject node B failure ─────────────────────────────────────────
header "3. Injecting Node Failure: node-B goes DOWN"
warn "Simulating drone B hardware failure / communication blackout"

FAIL_RESP=$(curl -sf -X POST "${BASE_URL}/node/fail/${NODE_B}")
echo "$FAIL_RESP" | jq '{id, name, status}'
warn "Node B is now: $(echo "$FAIL_RESP" | jq -r '.status')"

# ─── Step 4: Rerouted message A → F ────────────────────────────────────────
header "4. Resending Message A → F (self-healing reroute)"
log "Expected new path: A → C → D → F  (B excluded from Dijkstra graph)"

REROUTE_RESP=$(curl -sf -X POST "${BASE_URL}/message/send" \
  -H "Content-Type: application/json" \
  -d "{
    \"network_id\": \"${NETWORK_ID}\",
    \"source_id\": \"${NODE_A}\",
    \"destination_id\": \"${NODE_F}\",
    \"payload\": \"REROUTED message from A to F\"
  }")

echo "$REROUTE_RESP" | jq '{
  message_id: .id,
  status,
  path,
  hop_count: .hops_completed,
  total_latency_ms,
  hop_log: [.hop_log[] | {hop, from_node_id, to_node_id, link_latency_ms, cumulative_latency_ms}]
}'

REROUTED_PATH=$(echo "$REROUTE_RESP" | jq -r '.path | join(" → ")')
ok "Rerouted message delivered via: ${REROUTED_PATH}"

# ─── Step 5: Full simulation (automated) ───────────────────────────────────
header "5. Full Automated Simulation (recover B first)"
log "Recovering node B before next simulation run..."

# Recover B so simulation has clean baseline
curl -sf -X POST "${BASE_URL}/node/recover/${NODE_B}" | jq '{id, name, status}'

log "Running simulation: A→F with B failure injected automatically"

SIM_RESP=$(curl -sf -X POST "${BASE_URL}/simulation/start" \
  -H "Content-Type: application/json" \
  -d "{
    \"network_id\": \"${NETWORK_ID}\",
    \"source_id\": \"${NODE_A}\",
    \"destination_id\": \"${NODE_F}\",
    \"payload\": \"SIMULATION PAYLOAD\",
    \"fail_nodes\": [\"${NODE_B}\"]
  }")

echo "$SIM_RESP" | jq '{
  simulation_id,
  status,
  initial_path,
  initial_latency_ms,
  rerouted,
  final_path,
  final_latency_ms,
  failed_nodes,
  message_id,
  explanation
}'

ok "Simulation complete."

# ─── Step 6: Network state summary ─────────────────────────────────────────
header "6. Final Network State"
curl -sf "${BASE_URL}/network/state/${NETWORK_ID}" | jq '{
  network_id,
  node_count,
  active_nodes,
  down_nodes,
  link_count,
  nodes: [.nodes[] | {name: .name, status: .status}]
}'

# ─── Summary ────────────────────────────────────────────────────────────────
header "Demo Summary"
echo -e "${GREEN}"
cat << 'EOF'
  ┌──────────────────────────────────────────────────────────┐
  │  MeshEngine Self-Healing Demo — COMPLETED                │
  │                                                          │
  │  Before failure:  A → B → D → F  (optimal path)         │
  │  Node B fails:    ██ partitioned from path               │
  │  After reroute:   A → C → D → F  (self-healed)          │
  │                                                          │
  │  Dijkstra automatically avoided the failed node and      │
  │  found the next best path in real time.                  │
  └──────────────────────────────────────────────────────────┘
EOF
echo -e "${RESET}"
ok "Full API reference: ${BASE_URL}/docs"
ok "Real-time stream:   ws://localhost:8000/ws/stream"
