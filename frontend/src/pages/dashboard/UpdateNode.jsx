import React, { useState, useEffect } from 'react'
import { listNodes, updateNode } from '../../api'

export default function UpdateNode({ preSelected, onUpdated }) {
  const [nodes, setNodes] = useState([])
  const [selected, setSelected] = useState(preSelected || null)
  const [form, setForm] = useState({ x: '', y: '', latency_ms: '' })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listNodes().then((r) => setNodes(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (preSelected) {
      setSelected(preSelected)
      setForm({ x: preSelected.x, y: preSelected.y, latency_ms: preSelected.latency_ms })
    }
  }, [preSelected])

  const handleSelect = (e) => {
    const node = nodes.find((n) => n.id === e.target.value)
    if (node) {
      setSelected(node)
      setForm({ x: node.x, y: node.y, latency_ms: node.latency_ms })
    }
  }

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value })

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!selected) return
    setError('')
    setSuccess(false)
    setLoading(true)
    try {
      await updateNode(selected.id, {
        x: parseFloat(form.x),
        y: parseFloat(form.y),
        latency_ms: parseFloat(form.latency_ms),
      })
      setSuccess(true)
      setTimeout(() => onUpdated?.(), 1200)
    } catch (err) {
      setError(err.response?.data?.detail || 'Update failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <h2 className="text-lg font-bold text-gray-100">Update Node</h2>

      <form onSubmit={onSubmit} className="card space-y-4">
        {error && <div className="bg-red-900/30 border border-red-800 rounded px-3 py-2 text-mesh-red text-sm">{error}</div>}
        {success && <div className="bg-green-900/30 border border-green-800 rounded px-3 py-2 text-mesh-green text-sm">Node updated!</div>}

        <div>
          <label className="label">Select Node</label>
          <select
            value={selected?.id || ''}
            onChange={handleSelect}
            required
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

        {selected && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">X</label>
                <input name="x" type="number" step="any" value={form.x} onChange={onChange} required className="input" />
              </div>
              <div>
                <label className="label">Y</label>
                <input name="y" type="number" step="any" value={form.y} onChange={onChange} required className="input" />
              </div>
            </div>

            <div>
              <label className="label">Latency (ms)</label>
              <input name="latency_ms" type="number" step="any" min="0.1" value={form.latency_ms} onChange={onChange} required className="input" />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5 disabled:opacity-50">
              {loading ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
