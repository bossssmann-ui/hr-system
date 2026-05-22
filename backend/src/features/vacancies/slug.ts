import type { DbClient } from '../../db'

/**
 * Convert a title to a URL-safe slug.
 * Lowercases, strips non-alphanumeric characters (except hyphens), and
 * collapses runs of hyphens into one.
 */
export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '') // strip punctuation (preserve Unicode letters/digits)
    .trim()
    .replace(/[\s_]+/g, '-') // spaces/underscores → hyphen
    .replace(/-{2,}/g, '-') // collapse consecutive hyphens
    .replace(/^-|-$/g, '') // trim leading/trailing hyphens
    .slice(0, 80) // max length
}

/**
 * Generate a slug that is unique within the tenant, appending a numeric
 * suffix if the base slug is already taken.
 *
 * e.g. "frontend-engineer", "frontend-engineer-2", "frontend-engineer-3" …
 */
export async function generateSlug(
  title: string,
  tenantId: string,
  prisma: DbClient,
): Promise<string> {
  const base = titleToSlug(title) || 'vacancy'

  // Check if the base slug is available.
  const existing = await prisma.vacancy.findFirst({
    where: { tenantId, slug: base },
    select: { id: true },
  })

  if (!existing) return base

  // Find all slugs starting with the base for this tenant to pick next suffix.
  const conflicting = await prisma.vacancy.findMany({
    where: { tenantId, slug: { startsWith: base } },
    select: { slug: true },
  })

  const taken = new Set(conflicting.map((v) => v.slug))

  for (let i = 2; i <= 999; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }

  // Extremely unlikely fallback — append a short random suffix.
  return `${base}-${Math.random().toString(36).slice(2, 7)}`
}
