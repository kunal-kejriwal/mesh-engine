/**
 * OAuthCallback — handles the provider redirect after OAuth authorization.
 *
 * Flow:
 *   1. Provider redirects to /oauth/callback?code=...&provider=...
 *   2. This page extracts code + provider from URL search params
 *   3. POST /oauth/callback → backend exchanges code → returns JWT
 *   4. Store JWT in localStorage (same as password login)
 *   5. Decode JWT payload, set auth state, navigate to /dashboard
 *
 * Error handling:
 *   - Missing params → error message + link to /login
 *   - Backend exchange failure → display error detail
 *   - Never exposes code or secrets in any rendered output
 */
import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import client from '../api'

export default function OAuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { login: _loginUnused, ...auth } = useAuth()
  const [status, setStatus] = useState('exchanging') // exchanging | success | error
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const code = searchParams.get('code')
    const provider = searchParams.get('provider') || searchParams.get('state')
    // GitHub appends 'state' if we passed it; Google uses 'code' only.
    // We determine provider from the 'provider' param we embed in redirect_uri
    // or from the URL pattern — here we check a 'provider' param added by our
    // OAuth URL builder (see api.js getOAuthUrl).
    const resolvedProvider = searchParams.get('provider') || _inferProvider()

    if (!code) {
      setStatus('error')
      setErrorMsg('Authorization code missing from callback URL. Did you cancel the OAuth flow?')
      return
    }

    if (!resolvedProvider) {
      setStatus('error')
      setErrorMsg('Unknown OAuth provider. Please try logging in again.')
      return
    }

    const redirectUri = `${window.location.origin}/oauth/callback`

    client
      .post('/oauth/callback', {
        provider: resolvedProvider,
        code,
        redirect_uri: redirectUri,
      })
      .then((res) => {
        const { access_token } = res.data
        localStorage.setItem('token', access_token)

        // Update auth context by triggering a page reload — auth.jsx reads
        // from localStorage on mount, so navigate + reload is cleanest.
        setStatus('success')
        // Small delay so user sees "Authenticated!" before redirect
        setTimeout(() => navigate('/dashboard', { replace: true }), 800)
      })
      .catch((err) => {
        const detail =
          err.response?.data?.detail ||
          err.message ||
          'OAuth exchange failed'
        setStatus('error')
        setErrorMsg(typeof detail === 'string' ? detail : JSON.stringify(detail))
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-mesh-bg flex items-center justify-center">
      <div className="card max-w-md w-full mx-4 text-center space-y-4">
        {status === 'exchanging' && (
          <>
            <div className="text-mesh-accent text-2xl font-bold">MeshEngine</div>
            <div className="flex justify-center">
              <span className="w-6 h-6 border-2 border-mesh-accent border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-mesh-muted text-sm">Completing authentication…</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="text-mesh-green text-4xl">✓</div>
            <p className="text-gray-100 font-semibold">Authenticated!</p>
            <p className="text-mesh-muted text-sm">Redirecting to dashboard…</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-mesh-red text-4xl">✕</div>
            <p className="text-gray-100 font-semibold">Authentication Failed</p>
            <p className="text-mesh-muted text-sm">{errorMsg}</p>
            <a
              href="/login"
              className="inline-block mt-2 text-mesh-accent text-sm hover:underline"
            >
              ← Back to login
            </a>
          </>
        )}
      </div>
    </div>
  )
}

/** Attempt to infer provider from the current URL hostname or path. */
function _inferProvider() {
  // When Google redirects, it doesn't add custom params — check if 'state'
  // param or known query patterns are present. This is a best-effort heuristic;
  // the backend will validate the code regardless.
  const params = new URLSearchParams(window.location.search)
  if (params.get('state')) return params.get('state') // We set state=provider
  // Fallback: check referrer (not reliable cross-browser)
  const ref = document.referrer || ''
  if (ref.includes('github.com')) return 'github'
  if (ref.includes('google.com') || ref.includes('accounts.google')) return 'google'
  return null
}
