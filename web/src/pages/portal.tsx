import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import type { KnowledgeSearchResponse } from '@web-app-demo/contracts'

import { useAuth } from '@/lib/use-auth'

export function PortalPage() {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>Employee Self-Service Portal</h1>
      <p>View your onboarding tasks, documents, and personal employment details.</p>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>My learning</h2>
        <p>Courses and learning paths assigned to you.</p>
      </section>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>Pending review requests</h2>
        <p>360° feedback waiting on your input.</p>
      </section>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>My OKRs</h2>
        <p>Quarterly objectives and key results.</p>
      </section>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>My IDP</h2>
        <p>Individual development plan for the current quarter.</p>
      </section>
      <KnowledgeSearchSection />
      <p>
        <em>Full self-service portal content lands alongside the Phase 6 UI.</em>
      </p>
    </div>
  )
}

/** Phase 9 — Knowledge Hub search for employees (portal-visible articles). */
function KnowledgeSearchSection() {
  const { api, user } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KnowledgeSearchResponse | null>(null)

  const search = useMutation({
    mutationFn: (q: string) => api.searchKnowledge({ query: q, limit: 10, visibility: 'portal' }),
    onSuccess: (data) => setResults(data),
  })

  if (!user) return null

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2>Knowledge Hub</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (query.trim()) search.mutate(query.trim())
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search HR articles…"
          style={{ width: '60%', padding: '0.3rem 0.5rem' }}
        />{' '}
        <button type="submit" disabled={search.isPending || query.trim().length === 0}>
          {search.isPending ? 'Searching…' : 'Search'}
        </button>
      </form>
      {results && (
        <div style={{ marginTop: '0.75rem' }}>
          {results.items.length === 0 ? (
            <p>No matches.</p>
          ) : (
            <ul>
              {results.items.map((hit) => (
                <li key={hit.id}>
                  <strong>{hit.title}</strong>
                  <div style={{ color: '#555' }}>
                    {hit.snippet.replace(/<<|>>/g, '')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
