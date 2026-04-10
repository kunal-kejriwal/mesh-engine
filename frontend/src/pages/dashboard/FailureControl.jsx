/**
 * FailureControl — Failure Control Layer (additive, isolated state domain).
 *
 * Provides manual failure injection and node recovery for any network.
 * All operations call existing backend endpoints:
 *   POST /node/fail/{node_id}     → marks node DOWN
 *   POST /node/recover/{node_id}  → marks node UP
 *
 * UI structure:
 *   1. Network selector
 *   2. Node grid — status badges + per-node FAIL / RECOVER button
 *   3. Quick actions — Fail Random, Recover All
 *   4. Active failures summary + impact analysis
 *   5. WS event feed (failures/recoveries only)
 *
 * Props:
 *   wsEvents — rolling event array (read-only subscriber)
 *   wsStatus — WS connection status
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import client from '../../api'

const API = {
  listNetworks: () => client.get('/network/list'),
  networkState: (id) => client.get(`/network/state/${id}`),
  failNode: (id) => client.post(`/node/fail/${id}`),
  recoverNode: (id) => client.post(`/node/recover/${id}`),
}

// ── Node card ─────────────────────────────────────────────────────────────────

function NodeCard({ node, onFail, onRecover, loading }) {
  const isDown = node.status === 'DOWN'

  return (
    <div className={`rounded border p-3 space-y-2 transition-colors ${
      isDown
        ? 'border-mesh-red/40 bg-mesh-red/5'
        : 'border-mesh-border bg-mesh-surface/30'
    }`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono font-semibold text-gray-100 truncate">
          {node.name}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
          isDown
            ? 'bg-mesh-red/10 text-mesh-red border border-mesh-red/30'
            : 'bg-mesh-green/10 text-mesh-green border border-mesh-green/30'
        }`}>
          {node.status}
        </span>
      </div>

      <div className="text-xs text-mesh-muted font-mono space-y-0.5">
        <div>lat: {node.latency_ms}ms</div>
        <div className="truncate">id: {node.id.slice(0, 12)}…</div>
      </div>

      <div className="flex gap-1.5">
        {!isDown ? (
          <button
            onClick={() => onFail(node.id)}
            disabled={loading === node.id}
            className="flex-1 text-xs py-1 rounded border border-mesh-red/40 text-mesh-red hover:bg-mesh-red/10 transition-colors disabled:opacity-40"
          >
            {loading === node.id ? '…' : 'Fail'}
          </button>
        ) : (
          <button
            onClick={() => onRecover(node.id)}
            disabled={loading === node.id}
            className="flex-1 text-xs py-1 rounded border border-mesh-green/40 text-mesh-green hover:bg-mesh-green/10 transition-colors disabled:opacity-40"
          >
            {loading === node.id ? '…' : 'Recover'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Impact analysis ───────────────────────────────────────────────────────────

function ImpactAnalysis({ nodes }) {
  const down = nodes.filter((n) => n.status === 'DOWN')
  const up = nodes.filter((n) => n.status === 'UP')
  const failRatio = nodes.length ? (down.length / nodes.length) : 0

  const severity =
    failRatio >= 0.5 ? { label: 'CRITICAL', color: 'text-mesh-red', bg: 'bg-mesh-red/5 border-mesh-red/30' }
    : failRatio >= 0.25 ? { label: 'DEGRADED', color: 'text-mesh-yellow', bg: 'bg-mesh-yellow/5 border-mesh-yellow/30' }
    : down.length > 0 ? { label: 'IMPAIRED', color: 'text-mesh-yellow', bg: 'bg-mesh-yellow/5 border-mesh-yellow/30' }
    : { label: 'HEALTHY', color: 'text-mesh-green', bg: 'bg-mesh-green/5 border-mesh-green/30' }

  const explanation = down.length === 0
    ? 'All nodes operational. Dijkstra considers full topology — maximum path redundancy.'
    : down.length === 1
    ? `Node "${down[0]?.name}" excluded from routing graph. Dijkstra will reroute around it if alternate paths exist.`
    : `${down.length} nodes excluded from routing graph (${down.map((n) => n.name).join(', ')}). Network may be partitioned if these nodes bridge disconnected regions.`

  return (
    <div className={`rounded border p-3 space-y-2 ${severity.bg}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-mesh-muted">Network Health</span>
        <span className={`text-xs font-mono font-bold ${severity.color}`}>{severity.label}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-mono font-bold text-gray-100">{nodes.length}</p>
          <p className="text-xs text-mesh-muted">Total</p>
        </div>
        <div>
          <p className="text-lg font-mono font-bold text-mesh-green">{up.length}</p>
          <p className="text-xs text-mesh-muted">Active</p>
        </div>
        <div>
          <p className={`text-lg font-mono font-bold ${down.length > 0 ? 'text-mesh-red' : 'text-mesh-muted'}`}>{down.length}</p>
          <p className="text-xs text-mesh-muted">DOWN</p>
        </div>
      </div>
      <div className="bg-mesh-bg rounded p-2 border border-mesh-border/50">
        <p className="text-xs text-mesh-muted font-mono mb-1">DIJKSTRA IMPACT</p>
        <p className="text-xs text-gray-400 leading-relaxed">{explanation}</p>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FailureControl({ wsEvents = [], wsStatus = 'disconnected' }) {
  const [networks, setNetworks] = useState([])
  const [selectedNetwork, setSelectedNetwork] = useState('')
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(null) // node_id being operated on
  const [error, setError] = useState('')
  const [opLog, setOpLog] = useState([]) // local operation log

  // Load networks
  useEffect(() => {
    API.listNetworks().then((r) => setNetworks(r.data)).catch(() => {})
  }, [])

  // Load nodes when network changes
  const fetchNodes = useCallback(async () => {
    if (!selectedNetwork) { setNodes([]); return }
    try {
      const res = await API.networkState(selectedNetwork)
      setNodes(res.data.nodes)
    } catch { /* ignore */ }
  }, [selectedNetwork])

  useEffect(() => {
    fetchNodes()
    const id = selectedNetwork ? setInterval(fetchNodes, 3000) : null
    return () => { if (id) clearInterval(id) }
  }, [fetchNodes, selectedNetwork])

  // React to WS events for instant UI update
  useEffect(() => {
    if (!wsEvents.length) return
    const e = wsEvents[wsEvents.length - 1]
    if (e.event_type === 'NODE_DOWN' || e.event_type === 'NODE_RECOVERED') {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === e.node_id ? { ...n, status: e.event_type === 'NODE_DOWN' ? 'DOWN' : 'UP' } : n
        )
      )
    }
  }, [wsEvents])

  const failNode = async (nodeId) => {
    setLoading(nodeId)
    setError('')
    try {
      await API.failNode(nodeId)
      const node = nodes.find((n) => n.id === nodeId)
      setOpLog((prev) => [...prev, { action: 'FAIL', name: node?.name, id: nodeId, ts: new Date() }])
      await fetchNodes()
    } catch (e) {
      setError(e.response?.data?.detail?.message || e.response?.data?.detail || 'Failure injection failed')
    } finally {
      setLoading(null)
    }
  }

  const recoverNode = async (nodeId) => {
    setLoading(nodeId)
    setError('')
    try {
      await API.recoverNode(nodeId)
      const node = nodes.find((n) => n.id === nodeId)
      setOpLog((prev) => [...prev, { action: 'RECOVER', name: node?.name, id: nodeId, ts: new Date() }])
      await fetchNodes()
    } catch (e) {
      setError(e.response?.data?.detail?.message || e.response?.data?.detail || 'Recovery failed')
    } finally {
      setLoading(null)
    }
  }

  const failRandom = async () => {
    const upNodes = nodes.filter((n) => n.status === 'UP')
    if (!upNodes.length) return
    const target = upNodes[Math.floor(Math.random() * upNodes.length)]
    await failNode(target.id)
  }

  const recoverAll = async () => {
    const downNodes = nodes.filter((n) => n.status === 'DOWN')
    for (const n of downNodes) {
      await recoverNode(n.id)
    }
  }

  const downCount = nodes.filter((n) => n.status === 'DOWN').length
  const filteredWsEvents = useMemo(() =>
    wsEvents.filter((e) => e.event_type === 'NODE_DOWN' || e.event_type === 'NODE_RECOVERED'),
    [wsEvents]
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-gray-100">Failure Control</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${wsStatus === 'connected' ? 'bg-mesh-green animate-pulse' : 'bg-mesh-muted'}`} />
            <span className="text-mesh-muted">WS {wsStatus}</span>
          </div>
        </div>
      </div>

      {/* Network selector */}
      <div className="card flex items-center gap-4">
        <label className="text-xs text-mesh-muted whitespace-nowrap">Target Network</label>
        <select
          value={selectedNetwork}
          onChange={(e) => setSelectedNetwork(e.target.value)}
          className="input flex-1 text-xs"
        >
          <option value="">— select a network —</option>
          {networks.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name} · {n.active_nodes}/{n.node_count} UP
            </option>
          ))}
        </select>
        <button onClick={fetchNodes} className="text-xs text-mesh-muted hover:text-gray-100 transition-colors" title="Refresh">↺</button>
      </div>

      {selectedNetwork && nodes.length > 0 && (
        <>
          <ImpactAnalysis nodes={nodes} />

          {/* Quick actions */}
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={failRandom}
              disabled={nodes.every((n) => n.status === 'DOWN') || !!loading}
              className="px-4 py-2 text-xs rounded border border-mesh-red/40 text-mesh-red hover:bg-mesh-red/10 transition-colors disabled:opacity-40"
            >
              ⚡ Fail Random Node
            </button>
            <button
              onClick={recoverAll}
              disabled={downCount === 0 || !!loading}
              className="px-4 py-2 text-xs rounded border border-mesh-green/40 text-mesh-green hover:bg-mesh-green/10 transition-colors disabled:opacity-40"
            >
              ✓ Recover All ({downCount} down)
            </button>
            {error && <p className="text-xs text-mesh-red self-center">{error}</p>}
          </div>

          {/* Node grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {nodes.map((n) => (
              <NodeCard
                key={n.id}
                node={n}
                onFail={failNode}
                onRecover={recoverNode}
                loading={loading}
              />
            ))}
          </div>

          {/* Operation log */}
          {opLog.length > 0 && (
            <div className="card">
              <h3 className="text-xs font-bold text-gray-100 mb-2">Operation Log</h3>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {[...opLog].reverse().map((entry, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-mesh-muted font-mono">{entry.ts.toLocaleTimeString()}</span>
                    <span className={entry.action === 'FAIL' ? 'text-mesh-red' : 'text-mesh-green'}>
                      {entry.action}
                    </span>
                    <span className="text-gray-400">{entry.name}</span>
                    <span className="text-mesh-muted font-mono">{entry.id.slice(0, 10)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* WS event feed for this panel */}
          {filteredWsEvents.length > 0 && (
            <div className="card">
              <h3 className="text-xs font-bold text-gray-100 mb-2">Node Events (WS)</h3>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {[...filteredWsEvents].reverse().slice(0, 20).map((e, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="text-mesh-muted font-mono">
                      {e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '--'}
                    </span>
                    <span className={e.event_type === 'NODE_DOWN' ? 'text-mesh-red' : 'text-mesh-green'}>
                      {e.event_type}
                    </span>
                    <span className="text-gray-400">{e.node_name || e.node_id?.slice(0, 10)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {selectedNetwork && nodes.length === 0 && (
        <div className="card text-center py-8">
          <p className="text-xs text-mesh-muted">Loading nodes…</p>
        </div>
      )}

      {!selectedNetwork && (
        <div className="card text-center py-8">
          <p className="text-sm text-mesh-muted">Select a network above to inject failures.</p>
          <p className="text-xs text-mesh-muted mt-1">
            Create networks in the Simulation Lab tab first.
          </p>
        </div>
      )}
    </div>
  )
}
