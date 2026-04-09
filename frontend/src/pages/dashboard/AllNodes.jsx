import React, { useState, useEffect, useCallback } from 'react'
import { listNodes, blockNode, startNode } from '../../api'

export default function AllNodes({ onSelect, onEdit }) {
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actingOn, setActingOn] = useState(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listNodes()
      setNodes(res.data)
    } catch {
      setError('Failed to load nodes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  const toggle = async (node) => {
    setActingOn(node.id)
    try {
      if (node.status === 'UP') await blockNode(node.id)
      else await startNode(node.id)
      await fetch()
    } catch { /* ignore */ } finally {
      setActingOn(null)
    }
  }

  const handleEdit = (node) => {
    onSelect?.(node)
    onEdit?.()
  }

  if (loading) return <div className="text-mesh-muted text-sm animate-pulse">Loading nodes…</div>
  if (error) return <div className="text-mesh-red text-sm">{error}</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-100">All Nodes</h2>
        <button onClick={fetch} className="btn-ghost py-1.5 text-xs">Refresh</button>
      </div>

      {nodes.length === 0 ? (
        <div className="card text-mesh-muted text-sm text-center py-12">
          No nodes found. Create a network first via the API.
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-mesh-border">
              <tr>
                {['Name', 'Network', 'X', 'Y', 'Latency', 'Status', 'Created', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-mesh-muted uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.id} className="border-b border-mesh-border/40 hover:bg-mesh-surface/50 transition-colors">
                  <td className="px-4 py-3 text-gray-100 font-medium">{n.name}</td>
                  <td className="px-4 py-3 text-mesh-muted text-xs font-mono">{n.network_id?.slice(0, 8)}…</td>
                  <td className="px-4 py-3 text-mesh-muted">{n.x.toFixed(1)}</td>
                  <td className="px-4 py-3 text-mesh-muted">{n.y.toFixed(1)}</td>
                  <td className="px-4 py-3 text-mesh-muted">{n.latency_ms}ms</td>
                  <td className="px-4 py-3">
                    <span className={n.status === 'UP' ? 'badge-up' : 'badge-down'}>{n.status}</span>
                  </td>
                  <td className="px-4 py-3 text-mesh-muted text-xs">
                    {new Date(n.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEdit(n)}
                        className="text-xs text-mesh-accent hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => toggle(n)}
                        disabled={actingOn === n.id}
                        className={`text-xs ${n.status === 'UP' ? 'text-mesh-yellow hover:text-yellow-400' : 'text-mesh-green hover:text-green-400'} disabled:opacity-50`}
                      >
                        {actingOn === n.id ? '…' : n.status === 'UP' ? 'Block' : 'Start'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
