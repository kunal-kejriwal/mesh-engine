/**
 * SimulationLab — Control Layer (additive, isolated state domain).
 *
 * Sections:
 *   1. Preset Scenarios  — one-click topology deployment
 *   2. Custom Network    — manual node entry + auto-link configuration
 *   3. Message Sender    — select src/dst, optional failure injection, run
 *   4. Result Panel      — path visualization, latency, hop count, explanation
 *   5. Live Event Feed   — WS events during simulation (from props)
 *
 * Props:
 *   wsEvents     — event array from useWebSocket (read-only)
 *   wsStatus     — 'connected' | 'disconnected' etc.
 *   onNetworkDeployed — callback(networkId) to notify NetworkVisualizer
 */
import React, { useState, useEffect, useCallback } from 'react'
import client from '../../api'

const API = {
  presets: () => client.get('/lab/presets'),
  deployPreset: (name) => client.post(`/lab/presets/${name}/deploy`),
  listNetworks: () => client.get('/network/list'),
  networkState: (id) => client.get(`/network/state/${id}`),
  createNetwork: (data) => client.post('/network/create', data),
  runSim: (data) => client.post('/simulation/start', data),
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ children, color }) {
  const colors = {
    green: 'bg-mesh-green/10 text-mesh-green border border-mesh-green/30',
    red: 'bg-mesh-red/10 text-mesh-red border border-mesh-red/30',
    blue: 'bg-mesh-accent/10 text-mesh-accent border border-mesh-accent/30',
    yellow: 'bg-mesh-yellow/10 text-mesh-yellow border border-mesh-yellow/30',
    muted: 'bg-mesh-surface text-mesh-muted border border-mesh-border',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-mono ${colors[color] || colors.muted}`}>
      {children}
    </span>
  )
}

function PathDisplay({ path, title, latency, hops, color = 'blue' }) {
  if (!path || path.length === 0) return null
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-mesh-muted">{title}</span>
        {latency != null && <StatusBadge color="muted">{latency}ms</StatusBadge>}
        {hops != null && <StatusBadge color="muted">{hops} hops</StatusBadge>}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {path.map((nodeId, i) => (
          <React.Fragment key={nodeId}>
            <span className={`px-2 py-1 rounded text-xs font-mono ${
              color === 'blue'
                ? 'bg-mesh-accent/10 text-mesh-accent border border-mesh-accent/20'
                : 'bg-mesh-green/10 text-mesh-green border border-mesh-green/20'
            }`}>
              {nodeId.slice(0, 8)}
            </span>
            {i < path.length - 1 && (
              <span className="text-mesh-muted text-xs">→</span>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function SimResult({ result }) {
  if (!result) return null

  const statusColor = result.status === 'SUCCESS' ? 'green' : 'red'
  const rerouted = result.rerouted

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-100">Simulation Result</h3>
        <div className="flex gap-2">
          <StatusBadge color={statusColor}>{result.status}</StatusBadge>
          {rerouted && <StatusBadge color="yellow">REROUTED</StatusBadge>}
        </div>
      </div>

      <PathDisplay
        path={result.initial_path}
        title="Initial path"
        latency={result.initial_latency_ms}
        hops={result.initial_path.length - 1}
        color="blue"
      />

      {rerouted && result.final_path && (
        <PathDisplay
          path={result.final_path}
          title="Final path (after reroute)"
          latency={result.final_latency_ms}
          hops={result.final_path.length - 1}
          color="green"
        />
      )}

      {result.failed_nodes.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs text-mesh-muted">Failed nodes</span>
          <div className="flex flex-wrap gap-1">
            {result.failed_nodes.map((id) => (
              <StatusBadge key={id} color="red">{id.slice(0, 8)}</StatusBadge>
            ))}
          </div>
        </div>
      )}

      {/* Explainability layer */}
      <div className="bg-mesh-bg rounded p-3 border border-mesh-border">
        <p className="text-xs text-mesh-muted mb-1 font-mono">ROUTING EXPLANATION</p>
        <p className="text-xs text-gray-300 leading-relaxed">{result.explanation}</p>
      </div>

      <p className="text-xs text-mesh-muted">
        Simulation ID: <span className="font-mono">{result.simulation_id.slice(0, 16)}…</span>
      </p>
    </div>
  )
}

// ── Preset Panel ──────────────────────────────────────────────────────────────

function PresetPanel({ onDeploy }) {
  const [presets, setPresets] = useState([])
  const [deploying, setDeploying] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    API.presets().then((r) => setPresets(r.data)).catch(() => {})
  }, [])

  const deploy = async (name) => {
    setDeploying(name)
    setError('')
    try {
      const res = await API.deployPreset(name)
      onDeploy(res.data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Deploy failed')
    } finally {
      setDeploying(null)
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-gray-100">Preset Scenarios</h3>
      {error && <p className="text-xs text-mesh-red">{error}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {presets.map((p) => (
          <div key={p.name} className="card bg-mesh-surface/50 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-100">{p.label}</p>
                <p className="text-xs text-mesh-muted mt-0.5 leading-relaxed">{p.description}</p>
              </div>
              <StatusBadge color="muted">{p.node_count}n</StatusBadge>
            </div>
            <button
              onClick={() => deploy(p.name)}
              disabled={deploying === p.name}
              className="w-full text-xs py-1.5 rounded bg-mesh-accent/10 text-mesh-accent border border-mesh-accent/30 hover:bg-mesh-accent/20 transition-colors disabled:opacity-50"
            >
              {deploying === p.name ? 'Deploying…' : 'Deploy + Load'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Custom Network Builder ────────────────────────────────────────────────────

function NodeGenerator({ onNetworkCreated }) {
  const [mode, setMode] = useState('grid') // grid | random
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  const [count, setCount] = useState(8)
  const [threshold, setThreshold] = useState(150)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const buildGridNodes = () => {
    const nodes = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        nodes.push({ name: `N${r * cols + c + 1}`, x: c * 100 + 50, y: r * 100 + 50, latency_ms: 10 })
      }
    }
    return nodes
  }

  const buildRandomNodes = () => {
    return Array.from({ length: count }, (_, i) => ({
      name: `R${i + 1}`,
      x: Math.round(Math.random() * 400 + 50),
      y: Math.round(Math.random() * 300 + 50),
      latency_ms: Math.round(Math.random() * 20 + 5),
    }))
  }

  const create = async () => {
    setCreating(true)
    setError('')
    const nodes = mode === 'grid' ? buildGridNodes() : buildRandomNodes()
    try {
      const res = await API.createNetwork({
        name: `[Lab] ${mode === 'grid' ? `${rows}x${cols} Grid` : `${count}-node Random`}`,
        nodes,
        link_threshold: threshold,
      })
      onNetworkCreated(res.data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Network creation failed')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-gray-100">Custom Network Builder</h3>

      {/* Mode toggle */}
      <div className="flex gap-2">
        {['grid', 'random'].map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 text-xs rounded border transition-colors ${
              mode === m
                ? 'border-mesh-accent bg-mesh-accent/10 text-mesh-accent'
                : 'border-mesh-border text-mesh-muted hover:text-gray-100'
            }`}
          >
            {m === 'grid' ? 'Grid Layout' : 'Random Layout'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {mode === 'grid' ? (
          <>
            <label className="space-y-1">
              <span className="text-xs text-mesh-muted">Rows</span>
              <input type="number" min={2} max={8} value={rows}
                onChange={(e) => setRows(+e.target.value)}
                className="input w-full" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-mesh-muted">Columns</span>
              <input type="number" min={2} max={8} value={cols}
                onChange={(e) => setCols(+e.target.value)}
                className="input w-full" />
            </label>
          </>
        ) : (
          <label className="space-y-1 col-span-2">
            <span className="text-xs text-mesh-muted">Node Count</span>
            <input type="number" min={3} max={30} value={count}
              onChange={(e) => setCount(+e.target.value)}
              className="input w-full" />
          </label>
        )}
        <label className="space-y-1 col-span-2">
          <span className="text-xs text-mesh-muted">Link Threshold (Euclidean distance)</span>
          <input type="number" min={50} max={500} value={threshold}
            onChange={(e) => setThreshold(+e.target.value)}
            className="input w-full" />
        </label>
      </div>

      {error && <p className="text-xs text-mesh-red">{error}</p>}
      <button
        onClick={create}
        disabled={creating}
        className="btn-primary w-full text-xs"
      >
        {creating ? 'Creating…' : 'Create Network'}
      </button>
    </div>
  )
}

// ── Message Sender ────────────────────────────────────────────────────────────

function MessageSender({ network, onResult }) {
  const [sourceId, setSourceId] = useState('')
  const [destId, setDestId] = useState('')
  const [failNodeIds, setFailNodeIds] = useState([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const nodes = network?.nodes || []

  const toggleFail = (id) => {
    setFailNodeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const run = async () => {
    if (!sourceId || !destId) { setError('Select source and destination nodes'); return }
    if (sourceId === destId) { setError('Source and destination must differ'); return }
    setRunning(true)
    setError('')
    try {
      const res = await API.runSim({
        network_id: network.network_id || network.id,
        source_id: sourceId,
        destination_id: destId,
        payload: 'LAB_PAYLOAD',
        fail_nodes: failNodeIds.length ? failNodeIds : undefined,
      })
      onResult(res.data)
    } catch (e) {
      const d = e.response?.data?.detail
      setError(typeof d === 'object' ? d.message || JSON.stringify(d) : d || e.message)
    } finally {
      setRunning(false)
    }
  }

  if (nodes.length === 0) {
    return (
      <div className="text-xs text-mesh-muted py-4 text-center">
        Deploy or create a network above to configure a simulation.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-gray-100">Message Sender</h3>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-mesh-muted">Source Node</span>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="input w-full">
            <option value="">— select —</option>
            {nodes.filter((n) => n.status !== 'DOWN').map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-mesh-muted">Destination Node</span>
          <select value={destId} onChange={(e) => setDestId(e.target.value)} className="input w-full">
            <option value="">— select —</option>
            {nodes.filter((n) => n.status !== 'DOWN').map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Failure injection */}
      <div className="space-y-1">
        <span className="text-xs text-mesh-muted">Inject Failures (optional — simulates mid-route node loss)</span>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {nodes.map((n) => {
            const isEndpoint = n.id === sourceId || n.id === destId
            const isFailing = failNodeIds.includes(n.id)
            return (
              <button
                key={n.id}
                onClick={() => !isEndpoint && toggleFail(n.id)}
                disabled={isEndpoint}
                title={isEndpoint ? 'Cannot fail an endpoint node' : `Toggle failure for ${n.name}`}
                className={`px-2 py-1 rounded text-xs border transition-colors ${
                  isEndpoint
                    ? 'border-mesh-border text-mesh-muted opacity-40 cursor-not-allowed'
                    : isFailing
                    ? 'border-mesh-red bg-mesh-red/10 text-mesh-red'
                    : 'border-mesh-border text-mesh-muted hover:border-mesh-red hover:text-mesh-red'
                }`}
              >
                {n.name}
                {isFailing && ' ✕'}
              </button>
            )
          })}
        </div>
      </div>

      {error && <p className="text-xs text-mesh-red">{error}</p>}
      <button onClick={run} disabled={running} className="btn-primary w-full text-xs">
        {running ? 'Simulating…' : failNodeIds.length > 0 ? 'Run Simulation (with failures)' : 'Run Simulation'}
      </button>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SimulationLab({ wsEvents = [], wsStatus = 'disconnected', onNetworkDeployed }) {
  const [activeNetwork, setActiveNetwork] = useState(null) // { network_id, nodes, node_map, ... }
  const [simResult, setSimResult] = useState(null)
  const [narrative, setNarrative] = useState('')

  const handlePresetDeploy = useCallback(async (deployed) => {
    // Fetch full state so we have node objects with ids/status
    try {
      const res = await API.networkState(deployed.network_id)
      setActiveNetwork({
        ...res.data,
        network_id: deployed.network_id,
        node_map: deployed.node_map,
        recommended_source_id: deployed.recommended_source_id,
        recommended_destination_id: deployed.recommended_destination_id,
        recommended_fail_node_ids: deployed.recommended_fail_node_ids,
      })
      setNarrative(deployed.scenario_narrative)
      setSimResult(null)
      onNetworkDeployed?.(deployed.network_id)
    } catch { /* ignore — user can still manually configure */ }
  }, [onNetworkDeployed])

  const handleNetworkCreated = useCallback(async (network) => {
    try {
      const res = await API.networkState(network.id)
      setActiveNetwork({ ...res.data, network_id: network.id })
      setNarrative('')
      setSimResult(null)
      onNetworkDeployed?.(network.id)
    } catch { /* ignore */ }
  }, [onNetworkDeployed])

  // Filter WS events to simulation-relevant types
  const simEvents = wsEvents.filter((e) => e.event_type !== 'PING' && e.event_type !== 'CONNECTED')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-100">Simulation Lab</h2>
        <div className="flex items-center gap-2 text-xs">
          <span className={`w-2 h-2 rounded-full ${wsStatus === 'connected' ? 'bg-mesh-green animate-pulse' : 'bg-mesh-muted'}`} />
          <span className="text-mesh-muted">WS {wsStatus}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left column: network setup */}
        <div className="space-y-6">
          <div className="card">
            <PresetPanel onDeploy={handlePresetDeploy} />
          </div>
          <div className="card">
            <NodeGenerator onNetworkCreated={handleNetworkCreated} />
          </div>
        </div>

        {/* Right column: simulation controls + results */}
        <div className="space-y-4">
          {activeNetwork && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-mesh-muted">Active Network</span>
                <StatusBadge color="green">
                  {activeNetwork.active_nodes}/{activeNetwork.node_count} nodes UP
                </StatusBadge>
              </div>
              {narrative && (
                <div className="bg-mesh-bg rounded p-2 border border-mesh-border mb-3">
                  <p className="text-xs text-mesh-muted font-mono mb-1">SCENARIO NARRATIVE</p>
                  <p className="text-xs text-gray-400 leading-relaxed">{narrative}</p>
                </div>
              )}
              <MessageSender network={activeNetwork} onResult={setSimResult} />
            </div>
          )}

          {!activeNetwork && (
            <div className="card text-center py-8">
              <p className="text-mesh-muted text-sm">Deploy a preset or create a custom network to begin simulating.</p>
            </div>
          )}

          {simResult && <SimResult result={simResult} />}

          {/* Live event feed */}
          {simEvents.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-100">Live Event Feed</span>
                <span className="text-xs text-mesh-muted">{simEvents.length} events</span>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {[...simEvents].reverse().slice(0, 30).map((e, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-mesh-muted font-mono whitespace-nowrap">
                      {e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '--:--:--'}
                    </span>
                    <StatusBadge color={eventColor(e.event_type)}>{e.event_type}</StatusBadge>
                    <span className="text-gray-400 truncate">{eventSummary(e)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function eventColor(type) {
  if (type?.includes('FAIL') || type === 'NODE_DOWN') return 'red'
  if (type?.includes('RECOVER') || type === 'SIMULATION_COMPLETED') return 'green'
  if (type?.includes('RECOMPUTED') || type?.includes('REROUTE')) return 'yellow'
  return 'blue'
}

function eventSummary(e) {
  switch (e.event_type) {
    case 'ROUTE_COMPUTED': return `path: ${(e.path || []).join('→')} (${e.latency_ms}ms)`
    case 'NODE_DOWN': return `node ${e.node_id?.slice(0, 8)} marked DOWN`
    case 'NODE_RECOVERED': return `node ${e.node_id?.slice(0, 8)} recovered`
    case 'ROUTE_RECOMPUTED': return `rerouted=${e.rerouted}, path: ${(e.path || []).join('→')}`
    case 'SIMULATION_COMPLETED': return `status: SUCCESS, msg: ${e.message_id?.slice(0, 8)}`
    case 'SIMULATION_FAILED': return `reason: ${e.reason}`
    default: return e.simulation_id ? `sim: ${e.simulation_id.slice(0, 8)}` : ''
  }
}
