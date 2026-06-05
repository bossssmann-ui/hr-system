/**
 * Phase 9 — HR Knowledge Hub page.
 *
 * Lists articles + a search box that talks to `/api/knowledge/search`.
 * Admins (hr_admin / owner) see the markdown editor for create/edit/delete;
 * other roles see read-only listing + search.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { KnowledgeArticle, KnowledgeSearchResponse } from '@web-app-demo/contracts'

import { useAuth } from '@/lib/use-auth'
import { isAdmin } from '@/lib/roles'

export function KnowledgePage() {
  const { user } = useAuth()
  if (!user) {
    return (
      <section className="mx-auto w-full max-w-6xl px-5 py-12">
        <h1>Knowledge Hub</h1>
        <p>Sign in to browse HR knowledge articles.</p>
      </section>
    )
  }
  return <KnowledgeContent />
}

function KnowledgeContent() {
  const { api, user } = useAuth()
  const queryClient = useQueryClient()
  const userIsAdmin = isAdmin(user)

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResponse | null>(null)

  const articles = useQuery({
    queryKey: ['knowledge', 'articles'],
    queryFn: () => api.listKnowledgeArticles({ limit: 100 }),
  })

  const search = useMutation({
    mutationFn: (q: string) => api.searchKnowledge({ query: q, limit: 20 }),
    onSuccess: (data) => setSearchResults(data),
  })

  const create = useMutation({
    mutationFn: (input: { title: string; body: string; visibility: 'internal' | 'portal' }) =>
      api.createKnowledgeArticle({ ...input, tags: [] }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['knowledge'] })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteKnowledgeArticle(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['knowledge'] })
    },
  })

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-12">
      <h1>Knowledge Hub</h1>

      <section style={{ marginTop: '1rem' }}>
        <h2>Search</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (query.trim()) search.mutate(query.trim())
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask the knowledge hub…"
            style={{ width: '60%', padding: '0.4rem 0.6rem' }}
          />{' '}
          <button type="submit" disabled={search.isPending || query.trim().length === 0}>
            {search.isPending ? 'Searching…' : 'Search'}
          </button>
        </form>
        {searchResults && (
          <div style={{ marginTop: '0.75rem' }}>
            <small>Mode: {searchResults.mode}</small>
            {searchResults.items.length === 0 ? (
              <p>No matches.</p>
            ) : (
              <ul>
                {searchResults.items.map((hit) => (
                  <li key={hit.id} style={{ marginBottom: '0.5rem' }}>
                    <strong>{hit.title}</strong>{' '}
                    <small style={{ color: '#666' }}>· rank {hit.rank.toFixed(3)}</small>
                    <div
                      style={{ color: '#444', marginTop: '0.25rem' }}
                      // Snippets contain `<<…>>` markers from `ts_headline` — safe (no HTML).
                      dangerouslySetInnerHTML={{
                        __html: hit.snippet
                          .replace(/&/g, '&amp;')
                          .replace(/</g, '&lt;')
                          .replace(/>/g, '&gt;')
                          .replace(/&lt;&lt;/g, '<mark>')
                          .replace(/&gt;&gt;/g, '</mark>'),
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {userIsAdmin && (
        <section style={{ marginTop: '2rem' }}>
          <h2>Create article</h2>
          <CreateArticleForm pending={create.isPending} onCreate={(data) => create.mutate(data)} />
        </section>
      )}

      <section style={{ marginTop: '2rem' }}>
        <h2>All articles</h2>
        {articles.isLoading ? (
          <p>Loading…</p>
        ) : articles.data && articles.data.items.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {articles.data.items.map((article: KnowledgeArticle) => (
              <li
                key={article.id}
                style={{ borderTop: '1px solid #eee', padding: '0.75rem 0' }}
              >
                <header style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <strong>{article.title}</strong>{' '}
                    <small style={{ color: '#888' }}>· {article.visibility}</small>
                  </div>
                  {userIsAdmin && (
                    <button type="button" onClick={() => remove.mutate(article.id)}>
                      Delete
                    </button>
                  )}
                </header>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'inherit',
                    color: '#444',
                    margin: '0.5rem 0 0',
                  }}
                >
                  {article.body.slice(0, 400)}
                  {article.body.length > 400 ? '…' : ''}
                </pre>
              </li>
            ))}
          </ul>
        ) : (
          <p>No articles yet.</p>
        )}
      </section>
    </section>
  )
}

function CreateArticleForm({
  pending,
  onCreate,
}: {
  pending: boolean
  onCreate: (input: { title: string; body: string; visibility: 'internal' | 'portal' }) => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState<'internal' | 'portal'>('internal')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim() || !body.trim()) return
        onCreate({ title: title.trim(), body, visibility })
        setTitle('')
        setBody('')
      }}
      style={{ display: 'grid', gap: '0.5rem', maxWidth: 600 }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        required
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Markdown content…"
        rows={8}
        required
      />
      <label>
        Visibility{' '}
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as 'internal' | 'portal')}>
          <option value="internal">internal (HR + managers)</option>
          <option value="portal">portal (also visible to employees)</option>
        </select>
      </label>
      <div>
        <button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create article'}
        </button>
      </div>
    </form>
  )
}
