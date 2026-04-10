/**
 * Dashboard — shell component.
 *
 * Additive changes from original:
 * 1. useWebSocket hook instantiated once at shell level — shared by all new tabs
 * 2. Four new tabs appended to TABS: Lab, Visualizer, Observability, Failures
 * 3. All existing tabs (viz, all, create, update, delete, history) UNCHANGED
 * 4. networkId state for cross-tab communication (Lab → Visualizer)
 *
 * The shared wsEvents/wsStatus are passed as props into new tabs only.
 * Existing tabs receive no new props — their interfaces are untouched.
 */
import React, { useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { useWebSocket } from '../hooks/useWebSocket'

// Existing tabs — NOT modified
import LiveViz from './dashboard/LiveViz'
import AllNodes from './dashboard/AllNodes'
import CreateNode from './dashboard/CreateNode'
import UpdateNode from './dashboard/UpdateNode'
import DeleteNode from './dashboard/DeleteNode'
import History from './dashboard/History'

// New additive tabs
import SimulationLab from './dashboard/SimulationLab'
import NetworkVisualizer from './dashboard/NetworkVisualizer'
import Observability from './dashboard/Observability'
import FailureControl from './dashboard/FailureControl'

const TABS = [
  // ── Existing tabs (unchanged order + IDs) ─────────────────────────────────
  { id: 'viz',         label: 'Live Visualization' },
  { id: 'all',         label: 'All Nodes' },
  { id: 'create',      label: 'Create Node' },
  { id: 'update',      label: 'Update Node' },
  { id: 'delete',      label: 'Delete Node' },
  { id: 'history',     label: 'History' },
  // ── New additive tabs ─────────────────────────────────────────────────────
  { id: 'lab',         label: 'Simulation Lab',    badge: 'NEW' },
  { id: 'visualizer',  label: 'Network Visualizer', badge: 'NEW' },
  { id: 'observe',     label: 'Observability',      badge: 'NEW' },
  { id: 'failures',    label: 'Failure Control',    badge: 'NEW' },
]

function DashNavbar({ active, onTab, wsStatus }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const wsColor = wsStatus === 'connected' ? 'bg-mesh-green' : wsStatus === 'connecting' ? 'bg-mesh-yellow' : 'bg-mesh-muted'

  return (
    <header className="border-b border-mesh-border bg-mesh-surface/50">
      {/* Top bar — unchanged layout */}
      <div className="flex items-center justify-between px-6 h-12 border-b border-mesh-border">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-mesh-accent font-bold tracking-wider text-sm">MeshEngine</Link>
          <span className="text-mesh-border text-xs">|</span>
          <span className="text-mesh-muted text-xs">Dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          {/* WS indicator — visible in navbar for global awareness */}
          <span title={`WebSocket: ${wsStatus}`} className={`w-2 h-2 rounded-full ${wsColor} ${wsStatus === 'connected' ? 'animate-pulse' : ''}`} />
          <span className="text-xs text-mesh-muted">{user?.username}</span>
          <button onClick={handleLogout} className="text-xs text-mesh-muted hover:text-mesh-red transition-colors">
            Sign out
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <nav className="flex overflow-x-auto px-6 gap-0">
        {TABS.map(({ id, label, badge }) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            className={`relative px-4 py-3 text-xs whitespace-nowrap border-b-2 transition-colors ${
              active === id
                ? 'border-mesh-accent text-mesh-accent'
                : 'border-transparent text-mesh-muted hover:text-gray-100'
            }`}
          >
            {label}
            {badge && (
              <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] bg-mesh-accent/20 text-mesh-accent font-mono leading-none">
                {badge}
              </span>
            )}
          </button>
        ))}
      </nav>
    </header>
  )
}

export default function Dashboard() {
  const [tab, setTab] = useState('viz')
  const [selectedNode, setSelectedNode] = useState(null)
  const [labNetworkId, setLabNetworkId] = useState(null) // Lab → Visualizer cross-tab signal

  // Shared WebSocket — instantiated once, shared via props to new tabs
  const { events: wsEvents, status: wsStatus, subscribe, unsubscribe } = useWebSocket()

  const handleLabNetworkDeployed = useCallback((networkId) => {
    setLabNetworkId(networkId)
  }, [])

  const renderTab = () => {
    switch (tab) {
      // ── Existing tabs — called IDENTICALLY to original ─────────────────────
      case 'viz':     return <LiveViz />
      case 'all':     return <AllNodes onSelect={setSelectedNode} onEdit={() => setTab('update')} />
      case 'create':  return <CreateNode onCreated={() => setTab('all')} />
      case 'update':  return <UpdateNode preSelected={selectedNode} onUpdated={() => setTab('all')} />
      case 'delete':  return <DeleteNode onDeleted={() => setTab('all')} />
      case 'history': return <History />
      // ── New additive tabs — receive WS state as props ──────────────────────
      case 'lab':
        return (
          <SimulationLab
            wsEvents={wsEvents}
            wsStatus={wsStatus}
            onNetworkDeployed={handleLabNetworkDeployed}
          />
        )
      case 'visualizer':
        return (
          <NetworkVisualizer
            wsEvents={wsEvents}
            wsStatus={wsStatus}
            networkId={labNetworkId}
          />
        )
      case 'observe':
        return (
          <Observability
            wsEvents={wsEvents}
            wsStatus={wsStatus}
          />
        )
      case 'failures':
        return (
          <FailureControl
            wsEvents={wsEvents}
            wsStatus={wsStatus}
          />
        )
      default: return null
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <DashNavbar active={tab} onTab={setTab} wsStatus={wsStatus} />
      <main className="flex-1 p-6">
        {renderTab()}
      </main>
    </div>
  )
}
