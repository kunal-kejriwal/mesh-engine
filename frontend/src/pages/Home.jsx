import React from 'react'
import { Link } from 'react-router-dom'

function TopNav() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 border-b border-mesh-border bg-mesh-bg/90 backdrop-blur">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <span className="text-mesh-accent font-bold tracking-wider">MeshEngine</span>
        <div className="flex items-center gap-4 text-sm">
          <Link to="/docs" className="text-mesh-muted hover:text-gray-100 transition-colors">Docs</Link>
          <Link to="/login" className="text-mesh-muted hover:text-gray-100 transition-colors">Login</Link>
          <Link to="/register" className="btn-primary py-1.5">Get Started</Link>
        </div>
      </div>
    </nav>
  )
}

function Hero() {
  return (
    <section className="pt-32 pb-20 px-6 text-center max-w-4xl mx-auto">
      <div className="inline-block mb-4 px-3 py-1 rounded-full border border-mesh-border text-mesh-muted text-xs tracking-widest uppercase">
        Distributed Mesh Simulation
      </div>
      <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
        <span className="text-mesh-accent">Mesh</span>Engine
      </h1>
      <p className="text-xl text-mesh-muted mb-10 leading-relaxed max-w-2xl mx-auto">
        A distributed mesh network simulation platform — route messages across drone swarms,
        inject node failures, and watch the network self-heal in real time.
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <Link to="/docs/api" className="btn-primary px-6 py-2.5 text-base">
          Try API
        </Link>
        <Link to="/docs" className="btn-ghost px-6 py-2.5 text-base">
          View Docs
        </Link>
        <Link to="/dashboard" className="btn-ghost px-6 py-2.5 text-base">
          Dashboard →
        </Link>
      </div>
    </section>
  )
}

function WhatIs() {
  return (
    <section className="py-16 px-6 border-t border-mesh-border">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold mb-6 text-gray-100">What is MeshEngine?</h2>
        <p className="text-mesh-muted leading-relaxed mb-4">
          MeshEngine is a backend simulation engine for modelling self-healing drone mesh networks.
          You provision a set of nodes on a 2D grid, connect them by Euclidean proximity, then send
          messages from any source to any destination. The engine computes shortest paths via Dijkstra,
          publishes hop-by-hop events over Redis Pub/Sub, and streams everything live to connected clients.
        </p>
        <p className="text-mesh-muted leading-relaxed">
          Mark a node as <span className="text-mesh-red font-semibold">DOWN</span> — the next message
          automatically finds a detour. Recover the node — the topology heals.
          All state changes are persisted to PostgreSQL and replayed through a WebSocket event feed.
        </p>
      </div>
    </section>
  )
}

function Inspiration() {
  return (
    <section className="py-16 px-6 border-t border-mesh-border bg-mesh-surface/30">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold mb-6 text-gray-100">Inspiration</h2>
        <p className="text-mesh-muted leading-relaxed mb-6">
          MeshEngine is inspired by the architecture patterns found in modern distributed systems —
          workflow engines that fan-out work across many workers, queue-based processing systems that
          decouple producers from consumers, and API orchestration layers that manage state across
          asynchronous boundaries.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { icon: '⚡', title: 'Workflow Engines', desc: 'Directed-graph execution with failure isolation and retry semantics.' },
            { icon: '📬', title: 'Queue-Based Systems', desc: 'Redis Pub/Sub decouples the routing engine from node workers.' },
            { icon: '🌐', title: 'API Orchestration', desc: 'A clean REST + WebSocket surface for full observability.' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="card">
              <div className="text-2xl mb-3">{icon}</div>
              <div className="font-semibold text-gray-100 mb-1">{title}</div>
              <div className="text-sm text-mesh-muted">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ProblemSolves() {
  return (
    <section className="py-16 px-6 border-t border-mesh-border">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold mb-6 text-gray-100">Problem It Solves</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              title: 'Async Job Handling',
              desc: 'Route messages asynchronously. The API returns immediately; events propagate through the system without blocking the caller.',
            },
            {
              title: 'Scaling Execution',
              desc: 'Add more node workers to the Redis subscriber pool without touching the control plane. Horizontal scale is built in.',
            },
            {
              title: 'Reliable Processing',
              desc: 'Failure-aware Dijkstra excludes DOWN nodes before computing routes. No manual intervention — the system re-routes on its own.',
            },
          ].map(({ title, desc }) => (
            <div key={title} className="card border-l-2 border-l-mesh-accent">
              <div className="font-semibold text-gray-100 mb-2">{title}</div>
              <div className="text-sm text-mesh-muted leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Approach() {
  return (
    <section className="py-16 px-6 border-t border-mesh-border bg-mesh-surface/30">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold mb-8 text-gray-100">How It Works</h2>
        {/* Flow diagram */}
        <div className="card mb-8 overflow-x-auto">
          <pre className="text-xs text-mesh-muted leading-relaxed whitespace-pre">
{`Client                  Control Plane                Redis           Workers
  │                           │                          │                │
  │── POST /message/send ────▶│                          │                │
  │                           │── Dijkstra (excl. DOWN)  │                │
  │                           │── compute shortest path  │                │
  │◀── path + latency ────────│                          │                │
  │                           │── publish hop events ───▶│                │
  │                           │                          │──▶ NodeWorker  │
  │                           │                          │    subscribe & │
  │── GET /ws/stream ─────────┼──────────────────────────┼──▶ stream hops │
  │◀═══ live hop frames ══════╪══════════════════════════╪════════════════│`}
          </pre>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          {[
            { step: '01', label: 'API', desc: 'POST /message/send' },
            { step: '02', label: 'Dijkstra', desc: 'Shortest path\n(failure-aware)' },
            { step: '03', label: 'Redis', desc: 'Pub/Sub\nhop events' },
            { step: '04', label: 'Workers', desc: 'Subscribe\n& stream' },
          ].map(({ step, label, desc }) => (
            <div key={step} className="card text-left">
              <div className="text-mesh-muted text-xs mb-1">{step}</div>
              <div className="text-mesh-accent font-bold mb-1">{label}</div>
              <div className="text-xs text-mesh-muted whitespace-pre-line">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Demo() {
  const request = `POST /message/send
Content-Type: application/json

{
  "network_id": "3f2a1b...",
  "source_id":  "node-A",
  "destination_id": "node-C",
  "payload": "ping"
}`

  const response = `{
  "message_id": "m1...",
  "path": ["node-A", "node-B", "node-C"],
  "hop_count": 3,
  "total_latency_ms": 25.5,
  "status": "DELIVERED"
}`

  return (
    <section className="py-16 px-6 border-t border-mesh-border">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold mb-3 text-gray-100">Demo</h2>
        <p className="text-mesh-muted mb-8 text-sm">
          Example request/response — run the stack locally and try it in seconds.
        </p>

        {/* Placeholder video */}
        <div className="card flex items-center justify-center h-52 mb-8 border-dashed">
          <div className="text-center text-mesh-muted">
            <div className="text-4xl mb-2">▶</div>
            <div className="text-sm">Demo video / animated preview</div>
            <div className="text-xs mt-1 opacity-60">Coming soon</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-mesh-muted uppercase tracking-wider mb-2">Request</div>
            <pre className="card text-xs text-mesh-green overflow-x-auto whitespace-pre leading-relaxed">{request}</pre>
          </div>
          <div>
            <div className="text-xs text-mesh-muted uppercase tracking-wider mb-2">Response</div>
            <pre className="card text-xs text-mesh-accent overflow-x-auto whitespace-pre leading-relaxed">{response}</pre>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  const links = [
    { label: 'API Docs', to: '/docs/api' },
    { label: 'Git Setup', to: '/docs/git' },
    { label: 'Local Setup', to: '/docs/local' },
    { label: 'Run & Test', to: '/docs/run' },
    { label: 'About', to: '/docs/about' },
  ]
  return (
    <footer className="border-t border-mesh-border py-10 px-6 mt-8">
      <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <span className="text-mesh-accent font-bold tracking-widest">MeshEngine</span>
        <div className="flex flex-wrap gap-5 text-sm text-mesh-muted">
          {links.map(({ label, to }) => (
            <Link key={label} to={to} className="hover:text-gray-100 transition-colors">
              {label}
            </Link>
          ))}
        </div>
        <span className="text-xs text-mesh-muted opacity-50">v1.0.0</span>
      </div>
    </footer>
  )
}

export default function Home() {
  return (
    <div className="min-h-screen">
      <TopNav />
      <main>
        <Hero />
        <WhatIs />
        <Inspiration />
        <ProblemSolves />
        <Approach />
        <Demo />
      </main>
      <Footer />
    </div>
  )
}
