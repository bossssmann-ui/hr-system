import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { KnowledgeSearchResponse } from '@web-app-demo/contracts'

import { useAuth } from '@/lib/use-auth'

export function PortalPage() {
  const { t } = useTranslation('portal')
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-12">
      <h1>{t('portal.title')}</h1>
      <p>{t('portal.description')}</p>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>{t('portal.myLearning')}</h2>
        <p>{t('portal.myLearningDescription')}</p>
      </section>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>{t('portal.reviewRequests')}</h2>
        <p>{t('portal.reviewRequestsDescription')}</p>
      </section>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>{t('portal.okrs')}</h2>
        <p>{t('portal.okrsDescription')}</p>
      </section>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>{t('portal.idp')}</h2>
        <p>{t('portal.idpDescription')}</p>
      </section>
      <KnowledgeSearchSection />
      <p>
        <em>{t('portal.soon')}</em>
      </p>
    </section>
  )
}

/** Phase 9 — Knowledge Hub search for employees (portal-visible articles). */
function KnowledgeSearchSection() {
  const { api, user } = useAuth()
  const { t } = useTranslation(['portal', 'common'])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KnowledgeSearchResponse | null>(null)

  const search = useMutation({
    mutationFn: (q: string) => api.searchKnowledge({ query: q, limit: 10, visibility: 'portal' }),
    onSuccess: (data) => setResults(data),
  })

  if (!user) return null

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2>{t('portal:portal.knowledgeHub')}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (query.trim()) search.mutate(query.trim())
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('portal:portal.searchPlaceholder')}
          style={{ width: '60%', padding: '0.3rem 0.5rem' }}
        />{' '}
        <button type="submit" disabled={search.isPending || query.trim().length === 0}>
          {search.isPending ? t('common:actions.searching') : t('common:actions.search')}
        </button>
      </form>
      {results && (
        <div style={{ marginTop: '0.75rem' }}>
          {results.items.length === 0 ? (
            <p>{t('common:empty.noMatches')}</p>
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
