import React, { useState, useEffect } from 'react'
import { listNodes, deleteNode } from '../../api'

export default function DeleteNode({ onDeleted }) {
  const [nodes, setNodes] = useState([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  const fetchNodes = async () => {
    try {
      const res = await listNodes()
      setNodes(res.data)
    } catch { /* ignore */ }
  }

  useEffect(() => { fetchNodes() }, [])

  const selectedNode = nodes.find((n) => n.id === selected)

  const handleDelete = async () => {
    if (!selected) return
    setError('')
    setLoading(true)
    try {
      await deleteNode(selected)
      setSuccess(true)
      setSelected('')
      setConfirming(false)
      await fetchNodes()
      setTimeout(() => onDeleted?.(), 1200)
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <h2 className="text-lg font-bold text-gray-100">Delete Node</h2>

      <div className="card space-y-4">
        {error && <div className="bg-red-900/30 border border-red-800 rounded px-3 py-2 text-mesh-red text-sm">{error}</div>}
        {success && <div className="bg-green-900/30 border border-green-800 rounded px-3 py-2 text-mesh-green text-sm">Node deleted.</div>}

        <div>
          <label className="label">Select Node to Delete</label>
          <select
            value={selected}
            onChange={(e) => { setSelected(e.target.value); setConfirming(false); setSuccess(false) }}
            className="input"
          >
            <option value="">Choose a node…</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} — ({n.x}, {n.y}) [{n.status}]
              </option>
            ))}
          </select>
        </div>

        {selectedNode && !confirming && (
          <div className="space-y-3">
            <div className="bg-mesh-bg border border-mesh-border rounded p-3 text-xs text-mesh-muted space-y-1">
              <div><span className="text-gray-300">Name:</span> {selectedNode.name}</div>
              <div><span className="text-gray-300">Status:</span> <span className={selectedNode.status === 'UP' ? 'text-mesh-green' : 'text-mesh-red'}>{selectedNode.status}</span></div>
              <div><span className="text-gray-300">Position:</span> ({selectedNode.x}, {selectedNode.y})</div>
            </div>
            <button
              onClick={() => setConfirming(true)}
              className="w-full px-4 py-2 bg-mesh-red/20 border border-red-800 text-mesh-red rounded text-sm hover:bg-mesh-red/30 transition-colors"
            >
              Delete this node
            </button>
          </div>
        )}

        {selectedNode && confirming && (
          <div className="space-y-3">
            <div className="bg-red-900/20 border border-red-800 rounded px-3 py-2 text-mesh-red text-sm">
              This will permanently delete <strong>{selectedNode.name}</strong> and all its links. Are you sure?
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-mesh-red text-white rounded text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {loading ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 btn-ghost py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
