/**
 * useSimulation — simulation state management hook.
 *
 * Wraps the /simulation/start API call and provides structured state
 * for the SimulationLab UI. Subscribes to WS events to track live
 * progress of a running simulation without polling.
 *
 * State:
 *   phase: 'idle' | 'running' | 'done' | 'error'
 *   result: SimulationResult | null
 *   liveEvents: events emitted during this simulation run
 *   error: string | null
 *
 * Idempotent: calling run() while 'running' is a no-op.
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import client from '../api'

export function useSimulation(wsSubscribe, wsUnsubscribe) {
  const [phase, setPhase] = useState('idle')
  const [result, setResult] = useState(null)
  const [liveEvents, setLiveEvents] = useState([])
  const [error, setError] = useState(null)
  const currentSimId = useRef(null)

  // Subscribe to WS events that belong to the active simulation
  useEffect(() => {
    if (!wsSubscribe) return

    const handler = (event) => {
      const simId = event.simulation_id
      // Accept events with no sim_id (node events) or matching sim_id
      if (!simId || simId === currentSimId.current) {
        setLiveEvents((prev) => [...prev, event])
      }
    }

    const types = [
      'SIMULATION_STARTED', 'ROUTE_COMPUTED', 'NODE_DOWN', 'NODE_RECOVERED',
      'ROUTE_RECOMPUTED', 'SIMULATION_COMPLETED', 'SIMULATION_FAILED',
      'MESSAGE_SENT', 'MESSAGE_HOP', 'MESSAGE_DELIVERED', 'MESSAGE_FAILED',
    ]
    types.forEach((t) => wsSubscribe(t, handler))
    return () => types.forEach((t) => wsUnsubscribe?.(t, handler))
  }, [wsSubscribe, wsUnsubscribe])

  const run = useCallback(async ({
    networkId,
    sourceId,
    destinationId,
    payload = 'LAB_SIMULATION',
    failNodes = [],
  }) => {
    if (phase === 'running') return

    setPhase('running')
    setResult(null)
    setError(null)
    setLiveEvents([])
    currentSimId.current = null

    try {
      const res = await client.post('/simulation/start', {
        network_id: networkId,
        source_id: sourceId,
        destination_id: destinationId,
        payload,
        fail_nodes: failNodes.length ? failNodes : undefined,
      })
      currentSimId.current = res.data.simulation_id
      setResult(res.data)
      setPhase('done')
    } catch (err) {
      const msg =
        err.response?.data?.detail?.message ||
        err.response?.data?.detail ||
        err.message ||
        'Simulation failed'
      setError(String(msg))
      setPhase('error')
    }
  }, [phase])

  const reset = useCallback(() => {
    setPhase('idle')
    setResult(null)
    setError(null)
    setLiveEvents([])
    currentSimId.current = null
  }, [])

  return { phase, result, liveEvents, error, run, reset }
}
