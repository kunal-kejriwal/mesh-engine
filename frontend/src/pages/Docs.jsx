import React, { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const DOC_PAGES = [
  { slug: 'api',   label: 'API Documentation',  file: '/docs/API_Documentation.md' },
  { slug: 'about', label: 'About MeshEngine',   file: '/docs/About_MeshEngine.md' },
  { slug: 'git',   label: 'Git Setup',          file: '/docs/GIT_SETUP.md' },
  { slug: 'local', label: 'Local Setup',        file: '/docs/LOCAL_SETUP.md' },
  { slug: 'run',   label: 'Run & Test',         file: '/docs/RUN_AND_TEST.md' },
]

function Sidebar({ current, onChange }) {
  return (
    <aside className="w-56 shrink-0 border-r border-mesh-border min-h-screen pt-6 pr-4">
      <div className="text-xs text-mesh-muted uppercase tracking-widest mb-4 px-2">Documentation</div>
      <nav className="flex flex-col gap-0.5">
        {DOC_PAGES.map(({ slug, label }) => (
          <button
            key={slug}
            onClick={() => onChange(slug)}
            className={`text-left px-3 py-2 rounded text-sm transition-colors ${
              current === slug
                ? 'bg-mesh-accent/10 text-mesh-accent border-l-2 border-mesh-accent'
                : 'text-mesh-muted hover:text-gray-100 hover:bg-mesh-surface'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="mt-8 px-2">
        <Link to="/" className="text-xs text-mesh-muted hover:text-mesh-accent transition-colors">
          ← Home
        </Link>
      </div>
    </aside>
  )
}

const mdComponents = {
  h1: ({ children }) => <h1 className="text-2xl font-bold text-gray-100 mb-4 mt-2 pb-2 border-b border-mesh-border">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-bold text-gray-100 mb-3 mt-8">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-semibold text-gray-100 mb-2 mt-6">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-semibold text-mesh-accent mb-2 mt-4">{children}</h4>,
  p: ({ children }) => <p className="text-mesh-muted mb-4 leading-relaxed text-sm">{children}</p>,
  a: ({ href, children }) => <a href={href} className="text-mesh-accent hover:underline">{children}</a>,
  code: ({ inline, children }) =>
    inline
      ? <code className="bg-mesh-surface border border-mesh-border rounded px-1.5 py-0.5 text-xs text-mesh-green font-mono">{children}</code>
      : <code>{children}</code>,
  pre: ({ children }) => (
    <pre className="bg-mesh-surface border border-mesh-border rounded-lg p-4 overflow-x-auto mb-4 text-xs text-gray-300 leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-mesh-border">{children}</thead>,
  th: ({ children }) => <th className="text-left text-xs text-mesh-muted uppercase tracking-wider px-3 py-2">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 text-sm text-mesh-muted border-b border-mesh-border/40">{children}</td>,
  ul: ({ children }) => <ul className="list-disc list-inside text-mesh-muted text-sm mb-4 space-y-1 ml-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside text-mesh-muted text-sm mb-4 space-y-1 ml-2">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  hr: () => <hr className="border-mesh-border my-6" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-mesh-accent pl-4 text-mesh-muted italic text-sm mb-4">
      {children}
    </blockquote>
  ),
  strong: ({ children }) => <strong className="text-gray-100 font-semibold">{children}</strong>,
}

export default function Docs() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const currentSlug = slug || 'api'
  const currentPage = DOC_PAGES.find((p) => p.slug === currentSlug) || DOC_PAGES[0]

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(currentPage.file)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.text()
      })
      .then(setContent)
      .catch(() => setError('Could not load document.'))
      .finally(() => setLoading(false))
  }, [currentPage.file])

  const handleNav = (s) => navigate(`/docs/${s}`)

  return (
    <div className="min-h-screen flex">
      {/* Top bar */}
      <div className="fixed top-0 inset-x-0 h-12 border-b border-mesh-border bg-mesh-bg/95 backdrop-blur z-50 flex items-center px-6 gap-4">
        <Link to="/" className="text-mesh-accent font-bold tracking-wider text-sm">MeshEngine</Link>
        <span className="text-mesh-border">|</span>
        <span className="text-mesh-muted text-sm">Docs</span>
      </div>

      <div className="flex w-full max-w-6xl mx-auto pt-12">
        <Sidebar current={currentSlug} onChange={handleNav} />

        <main className="flex-1 px-8 py-8 min-w-0">
          {loading && (
            <div className="text-mesh-muted text-sm animate-pulse">Loading…</div>
          )}
          {error && (
            <div className="text-mesh-red text-sm">{error}</div>
          )}
          {!loading && !error && (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={mdComponents}
            >
              {content}
            </ReactMarkdown>
          )}
        </main>
      </div>
    </div>
  )
}
