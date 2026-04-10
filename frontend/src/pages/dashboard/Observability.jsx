/**
 * Observability — Observability Layer (additive, isolated state domain).
 *
 * Panels:
 *   1. SystemStatusPanel  — Redis/WS health, active nodes, event rate
 *   2. EventTimeline      — Ordered event log, time-based, auto-scroll
 *   3. RouteInsightsPanel — Last route computation with explainability
 *
 * All data sourced exclusively from:
 *   - WebSocket events (prop: wsEvents)
 *   - /health endpoint (polled)
 *   - /network/list endpoint (polled)
 *
 * No modification to existing panels, state, or event emitters.
 *
 * Props:
 *   wsEvents  — rolling event array from useWebSocket hook
 *   wsStatus  — 'connected' | 'disconnected' | 'connecting' | 'error'
 */
import React, { useState, useEffect, useRef, useMemo } from 'react'
import client from '../../api'

// ── SystemStatusPanel ─────────────────────────────────────────────────────────

function SystemStatusPanel({ wsStatus, wsEvents }) {
  const [health, setHealth] = useState(null)
  const [networks, setNetworks] = useState([])
  const [lastPoll, setLastPoll] = useState(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const [hRes, nRes] = await Promise.all([
          client.get('/health'),
          client.get('/network/list'),
        ])
        setHealth(hRes.data)
        setNetworks(nRes.data)
        setLastPoll(new Date())
      } catch { /* ignore — degrade gracefully */ }
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  // Event rate: events in last 60s
  const eventsPerMin = useMemo(() => {
    const since = Date.now() - 60_000
    return wsEvents.filter((e) => {
      const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0
      return ts > since
    }).length
  }, [wsEvents])

  const totalNodes = networks.reduce((s, n) => s + n.node_count, 0)
  const activeNodes = networks.reduce((s, n) => s + n.active_nodes, 0)
  const downNodes = totalNodes - activeNodes

  const wsColor = wsStatus === 'connected' ? 'text-mesh-green' : wsStatus === 'connecting' ? 'text-mesh-yellow' : 'text-mesh-red'
  const wsIcon = wsStatus === 'connected' ? '●' : wsStatus === 'connecting' ? '◎' : '○'

  const metrics = [
    { label: 'WebSocket', value: wsIcon + ' ' + wsStatus, color: wsColor },
    { label: 'Backend Health', value: health ? '● healthy' : '○ unreachable', color: health ? 'text-mesh-green' : 'text-mesh-red' },
    { label: 'WS Clients', value: health?.ws_clients ?? '—', color: 'text-gray-100' },
    { label: 'Total Networks', value: networks.length, color: 'text-gray-100' },
    { label: 'Total Nodes', value: totalNodes, color: 'text-gray-100' },
    { label: 'Active Nodes', value: activeNodes, color: activeNodes > 0 ? 'text-mesh-green' : 'text-mesh-muted' },
    { label: 'DOWN Nodes', value: downNodes, color: downNodes > 0 ? 'text-mesh-red' : 'text-mesh-muted' },
    { label: 'Events / min', value: eventsPerMin, color: eventsPerMin > 0 ? 'text-mesh-accent' : 'text-mesh-muted' },
  ]

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-gray-100">System Status</h3>
        {lastPoll && (
          <span className="text-xs text-mesh-muted">
            Last poll: {lastPoll.toLocaleTimeString()}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map(({ label, value, color }) => (
          <div key={label} className="bg-mesh-bg rounded p-3 border border-mesh-border">
            <p className="text-xs text-mesh-muted mb-1">{label}</p>
            <p className={`text-sm font-mono font-semibold ${color}`}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── EventTimeline ─────────────────────────────────────────────────────────────

const EVENT_TYPE_COLORS = {
  SIMULATION_STARTED:   'text-mesh-accent border-mesh-accent/30 bg-mesh-accent/5',
  SIMULATION_COMPLETED: 'text-mesh-green border-mesh-green/30 bg-mesh-green/5',
  SIMULATION_FAILED:    'text-mesh-red border-mesh-red/30 bg-mesh-red/5',
  ROUTE_COMPUTED:       'text-mesh-accent border-mesh-accent/20 bg-mesh-accent/5',
  ROUTE_RECOMPUTED:     'text-mesh-yellow border-mesh-yellow/30 bg-mesh-yellow/5',
  NODE_DOWN:            'text-mesh-red border-mesh-red/30 bg-mesh-red/5',
  NODE_RECOVERED:       'text-mesh-green border-mesh-green/30 bg-mesh-green/5',
  MESSAGE_SENT:         'text-gray-300 border-mesh-border bg-mesh-surface/30',
  MESSAGE_HOP:          'text-mesh-muted border-mesh-border bg-mesh-surface/20',
  MESSAGE_DELIVERED:    'text-mesh-green border-mesh-green/20 bg-mesh-green/5',
  MESSAGE_FAILED:       'text-mesh-red border-mesh-red/20 bg-mesh-red/5',
}

function EventTimeline({ wsEvents }) {
  const bottomRef = useRef(null)
  const [filter, setFilter] = useState('ALL')
  const [paused, setPaused] = useState(false)

  const FILTER_OPTIONS = ['ALL', 'SIMULATION', 'ROUTE', 'NODE', 'MESSAGE']

  const filtered = useMemo(() => {
    const evts = wsEvents.filter((e) => e.event_type !== 'PING' && e.event_type !== 'CONNECTED')
    if (filter === 'ALL') return evts
    return evts.filter((e) => e.event_type?.startsWith(filter))
  }, [wsEvents, filter])

  // Auto-scroll to bottom when new events arrive (unless paused)
  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [filtered, paused])

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-bold text-gray-100">Event Timeline</h3>
        <div className="flex items-center gap-2">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                filter === f
                  ? 'border-mesh-accent text-mesh-accent bg-mesh-accent/10'
                  : 'border-mesh-border text-mesh-muted hover:text-gray-100'
              }`}
            >
              {f}
            </button>
          ))}
          <button
            onClick={() => setPaused((p) => !p)}
            className={`px-2 py-0.5 text-xs rounded border transition-colors ${
              paused
                ? 'border-mesh-yellow text-mesh-yellow bg-mesh-yellow/10'
                : 'border-mesh-border text-mesh-muted hover:text-gray-100'
            }`}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <span className="text-xs text-mesh-muted">{filtered.length} events</span>
        </div>
      </div>

      <div className="h-72 overflow-y-auto space-y-1 pr-1">
        {filtered.length === 0 && (
          <p className="text-xs text-mesh-muted text-center py-8">
            No events yet. Run a simulation or wait for network activity.
          </p>
        )}
        {filtered.map((e, i) => {
          const colorClass = EVENT_TYPE_COLORS[e.event_type] || 'text-mesh-muted border-mesh-border bg-mesh-surface/20'
          const ts = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '--'
          return (
            <div key={i} className={`flex items-start gap-2 p-2 rounded border text-xs ${colorClass}`}>
              <span className="font-mono text-mesh-muted whitespace-nowrap shrink-0">{ts}</span>
              <span className="font-semibold whitespace-nowrap shrink-0">{e.event_type}</span>
              <span className="text-mesh-muted truncate">{formatEventDetail(e)}</span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function formatEventDetail(e) {
  switch (e.event_type) {
    case 'ROUTE_COMPUTED':
    case 'ROUTE_RECOMPUTED':
      return `path: [${(e.path || []).join('→')}] latency: ${e.latency_ms}ms hops: ${e.hop_count}`
    case 'NODE_DOWN':
      return `node: ${e.node_name || e.node_id} network: ${e.network_id?.slice(0, 8)}`
    case 'NODE_RECOVERED':
      return `node: ${e.node_name || e.node_id} recovered`
    case 'SIMULATION_STARTED':
      return `${e.source_id?.slice(0, 8)} → ${e.destination_id?.slice(0, 8)} network: ${e.network_id?.slice(0, 8)}`
    case 'SIMULATION_COMPLETED':
      return `msg: ${e.message_id?.slice(0, 8)} path: [${(e.final_path || []).join('→')}]`
    case 'SIMULATION_FAILED':
      return `reason: ${e.reason}`
    case 'MESSAGE_HOP':
      return `${e.from?.slice(0, 8)} → ${e.to?.slice(0, 8)}`
    case 'MESSAGE_DELIVERED':
      return `msg: ${e.message_id?.slice(0, 8)}`
    default:
      return e.simulation_id ? `sim: ${e.simulation_id.slice(0, 8)}` : ''
  }
}

// ── RouteInsightsPanel ────────────────────────────────────────────────────────

function RouteInsightsPanel({ wsEvents }) {
  const lastRoute = useMemo(() => {
    const routes = wsEvents.filter(
      (e) => e.event_type === 'ROUTE_COMPUTED' || e.event_type === 'ROUTE_RECOMPUTED'
    )
    return routes.length ? routes[routes.length - 1] : null
  }, [wsEvents])

  const lastSim = useMemo(() => {
    const sims = wsEvents.filter((e) => e.event_type === 'SIMULATION_COMPLETED')
    return sims.length ? sims[sims.length - 1] : null
  }, [wsEvents])

  const failedNodes = useMemo(() => {
    return wsEvents
      .filter((e) => e.event_type === 'NODE_DOWN')
      .map((e) => ({ id: e.node_id, name: e.node_name, network: e.network_id }))
      .slice(-5)
  }, [wsEvents])

  // Build explainability text from routing context
  const buildExplanation = (route) => {
    if (!route) return null
    const lines = []
    const path = route.path || []
    if (path.length >= 2) {
      lines.push(`Route computed: ${path.join(' → ')}`)
      lines.push(`Total latency: ${route.latency_ms}ms across ${path.length - 1} hop(s)`)
      if (route.event_type === 'ROUTE_RECOMPUTED') {
        lines.push(`Self-healing reroute triggered — original path had ${route.failed_nodes?.length || 1} failed node(s)`)
        if (route.rerouted) {
          lines.push('Dijkstra successfully found an alternate path through the remaining active nodes')
        } else {
          lines.push('Final path unchanged — failed nodes were not on the critical path')
        }
      } else {
        lines.push('Initial Dijkstra computation using current topology snapshot from PostgreSQL')
        lines.push('DOWN nodes excluded from graph traversal — only UP nodes considered as candidates')
      }
    }
    return lines
  }

  const explanationLines = buildExplanation(lastRoute)

  return (
    <div className="card space-y-4">
      <h3 className="text-sm font-bold text-gray-100">Route Insights</h3>

      {!lastRoute && (
        <p className="text-xs text-mesh-muted">No route computations observed yet. Run a simulation to see insights.</p>
      )}

      {lastRoute && (
        <div className="space-y-3">
          {/* Path */}
          <div>
            <p className="text-xs text-mesh-muted mb-2">
              {lastRoute.event_type === 'ROUTE_RECOMPUTED' ? 'Rerouted Path' : 'Computed Path'}
              {lastRoute.phase && <span className="ml-1 text-mesh-muted">({lastRoute.phase})</span>}
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {(lastRoute.path || []).map((nodeId, i) => (
                <React.Fragment key={`${nodeId}-${i}`}>
                  <span className="px-2 py-1 rounded text-xs font-mono bg-mesh-accent/10 text-mesh-accent border border-mesh-accent/20">
                    {nodeId.slice(0, 10)}
                  </span>
                  {i < lastRoute.path.length - 1 && <span className="text-mesh-muted text-sm">→</span>}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Metrics row */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Latency', value: `${lastRoute.latency_ms ?? '—'}ms` },
              { label: 'Hops', value: lastRoute.hop_count ?? (lastRoute.path?.length - 1) ?? '—' },
              { label: 'Rerouted', value: lastRoute.rerouted != null ? (lastRoute.rerouted ? 'YES' : 'NO') : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-mesh-bg rounded p-2 border border-mesh-border text-center">
                <p className="text-xs text-mesh-muted">{label}</p>
                <p className="text-xs font-mono font-semibold text-gray-100 mt-0.5">{value}</p>
              </div>
            ))}
          </div>

          {/* Explainability layer */}
          {explanationLines && (
            <div className="bg-mesh-bg rounded p-3 border border-mesh-border space-y-1">
              <p className="text-xs text-mesh-muted font-mono mb-2">ROUTING ENGINE EXPLANATION</p>
              {explanationLines.map((line, i) => (
                <p key={i} className="text-xs text-gray-300 leading-relaxed">
                  <span className="text-mesh-muted mr-1">›</span>{line}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent node failures */}
      {failedNodes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-mesh-muted">Recent Node Failures</p>
          <div className="space-y-1">
            {failedNodes.map((n, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-mesh-red shrink-0" />
                <span className="font-mono text-mesh-red">{n.name || n.id?.slice(0, 10)}</span>
                <span className="text-mesh-muted">network {n.network?.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last simulation summary */}
      {lastSim && (
        <div className="bg-mesh-green/5 border border-mesh-green/20 rounded p-3">
          <p className="text-xs text-mesh-green font-mono mb-1">LAST SIMULATION COMPLETED</p>
          <p className="text-xs text-gray-400">
            Message {lastSim.message_id?.slice(0, 8)} delivered via {(lastSim.final_path || []).join(' → ')}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Observability({ wsEvents = [], wsStatus = 'disconnected' }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-100">Observability</h2>
        <div className="flex items-center gap-2 text-xs">
          <span className={`w-2 h-2 rounded-full ${wsStatus === 'connected' ? 'bg-mesh-green animate-pulse' : 'bg-mesh-muted'}`} />
          <span className="text-mesh-muted">WS {wsStatus} · {wsEvents.length} events buffered</span>
        </div>
      </div>

      <SystemStatusPanel wsStatus={wsStatus} wsEvents={wsEvents} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <EventTimeline wsEvents={wsEvents} />
        <RouteInsightsPanel wsEvents={wsEvents} />
      </div>
    </div>
  )
}
