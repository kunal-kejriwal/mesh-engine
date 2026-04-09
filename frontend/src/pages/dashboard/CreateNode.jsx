import React, { useState, useEffect } from 'react'
import { createNode, listNetworks } from '../../api'

export default function CreateNode({ onCreated }) {
  const [networks, setNetworks] = useState([])
  const [form, setForm] = useState({ name: '', x: '', y: '', latency_ms: '10', network_id: '' })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listNetworks()
      .then((r) => setNetworks(r.data))
      .catch(() => {})
  }, [])

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value })

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)
    try {
      await createNode({
        name: form.name,
        x: parseFloat(form.x),
        y: parseFloat(form.y),
        latency_ms: parseFloat(form.latency_ms),
        network_id: form.network_id,
      })
      setSuccess(true)
      setForm({ name: '', x: '', y: '', latency_ms: '10', network_id: form.network_id })
      setTimeout(() => onCreated?.(), 1200)
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Failed to create node')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <h2 className="text-lg font-bold text-gray-100">Create Node</h2>

      <form onSubmit={onSubmit} className="card space-y-4">
        {error && <div className="bg-red-900/30 border border-red-800 rounded px-3 py-2 text-mesh-red text-sm">{error}</div>}
        {success && <div className="bg-green-900/30 border border-green-800 rounded px-3 py-2 text-mesh-green text-sm">Node created!</div>}

        <div>
          <label className="label">Network</label>
          <select name="network_id" value={form.network_id} onChange={onChange} required className="input">
            <option value="">Select a network…</option>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>{n.name} ({n.node_count} nodes)</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Node Name</label>
          <input name="name" value={form.name} onChange={onChange} required className="input" placeholder="node-D" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">X</label>
            <input name="x" type="number" step="any" value={form.x} onChange={onChange} required className="input" placeholder="0" />
          </div>
          <div>
            <label className="label">Y</label>
            <input name="y" type="number" step="any" value={form.y} onChange={onChange} required className="input" placeholder="0" />
          </div>
        </div>

        <div>
          <label className="label">Latency (ms)</label>
          <input name="latency_ms" type="number" step="any" min="0.1" value={form.latency_ms} onChange={onChange} required className="input" />
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5 disabled:opacity-50">
          {loading ? 'Creating…' : 'Create Node'}
        </button>
      </form>
    </div>
  )
}
