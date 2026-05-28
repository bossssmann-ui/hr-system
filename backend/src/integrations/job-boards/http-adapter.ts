/**
 * HttpJobBoardAdapter — common base for Phase 8 REST-style job-board
 * adapters. Concrete adapters supply their base URL, board key, and the
 * subset of REST endpoints they expose.
 *
 * The networking layer is injectable (`transport`) so tests can stub it
 * out without performing live HTTP calls. The default transport uses the
 * runtime `fetch` with bearer-token auth and a short timeout.
 */
import type {
  ExternalApplication,
  IJobBoardAdapter,
  JobBoardKey,
  JobBoardVacancyInput,
} from './adapter'

export type JobBoardTransport = (request: {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  query?: Record<string, string>
  body?: unknown
}) => Promise<unknown>

export type HttpJobBoardOptions = {
  board: JobBoardKey
  baseUrl: string
  apiToken: string
  transport?: JobBoardTransport
  /** Maps the board-specific application payload onto the shared shape. */
  parseApplication?: (payload: unknown) => ExternalApplication | null
}

const DEFAULT_TIMEOUT_MS = 10_000

export function createBearerTransport(baseUrl: string, apiToken: string): JobBoardTransport {
  return async ({ method, path, query, body }) => {
    const url = new URL(path, baseUrl)
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: Object.fromEntries([
          ['Authorization', 'Bearer ' + apiToken],
          ['Content-Type', 'application/json'],
        ]),
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!res.ok) {
        throw new Error(`Job board request failed: ${method} ${path} -> ${res.status}`)
      }
      if (res.status === 204) return null
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }
}

export class HttpJobBoardAdapter implements IJobBoardAdapter {
  readonly board: JobBoardKey
  protected readonly transport: JobBoardTransport
  protected readonly parseApplication?: (payload: unknown) => ExternalApplication | null

  constructor(options: HttpJobBoardOptions) {
    this.board = options.board
    this.transport = options.transport ?? createBearerTransport(options.baseUrl, options.apiToken)
    this.parseApplication = options.parseApplication
  }

  async publishVacancy(vacancy: JobBoardVacancyInput): Promise<string> {
    const payload = await this.transport({
      method: 'POST',
      path: '/vacancies',
      body: {
        external_id: vacancy.id,
        title: vacancy.title,
        description: vacancy.description,
        location: vacancy.location ?? null,
        salary_from: vacancy.salaryFrom ?? null,
        salary_to: vacancy.salaryTo ?? null,
        currency: vacancy.currency ?? null,
        apply_url: vacancy.applyUrl ?? null,
      },
    })
    const externalId = extractStringField(payload, ['id', 'external_id', 'vacancy_id'])
    if (!externalId) {
      throw new Error(`${this.board} publishVacancy: missing id in response`)
    }
    return externalId
  }

  async unpublishVacancy(externalId: string): Promise<void> {
    await this.transport({ method: 'DELETE', path: `/vacancies/${encodeURIComponent(externalId)}` })
  }

  async pullApplications(since: Date): Promise<ExternalApplication[]> {
    const payload = await this.transport({
      method: 'GET',
      path: '/applications',
      query: { since: since.toISOString() },
    })
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { items?: unknown[] } | null)?.items)
        ? (payload as { items: unknown[] }).items
        : []

    const parsed: ExternalApplication[] = []
    for (const raw of items) {
      const item = this.parseApplication ? this.parseApplication(raw) : defaultParseApplication(raw)
      if (item) parsed.push(item)
    }
    return parsed
  }

  async updateApplicationStatus(externalId: string, status: string): Promise<void> {
    await this.transport({
      method: 'PUT',
      path: `/applications/${encodeURIComponent(externalId)}/status`,
      body: { status },
    })
  }
}

function extractStringField(payload: unknown, keys: string[]): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

export function defaultParseApplication(raw: unknown): ExternalApplication | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const externalId = extractStringField(r, ['id', 'external_id', 'application_id'])
  if (!externalId) return null
  const candidate = (r.candidate ?? {}) as Record<string, unknown>
  const fullName =
    typeof candidate.full_name === 'string'
      ? candidate.full_name
      : typeof candidate.name === 'string'
        ? candidate.name
        : 'Unknown candidate'
  const receivedAtRaw = r.received_at ?? r.created_at
  const receivedAt = typeof receivedAtRaw === 'string' ? new Date(receivedAtRaw) : new Date()
  return {
    externalId,
    receivedAt: Number.isFinite(receivedAt.getTime()) ? receivedAt : new Date(),
    candidate: {
      fullName,
      email: typeof candidate.email === 'string' ? candidate.email : null,
      phone: typeof candidate.phone === 'string' ? candidate.phone : null,
      resumeUrl: typeof candidate.resume_url === 'string' ? candidate.resume_url : null,
    },
    vacancyExternalId:
      typeof r.vacancy_external_id === 'string'
        ? r.vacancy_external_id
        : typeof r.vacancy_id === 'string'
          ? r.vacancy_id
          : null,
    coverLetter: typeof r.cover_letter === 'string' ? r.cover_letter : null,
  }
}
