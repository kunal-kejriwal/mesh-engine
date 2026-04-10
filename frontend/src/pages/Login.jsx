import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { getOAuthUrl } from '../api'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value })

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(form.username, form.password)
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link to="/" className="text-mesh-accent font-bold text-xl tracking-wider">MeshEngine</Link>
          <p className="text-mesh-muted text-sm mt-2">Sign in to your account</p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded px-3 py-2 text-mesh-red text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="label">Username</label>
            <input
              name="username"
              value={form.username}
              onChange={onChange}
              required
              autoFocus
              className="input"
              placeholder="alice"
            />
          </div>

          <div>
            <label className="label">Password</label>
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={onChange}
              required
              className="input"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center py-2.5 disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        {/* OAuth divider — additive section */}
        <div className="mt-5">
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-mesh-border" />
            <span className="text-xs text-mesh-muted">or continue with</span>
            <div className="flex-1 border-t border-mesh-border" />
          </div>
          <div className="flex gap-3 mt-3">
            <OAuthButton provider="google" label="Google" />
            <OAuthButton provider="github" label="GitHub" />
          </div>
        </div>

        <p className="text-center text-mesh-muted text-sm mt-4">
          No account?{' '}
          <Link to="/register" className="text-mesh-accent hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}

function OAuthButton({ provider, label }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleClick = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await getOAuthUrl(provider)
      // Add provider to state so OAuthCallback can identify it
      const url = new URL(res.data.url)
      url.searchParams.set('state', provider)
      window.location.href = url.toString()
    } catch (e) {
      const detail = e.response?.data?.detail || e.message
      setError(typeof detail === 'string' ? detail : 'OAuth unavailable')
      setLoading(false)
    }
  }

  return (
    <div className="flex-1">
      <button
        onClick={handleClick}
        disabled={loading}
        className="w-full py-2 text-xs rounded border border-mesh-border text-mesh-muted hover:border-mesh-accent hover:text-gray-100 transition-colors disabled:opacity-40"
      >
        {loading ? '…' : label}
      </button>
      {error && <p className="text-xs text-mesh-red mt-1 text-center">{error}</p>}
    </div>
  )
}
