import React, { useState, useEffect, useRef, useCallback } from 'react'
import { listNodes } from '../../api'

const WS_URL = (import.meta.env.VITE_WS_URL || 'ws://localhost:8000') + '/ws/stream'
const GRID_W = 600
const GRID_H = 400
const NODE_R = 12
const POLL_MS = 3000

function scaleCoords(nodes) {
  if (!nodes.length) return nodes
  const xs = nodes.map((n) => n.x)
  const ys = nodes.map((n) => n.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  const pad = 48
  return nodes.map((n) => ({
    ...n,
    sx: pad + ((n.x - minX) / rangeX) * (GRID_W - pad * 2),
    sy: pad + ((n.y - minY) / rangeY) * (GRID_H - pad * 2),
  }))
}

export default function LiveViz() {
  const [nodes, setNodes] = useState([])
  const [activeHop, setActiveHop] = useState(null) // { from, to }
  const [wsStatus, setWsStatus] = useState('disconnected')
  const wsRef = useRef(null)

  const fetchNodes = useCallback(async () => {
    try {
      const res = await listNodes()
      setNodes(scaleCoords(res.data))
    } catch { /* ignore */ }
  }, [])

  // Poll node state
  useEffect(() => {
    fetchNodes()
    const id = setInterval(fetchNodes, POLL_MS)
    return () => clearInterval(id)
  }, [fetchNodes])

  // WebSocket for live hop events
  useEffect(() => {
    let ws
    const connect = () => {
      ws = new WebSocket(WS_URL)
      wsRef.current = ws
      ws.onopen = () => setWsStatus('connected')
      ws.onclose = () => {
        setWsStatus('disconnected')
        setTimeout(connect, 3000)
      }
      ws.onerror = () => setWsStatus('error')
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'hop') {
            setActiveHop({ from: msg.from, to: msg.to })
            setTimeout(() => setActiveHop(null), 800)
          }
        } catch { /* ignore */ }
      }
    }
    connect()
    return () => ws?.close()
  }, [])

  const scaled = nodes

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-100">Live Visualization</h2>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`w-2 h-2 rounded-full ${
              wsStatus === 'connected' ? 'bg-mesh-green animate-pulse' : 'bg-mesh-muted'
            }`}
          />
          <span className="text-mesh-muted">WS {wsStatus}</span>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <svg
          width={GRID_W}
          height={GRID_H}
          className="w-full bg-mesh-bg"
          viewBox={`0 0 ${GRID_W} ${GRID_H}`}
        >
          {/* Grid dots */}
          {Array.from({ length: 10 }, (_, i) =>
            Array.from({ length: 7 }, (_, j) => (
              <circle
                key={`${i}-${j}`}
                cx={i * (GRID_W / 9)}
                cy={j * (GRID_H / 6)}
                r={1}
                fill="#30363d"
              />
            ))
          )}

          {/* Links */}
          {scaled.map((n) =>
            scaled
              .filter((m) => m.id !== n.id && Math.hypot(m.x - n.x, m.y - n.y) < 150)
              .map((m) => {
                const isActive =
                  activeHop &&
                  ((activeHop.from === n.id && activeHop.to === m.id) ||
                   (activeHop.from === m.id && activeHop.to === n.id))
                return (
                  <line
                    key={`${n.id}-${m.id}`}
                    x1={n.sx} y1={n.sy}
                    x2={m.sx} y2={m.sy}
                    stroke={isActive ? '#58a6ff' : '#30363d'}
                    strokeWidth={isActive ? 2 : 1}
                    opacity={isActive ? 1 : 0.5}
                  />
                )
              })
          )}

          {/* Nodes */}
          {scaled.map((n) => {
            const isHop = activeHop && (activeHop.from === n.id || activeHop.to === n.id)
            const color = n.status === 'UP'
              ? (isHop ? '#58a6ff' : '#3fb950')
              : '#f85149'
            return (
              <g key={n.id}>
                <circle
                  cx={n.sx} cy={n.sy} r={NODE_R}
                  fill={color}
                  fillOpacity={0.15}
                  stroke={color}
                  strokeWidth={isHop ? 2.5 : 1.5}
                />
                {isHop && (
                  <circle
                    cx={n.sx} cy={n.sy} r={NODE_R + 6}
                    fill="none"
                    stroke={color}
                    strokeWidth={1}
                    opacity={0.4}
                  />
                )}
                <text
                  x={n.sx} y={n.sy + 4}
                  textAnchor="middle"
                  fill={color}
                  fontSize={8}
                  fontFamily="monospace"
                >
                  {n.name?.slice(0, 6)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex gap-6 text-xs text-mesh-muted">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-mesh-green" /> UP</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-mesh-red" /> DOWN</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-mesh-accent" /> Active hop</span>
        <span className="ml-auto">{nodes.length} nodes · polling every {POLL_MS / 1000}s</span>
      </div>
    </div>
  )
}
