/**
 * Phase 9 — Knowledge Hub (RAG) service.
 *
 * `searchKnowledge` runs a Postgres full-text search against the `tsvector`
 * column maintained by a trigger. We deliberately use the `simple` config so
 * the same query works for RU + EN content without extra dictionaries.
 *
 * Semantic search via pgvector embeddings is intentionally a TODO behind the
 * `KNOWLEDGE_HUB_PGVECTOR_ENABLED` flag — when it is false (the default), we
 * fall back to text search, which the DoD explicitly accepts.
 *
 * The trigger keeps `search_vector` in sync, so callers only ever supply the
 * raw `title` + `body` (no manual tsvector handling in app code).
 */

import { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'

export type KnowledgeSearchHit = {
  id: string
  title: string
  snippet: string
  rank: number
  tags: string[]
  visibility: string
  updatedAt: string
}

/**
 * Build a `tsquery` from arbitrary user input. We OR all alphanumeric tokens
 * with `:*` so prefix matches work (e.g. "onboard" matches "onboarding").
 * Tokens shorter than 2 chars are dropped to avoid stop-word noise.
 */
export function buildTsQuery(raw: string): string {
  const tokens = raw
    .toLowerCase()
    // Keep Cyrillic + Latin letters + digits; drop punctuation.
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 16)
  if (tokens.length === 0) return ''
  return tokens.map((t) => `${t}:*`).join(' | ')
}

export async function searchKnowledge({
  prisma,
  tenantId,
  query,
  limit = 20,
  visibility,
}: {
  prisma: DbClient
  tenantId: string
  query: string
  limit?: number
  visibility?: 'internal' | 'portal'
}): Promise<KnowledgeSearchHit[]> {
  const tsQuery = buildTsQuery(query)
  if (!tsQuery) return []

  const visibilityFilter = visibility ? Prisma.sql`AND visibility = ${visibility}` : Prisma.empty

  // ts_rank_cd weights document parts (we already weighted A/B in the
  // trigger). We use a positional headline for the snippet (StartSel/StopSel
  // markers stripped client-side — keep them deterministic for tests).
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      title: string
      snippet: string
      rank: number
      tags: string[]
      visibility: string
      updated_at: Date
    }>
  >`
    SELECT
      id,
      title,
      ts_headline('simple', body, to_tsquery('simple', ${tsQuery}),
        'MaxFragments=2, MaxWords=20, MinWords=5, StartSel=<<, StopSel=>>') AS snippet,
      ts_rank_cd(search_vector, to_tsquery('simple', ${tsQuery}))::float AS rank,
      tags,
      visibility,
      updated_at
    FROM knowledge_articles
    WHERE tenant_id = ${tenantId}::uuid
      AND deleted_at IS NULL
      AND search_vector @@ to_tsquery('simple', ${tsQuery})
      ${visibilityFilter}
    ORDER BY rank DESC, updated_at DESC
    LIMIT ${limit}
  `

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: r.snippet,
    rank: r.rank,
    tags: r.tags,
    visibility: r.visibility,
    updatedAt: r.updated_at.toISOString(),
  }))
}
