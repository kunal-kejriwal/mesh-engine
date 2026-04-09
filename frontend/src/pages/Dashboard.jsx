import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import LiveViz from './dashboard/LiveViz'
import AllNodes from './dashboard/AllNodes'
import CreateNode from './dashboard/CreateNode'
import UpdateNode from './dashboard/UpdateNode'
import DeleteNode from './dashboard/DeleteNode'
import History from './dashboard/History'

const TABS = [
  { id: 'viz',    label: 'Live Visualization' },
  { id: 'all',    label: 'All Nodes' },
  { id: 'create', label: 'Create Node' },
  { id: 'update', label: 'Update Node' },
  { id: 'delete', label: 'Delete Node' },
  { id: 'history',label: 'History' },
]

function DashNavbar({ active, onTab }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <header className="border-b border-mesh-border bg-mesh-surface/50">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 h-12 border-b border-mesh-border">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-mesh-accent font-bold tracking-wider text-sm">MeshEngine</Link>
          <span className="text-mesh-border text-xs">|</span>
          <span className="text-mesh-muted text-xs">Dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-mesh-muted">{user?.username}</span>
          <button onClick={handleLogout} className="text-xs text-mesh-muted hover:text-mesh-red transition-colors">
            Sign out
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <nav className="flex overflow-x-auto px-6 gap-0">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            className={`px-4 py-3 text-xs whitespace-nowrap border-b-2 transition-colors ${
              active === id
                ? 'border-mesh-accent text-mesh-accent'
                : 'border-transparent text-mesh-muted hover:text-gray-100'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
    </header>
  )
}

export default function Dashboard() {
  const [tab, setTab] = useState('viz')
  const [selectedNode, setSelectedNode] = useState(null)

  const renderTab = () => {
    switch (tab) {
      case 'viz':     return <LiveViz />
      case 'all':     return <AllNodes onSelect={setSelectedNode} onEdit={() => setTab('update')} />
      case 'create':  return <CreateNode onCreated={() => setTab('all')} />
      case 'update':  return <UpdateNode preSelected={selectedNode} onUpdated={() => setTab('all')} />
      case 'delete':  return <DeleteNode onDeleted={() => setTab('all')} />
      case 'history': return <History />
      default:        return null
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <DashNavbar active={tab} onTab={setTab} />
      <main className="flex-1 p-6">
        {renderTab()}
      </main>
    </div>
  )
}
