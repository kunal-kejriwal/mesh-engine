import React, { useState, useEffect, useCallback } from 'react'
import { getHistory } from '../../api'

const ACTION_COLORS = {
  node_created:   'text-mesh-green',
  node_updated:   'text-mesh-accent',
  node_deleted:   'text-mesh-red',
  node_blocked:   'text-mesh-yellow',
  node_started:   'text-mesh-green',
}

const ACTION_ICONS = {
  node_created:  '+',
  node_updated:  '~',
  node_deleted:  '×',
  node_blocked:  '⊘',
  node_started:  '▶',
}

export default function History() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getHistory()
      setEntries(res.data)
    } catch {
      setError('Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  if (loading) return <div className="text-mesh-muted text-sm animate-pulse">Loading history…</div>
  if (error) return <div className="text-mesh-red text-sm">{error}</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-100">History</h2>
        <button onClick={fetch} className="btn-ghost py-1.5 text-xs">Refresh</button>
      </div>

      {entries.length === 0 ? (
        <div className="card text-mesh-muted text-sm text-center py-12">
          No actions recorded yet.
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-mesh-border">
              <tr>
                {['Action', 'Node ID', 'Detail', 'Timestamp'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-mesh-muted uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-mesh-border/40 hover:bg-mesh-surface/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className={`font-mono text-xs ${ACTION_COLORS[e.action] || 'text-mesh-muted'}`}>
                      <span className="mr-1.5">{ACTION_ICONS[e.action] || '·'}</span>
                      {e.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-mesh-muted text-xs font-mono">
                    {e.node_id ? `${e.node_id.slice(0, 8)}…` : '—'}
                  </td>
                  <td className="px-4 py-3 text-mesh-muted text-xs">{e.detail || '—'}</td>
                  <td className="px-4 py-3 text-mesh-muted text-xs">
                    {new Date(e.timestamp).toLocaleString()}
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
