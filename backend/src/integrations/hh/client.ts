import type { AppEnv } from '../../env'
import type {
  HhClient,
  HhEmployerVacancy,
  HhNegotiationCollection,
  HhNegotiationsPage,
  HhResume,
  HhTokens,
} from './types'

const HH_API_BASE_URL = 'https://api.hh.ru'
// Per the current hh.ru OpenAPI spec the OAuth token endpoint lives on the API
// host (https://api.hh.ru/token). The legacy https://hh.ru/oauth/token endpoint
// is no longer documented. Authorization (user redirect) still uses hh.ru/oauth/authorize.
const HH_TOKEN_URL = 'https://api.hh.ru/token'
const SAFE_RATE_LIMIT_RPS = 8
const RETRY_BASE_DELAY_MS = 250
const DEFAULT_TIMEOUT_MS = 10_000
const HH_CLIENT_USER_AGENT = 'hr-system/1.0 (career.pacificstar.ru)'

type HttpRequest = {
  method: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
  body?: string
}

type HttpResponse = {
  status: number
  headers: Record<string, string>
  body: unknown
}

export type HhHttpTransport = (request: HttpRequest) => Promise<HttpResponse>

export type CreateHhClientOptions = {
  env: Pick<AppEnv, 'HH_CLIENT_ID' | 'HH_CLIENT_SECRET'>
  http?: HhHttpTransport
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export class HhRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`HH request failed: ${status}`)
  }
}

export function createHhClient(options: CreateHhClientOptions): HhClient {
  const http = options.http ?? createFetchTransport()
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let nextAllowedAt = 0

  async function requestJson<T>(
    request: HttpRequest,
    opts: { retries?: number; bypassRateLimit?: boolean } = {},
  ): Promise<T> {
    if (!opts.bypassRateLimit && isHhApiUrl(request.url)) {
      const waitMs = Math.max(0, nextAllowedAt - now())
      if (waitMs > 0) {
        await sleep(waitMs)
      }
      nextAllowedAt = Math.max(now(), nextAllowedAt) + Math.ceil(1000 / SAFE_RATE_LIMIT_RPS)
    }

    const retries = opts.retries ?? 4
    let attempt = 0

    // hh.ru rejects every request without a User-Agent (incl. OAuth token
    // exchange). Inject it centrally so token requests are covered too.
    const requestWithUserAgent: HttpRequest = {
      ...request,
      headers: {
        'User-Agent': HH_CLIENT_USER_AGENT,
        ...request.headers,
      },
    }

    while (true) {
      const response = await http(requestWithUserAgent)
      if (response.status === 429 && attempt < retries) {
        const retryAfterHeader = response.headers['retry-after']
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN
        const retryAfterMs = Number.isFinite(retryAfterSeconds)
          ? Math.max(0, retryAfterSeconds * 1000)
          : RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
        attempt += 1
        await sleep(retryAfterMs)
        continue
      }

      if (response.status < 200 || response.status >= 300) {
        throw new HhRequestError(response.status, response.body)
      }

      return response.body as T
    }
  }

  async function tokenRequest(body: URLSearchParams): Promise<HhTokens> {
    const data = await requestJson<{
      access_token: string
      refresh_token: string
      expires_in: number
    }>(
      {
        method: 'POST',
        url: HH_TOKEN_URL,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
      { bypassRateLimit: true },
    )

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresInSeconds: data.expires_in,
    }
  }

  function authHeaders(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': HH_CLIENT_USER_AGENT,
    }
  }

  return {
    async getMe(accessToken) {
      return requestJson<{ id?: string; employer?: { id?: string } }>(
        {
          method: 'GET',
          url: `${HH_API_BASE_URL}/me`,
          headers: authHeaders(accessToken),
        },
        { bypassRateLimit: true },
      )
    },

    async exchangeAuthorizationCode(input) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: options.env.HH_CLIENT_ID ?? '',
        client_secret: options.env.HH_CLIENT_SECRET ?? '',
        code: input.code,
        redirect_uri: input.redirectUri,
      })
      return tokenRequest(body)
    },

    async refreshAccessToken(input) {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: options.env.HH_CLIENT_ID ?? '',
        client_secret: options.env.HH_CLIENT_SECRET ?? '',
        refresh_token: input.refreshToken,
      })
      return tokenRequest(body)
    },

    async listEmployerVacancies(accessToken, page = 0) {
      const me = await this.getMe(accessToken)
      const employerId = me.employer?.id
      if (!employerId) return []

      const data = await requestJson<{ items?: Array<{ id?: string | number; name?: string; archived?: boolean }> }>(
        {
          method: 'GET',
          url: `${HH_API_BASE_URL}/employers/${encodeURIComponent(employerId)}/vacancies/active?page=${page}`,
          headers: authHeaders(accessToken),
        },
      )

      return (data.items ?? [])
        .filter((item): item is { id: string | number; name?: string; archived?: boolean } => item.id !== undefined)
        .map((item): HhEmployerVacancy => ({ id: String(item.id), name: item.name ?? '', archived: item.archived }))
    },

    async getNegotiationCollections(accessToken, vacancyId) {
      const data = await requestJson<{ collections?: Array<{ id?: string; name?: string; type?: string; url?: string }> }>(
        {
          method: 'GET',
          url: `${HH_API_BASE_URL}/negotiations?vacancy_id=${encodeURIComponent(vacancyId)}`,
          headers: authHeaders(accessToken),
        },
      )

      return (data.collections ?? [])
        .filter((collection): collection is { id?: string; name?: string; type?: string; url: string } => Boolean(collection.url))
        .map((collection): HhNegotiationCollection => ({
          id: collection.id,
          name: collection.name,
          type: collection.type,
          url: absoluteCollectionUrl(collection.url),
        }))
    },

    async listNegotiations(accessToken, collectionUrl, page = 0) {
      const url = new URL(absoluteCollectionUrl(collectionUrl))
      url.searchParams.set('page', String(page))

      const data = await requestJson<HhNegotiationsPage>({
        method: 'GET',
        url: url.toString(),
        headers: authHeaders(accessToken),
      })

      return {
        found: data.found ?? 0,
        pages: data.pages ?? 0,
        page: data.page ?? page,
        per_page: data.per_page ?? 20,
        items: data.items ?? [],
      }
    },

    async getResume(accessToken, resumeId) {
      return requestJson<HhResume>({
        method: 'GET',
        url: `${HH_API_BASE_URL}/resumes/${encodeURIComponent(resumeId)}`,
        headers: authHeaders(accessToken),
      })
    },
  }
}

function absoluteCollectionUrl(url: string) {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    if (!isHhApiUrl(url)) {
      throw new Error('Unexpected negotiations collection host')
    }
    return url
  }
  if (url.startsWith('/')) return `${HH_API_BASE_URL}${url}`
  return `${HH_API_BASE_URL}/${url}`
}

function isHhApiUrl(value: string) {
  try {
    const url = new URL(value)
    return url.origin === HH_API_BASE_URL
  } catch {
    return false
  }
}

function createFetchTransport(): HhHttpTransport {
  return async (request) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      })

      let body: unknown = null
      if (response.status !== 204) {
        const text = await response.text()
        body = text.length > 0 ? JSON.parse(text) : null
      }

      const headers: Record<string, string> = {}
      for (const [key, value] of response.headers.entries()) {
        headers[key.toLowerCase()] = value
      }

      return {
        status: response.status,
        headers,
        body,
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
