/**
 * NetworkVisualizer — Visualization Layer (additive, isolated state domain).
 *
 * Renders the live mesh topology as an interactive SVG graph.
 * Subscribes to WS events for real-time packet animations.
 *
 * Visual state system:
 *   Node ACTIVE  → green pulse animation
 *   Node DOWN    → red × marker
 *   Node on hop  → blue glow + pulsing ring
 *   Edge active  → animated dashed stroke with fading trail
 *   Edge normal  → dim gray
 *
 * Animation engine:
 *   - Frame-based using CSS animation + React state
 *   - Event-queued: each MESSAGE_HOP animates for 900ms then fades
 *   - Deterministic: same events → same visual output
 *   - No blocking: all animations are CSS-driven off the main thread
 *
 * Props:
 *   wsEvents  — event array from parent (read-only subscriber)
 *   wsStatus  — WS connection status string
 *   networkId — optional: if set, displays this network; else shows picker
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import client from '../../api'

const W = 720
const H = 480
const NODE_R = 14
const PAD = 56
const POLL_MS = 4000
const HOP_DURATION_MS = 900

function scalePositions(nodes) {
  if (!nodes.length) return nodes
  const xs = nodes.map((n) => n.x)
  const ys = nodes.map((n) => n.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const rx = maxX - minX || 1
  const ry = maxY - minY || 1
  return nodes.map((n) => ({
    ...n,
    sx: PAD + ((n.x - minX) / rx) * (W - PAD * 2),
    sy: PAD + ((n.y - minY) / ry) * (H - PAD * 2),
  }))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NodeCircle({ node, isHop, isOnRoute }) {
  const status = node.status === 'DOWN' ? 'down' : isHop ? 'hop' : isOnRoute ? 'route' : 'active'
  const colors = {
    active: { fill: '#3fb950', stroke: '#3fb950' },
    hop:    { fill: '#58a6ff', stroke: '#58a6ff' },
    route:  { fill: '#d29922', stroke: '#d29922' },
    down:   { fill: '#f85149', stroke: '#f85149' },
  }
  const { fill, stroke } = colors[status]

  return (
    <g>
      {/* Outer pulse ring for active/hop nodes */}
      {status !== 'down' && (
        <circle
          cx={node.sx} cy={node.sy}
          r={NODE_R + (isHop ? 10 : 5)}
          fill="none"
          stroke={stroke}
          strokeWidth={1}
          opacity={isHop ? 0.5 : 0.2}
          style={isHop ? { animation: 'pulse-ring 0.9s ease-out' } : {}}
        />
      )}

      {/* Core circle */}
      <circle
        cx={node.sx} cy={node.sy}
        r={NODE_R}
        fill={fill}
        fillOpacity={status === 'down' ? 0.1 : 0.15}
        stroke={stroke}
        strokeWidth={isHop ? 2.5 : 1.5}
      />

      {/* DOWN indicator */}
      {status === 'down' && (
        <g>
          <line x1={node.sx - 5} y1={node.sy - 5} x2={node.sx + 5} y2={node.sy + 5} stroke="#f85149" strokeWidth={1.5} />
          <line x1={node.sx + 5} y1={node.sy - 5} x2={node.sx - 5} y2={node.sy + 5} stroke="#f85149" strokeWidth={1.5} />
        </g>
      )}

      {/* Label */}
      <text
        x={node.sx} y={node.sy + 4}
        textAnchor="middle"
        fill={stroke}
        fontSize={8}
        fontFamily="monospace"
        opacity={0.9}
      >
        {(node.name || node.id || '').slice(0, 7)}
      </text>

      {/* Latency sub-label */}
      <text
        x={node.sx} y={node.sy + NODE_R + 10}
        textAnchor="middle"
        fill="#8b949e"
        fontSize={7}
        fontFamily="monospace"
      >
        {node.latency_ms ? `${node.latency_ms}ms` : ''}
      </text>
    </g>
  )
}

function EdgeLine({ n1, n2, isActive, weight }) {
  const mid = { x: (n1.sx + n2.sx) / 2, y: (n1.sy + n2.sy) / 2 }
  return (
    <g>
      <line
        x1={n1.sx} y1={n1.sy}
        x2={n2.sx} y2={n2.sy}
        stroke={isActive ? '#58a6ff' : '#30363d'}
        strokeWidth={isActive ? 2 : 1}
        opacity={isActive ? 1 : 0.45}
        strokeDasharray={isActive ? '6 3' : undefined}
        style={isActive ? { animation: 'march 0.4s linear infinite' } : {}}
      />
      {/* Weight label on active edges */}
      {isActive && weight != null && (
        <text x={mid.x} y={mid.y - 4} textAnchor="middle" fill="#58a6ff" fontSize={7} fontFamily="monospace">
          {weight}ms
        </text>
      )}
    </g>
  )
}

// ── Network selector ──────────────────────────────────────────────────────────

function NetworkPicker({ value, onChange }) {
  const [networks, setNetworks] = useState([])

  useEffect(() => {
    client.get('/network/list').then((r) => setNetworks(r.data)).catch(() => {})
  }, [])

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-mesh-muted">Network</span>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="input text-xs py-1"
      >
        <option value="">— select network —</option>
        {networks.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name} ({n.active_nodes}/{n.node_count} up)
          </option>
        ))}
      </select>
      <button
        onClick={() => client.get('/network/list').then((r) => setNetworks(r.data)).catch(() => {})}
        className="text-xs text-mesh-muted hover:text-gray-100 transition-colors"
        title="Refresh"
      >
        ↺
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NetworkVisualizer({ wsEvents = [], wsStatus, networkId: propNetworkId }) {
  const [networkId, setNetworkId] = useState(propNetworkId || null)
  const [nodes, setNodes] = useState([])
  const [links, setLinks] = useState([])
  const [activeHops, setActiveHops] = useState([]) // [{from, to, ts}]
  const [activeRoute, setActiveRoute] = useState([]) // node ids on last computed route
  const hopTimers = useRef([])

  // Sync prop changes
  useEffect(() => {
    if (propNetworkId) setNetworkId(propNetworkId)
  }, [propNetworkId])

  // Poll network state
  const fetchState = useCallback(async () => {
    if (!networkId) return
    try {
      const res = await client.get(`/network/state/${networkId}`)
      setNodes(scalePositions(res.data.nodes))
      setLinks(res.data.links)
    } catch { /* ignore — network may not exist yet */ }
  }, [networkId])

  useEffect(() => {
    if (!networkId) { setNodes([]); setLinks([]); return }
    fetchState()
    const id = setInterval(fetchState, POLL_MS)
    return () => clearInterval(id)
  }, [fetchState, networkId])

  // Process incoming WS events
  useEffect(() => {
    if (!wsEvents.length) return
    const latest = wsEvents[wsEvents.length - 1]

    if (latest.event_type === 'MESSAGE_HOP' || latest.event_type === 'hop') {
      const hop = { from: latest.from, to: latest.to, ts: Date.now() }
      setActiveHops((prev) => [...prev, hop])
      const timer = setTimeout(() => {
        setActiveHops((prev) => prev.filter((h) => h.ts !== hop.ts))
      }, HOP_DURATION_MS)
      hopTimers.current.push(timer)
    }

    if (latest.event_type === 'ROUTE_COMPUTED' || latest.event_type === 'ROUTE_RECOMPUTED') {
      setActiveRoute(latest.path || [])
      const timer = setTimeout(() => setActiveRoute([]), 5000)
      hopTimers.current.push(timer)
    }

    if (latest.event_type === 'NODE_DOWN' || latest.event_type === 'NODE_RECOVERED') {
      // Trigger a fresh poll to reflect status change
      fetchState()
    }
  }, [wsEvents, fetchState])

  useEffect(() => {
    return () => hopTimers.current.forEach(clearTimeout)
  }, [])

  // Derive active hop set for edge + node coloring
  const hopSet = useMemo(() => {
    const s = new Set()
    activeHops.forEach(({ from, to }) => { s.add(`${from}:${to}`); s.add(`${to}:${from}`) })
    return s
  }, [activeHops])

  const hopNodes = useMemo(() => {
    const s = new Set()
    activeHops.forEach(({ from, to }) => { s.add(from); s.add(to) })
    return s
  }, [activeHops])

  const routeSet = useMemo(() => new Set(activeRoute), [activeRoute])

  // Build link weight map
  const linkWeightMap = useMemo(() => {
    const m = {}
    links.forEach((l) => {
      m[`${l.source_id}:${l.target_id}`] = l.weight
      if (l.bidirectional) m[`${l.target_id}:${l.source_id}`] = l.weight
    })
    return m
  }, [links])

  // Build node id → scaled node map
  const nodeMap = useMemo(() => {
    const m = {}
    nodes.forEach((n) => { m[n.id] = n })
    return m
  }, [nodes])

  const upCount = nodes.filter((n) => n.status === 'UP').length

  return (
    <div className="space-y-4">
      {/* Injected CSS animations */}
      <style>{`
        @keyframes pulse-ring {
          0%   { r: ${NODE_R + 4}; opacity: 0.7; }
          100% { r: ${NODE_R + 18}; opacity: 0; }
        }
        @keyframes march {
          to { stroke-dashoffset: -18; }
        }
      `}</style>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-gray-100">Network Visualizer</h2>
        <div className="flex items-center gap-3">
          <NetworkPicker value={networkId} onChange={setNetworkId} />
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${wsStatus === 'connected' ? 'bg-mesh-green animate-pulse' : 'bg-mesh-muted'}`} />
            <span className="text-mesh-muted">WS {wsStatus}</span>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <svg
          width={W}
          height={H}
          className="w-full bg-mesh-bg"
          viewBox={`0 0 ${W} ${H}`}
          style={{ maxHeight: '520px' }}
        >
          {/* Grid dots */}
          {Array.from({ length: 13 }, (_, i) =>
            Array.from({ length: 9 }, (_, j) => (
              <circle key={`g${i}-${j}`}
                cx={i * (W / 12)} cy={j * (H / 8)}
                r={1} fill="#1c2128" />
            ))
          )}

          {/* Edges */}
          {links.map((l) => {
            const n1 = nodeMap[l.source_id]
            const n2 = nodeMap[l.target_id]
            if (!n1 || !n2) return null
            const key = `${l.source_id}:${l.target_id}`
            const isActive = hopSet.has(key)
            return (
              <EdgeLine key={l.id} n1={n1} n2={n2} isActive={isActive}
                weight={isActive ? linkWeightMap[key] : null} />
            )
          })}

          {/* Nodes */}
          {nodes.map((n) => (
            <NodeCircle
              key={n.id}
              node={n}
              isHop={hopNodes.has(n.id)}
              isOnRoute={routeSet.has(n.id)}
            />
          ))}

          {/* Empty state */}
          {nodes.length === 0 && (
            <text x={W / 2} y={H / 2} textAnchor="middle"
              fill="#8b949e" fontSize={13} fontFamily="monospace">
              {networkId ? 'Loading network…' : 'Select a network to visualize'}
            </text>
          )}
        </svg>
      </div>

      {/* Legend + stats */}
      <div className="flex flex-wrap gap-5 text-xs text-mesh-muted">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-mesh-green" /> Active Node</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-mesh-red" /> DOWN</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-mesh-accent" /> Packet Hop</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-mesh-yellow" /> Computed Route</span>
        {nodes.length > 0 && (
          <span className="ml-auto">
            {upCount}/{nodes.length} nodes UP · {links.length} links · polling {POLL_MS / 1000}s
          </span>
        )}
      </div>
    </div>
  )
}
