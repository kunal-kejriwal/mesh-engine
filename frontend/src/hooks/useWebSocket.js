/**
 * useWebSocket — shared, event-driven WebSocket hook.
 *
 * Connects to /ws/simulation (the ConnectionManager-backed endpoint).
 * Provides:
 *   - events: rolling ring-buffer of last N events (default 200)
 *   - status: 'connecting' | 'connected' | 'disconnected' | 'error'
 *   - subscribe(eventType, handler): listen for specific event types
 *   - unsubscribe(eventType, handler): remove a listener
 *   - clear(): flush the event buffer
 *
 * Design constraints:
 *   - Auto-reconnects with exponential backoff (cap 30s)
 *   - Never blocks the main thread (all state updates via setState)
 *   - Idempotent: safe to mount multiple consumers — share via Context
 *   - Does NOT poll — purely event-driven
 *   - Graceful degradation: if WS fails, existing UI continues working
 */
import { useState, useEffect, useRef, useCallback } from 'react'

const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:8000'
const WS_URL = `${WS_BASE}/ws/simulation`
const MAX_EVENTS = 200
const BASE_RECONNECT_MS = 1000
const MAX_RECONNECT_MS = 30_000

export function useWebSocket() {
  const [events, setEvents] = useState([])
  const [status, setStatus] = useState('disconnected')
  const wsRef = useRef(null)
  const listenersRef = useRef(new Map()) // eventType → Set<handler>
  const reconnectDelay = useRef(BASE_RECONNECT_MS)
  const reconnectTimer = useRef(null)
  const unmounted = useRef(false)

  const dispatch = useCallback((event) => {
    // Append to rolling buffer
    setEvents((prev) => {
      const next = [...prev, event]
      return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
    })

    // Notify type-specific subscribers
    const type = event.event_type
    const handlers = listenersRef.current.get(type)
    if (handlers) {
      handlers.forEach((fn) => {
        try { fn(event) } catch { /* isolate handler errors */ }
      })
    }

    // Notify wildcard subscribers
    const wildcards = listenersRef.current.get('*')
    if (wildcards) {
      wildcards.forEach((fn) => {
        try { fn(event) } catch { /* isolate */ }
      })
    }
  }, [])

  const connect = useCallback(() => {
    if (unmounted.current) return

    setStatus('connecting')
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      if (unmounted.current) { ws.close(); return }
      setStatus('connected')
      reconnectDelay.current = BASE_RECONNECT_MS
    }

    ws.onmessage = (e) => {
      if (unmounted.current) return
      try {
        const msg = JSON.parse(e.data)
        if (msg.event_type && msg.event_type !== 'PING') {
          dispatch(msg)
        }
      } catch { /* malformed frame — ignore */ }
    }

    ws.onerror = () => {
      if (!unmounted.current) setStatus('error')
    }

    ws.onclose = () => {
      if (unmounted.current) return
      setStatus('disconnected')
      const delay = reconnectDelay.current
      reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_MS)
      reconnectTimer.current = setTimeout(connect, delay)
    }
  }, [dispatch])

  useEffect(() => {
    unmounted.current = false
    connect()
    return () => {
      unmounted.current = true
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const subscribe = useCallback((eventType, handler) => {
    const map = listenersRef.current
    if (!map.has(eventType)) map.set(eventType, new Set())
    map.get(eventType).add(handler)
  }, [])

  const unsubscribe = useCallback((eventType, handler) => {
    listenersRef.current.get(eventType)?.delete(handler)
  }, [])

  const clear = useCallback(() => setEvents([]), [])

  return { events, status, subscribe, unsubscribe, clear }
}
