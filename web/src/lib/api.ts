import {
  apiErrorSchema,
  applicationDetailSchema,
  applicationSchema,
  authResponseSchema,
  createCandidateResponseSchema,
  listApplicationsResponseSchema,
  listAuditEventsResponseSchema,
  listCandidatesResponseSchema,
  listOrgUnitsResponseSchema,
  listRequisitionsResponseSchema,
  listUsersResponseSchema,
  listVacanciesResponseSchema,
  hhAuthorizeUrlResponseSchema,
  hhCallbackResponseSchema,
  hhIntegrationStatusSchema,
  hhSyncResponseSchema,
  hhVacancyLinkResponseSchema,
  linkVacancyToHhRequestSchema,
  loginRequestSchema,
  logoutRequestSchema,
  meResponseSchema,
  refreshRequestSchema,
  refreshResponseSchema,
  registerRequestSchema,
  requisitionSchema,
  vacancySchema,
  type ApplicationDetail,
  type AuthResponse,
  type CreateApplicationRequest,
  type CreateCandidateRequest,
  type CreateCandidateResponse,
  type CreateOrgUnitRequest,
  type CreateRequisitionRequest,
  type ListApplicationsResponse,
  type ListAuditEventsResponse,
  type ListCandidatesResponse,
  type ListOrgUnitsResponse,
  type ListRequisitionsResponse,
  type ListUsersResponse,
  type ListVacanciesResponse,
  type LoginRequest,
  type LogoutRequest,
  type MeResponse,
  type MoveApplicationStageRequest,
  type OrgUnit,
  type PublishVacancyRequest,
  type RefreshRequest,
  type RefreshResponse,
  type RegisterRequest,
  type Requisition,
  type ScoreFeedbackRequest,
  type TransitionRequisitionRequest,
  type Vacancy,
  type HhAuthorizeUrlResponse,
  type HhCallbackResponse,
  type HhIntegrationStatus,
  type HhSyncResponse,
  type HhVacancyLinkResponse,
  type LinkVacancyToHhRequest,
} from '@web-app-demo/contracts'
import { z } from 'zod'

const apiBaseUrl = (import.meta.env?.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

type ApiClientOptions = {
  getAccessToken: () => string | null
  setAccessToken: (accessToken: string | null) => void
  onAuthExpired?: () => void | Promise<void>
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  auth?: boolean
  retryOnUnauthorized?: boolean
  accessTokenOverride?: string
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class ApiClient {
  private readonly options: ApiClientOptions
  private refreshPromise: Promise<RefreshResponse> | null = null

  constructor(options: ApiClientOptions) {
    this.options = options
  }

  register(input: RegisterRequest): Promise<AuthResponse> {
    const payload = registerRequestSchema.parse(input)
    return this.request('/api/auth/register', authResponseSchema, {
      method: 'POST',
      body: payload,
      auth: false,
    })
  }

  login(input: LoginRequest): Promise<AuthResponse> {
    const payload = loginRequestSchema.parse(input)
    return this.request('/api/auth/login', authResponseSchema, {
      method: 'POST',
      body: payload,
      auth: false,
    })
  }

  refresh(input: RefreshRequest = {}): Promise<RefreshResponse> {
    const payload = refreshRequestSchema.parse(input)
    return this.request('/api/auth/refresh', refreshResponseSchema, {
      method: 'POST',
      body: payload,
      auth: false,
      retryOnUnauthorized: false,
    })
  }

  me(): Promise<MeResponse> {
    return this.request('/api/auth/me', meResponseSchema, {
      auth: true,
    })
  }

  // ─── Org Units ──────────────────────────────────────────────────────────────

  listOrgUnits(): Promise<ListOrgUnitsResponse> {
    return this.request('/api/org-units', listOrgUnitsResponseSchema, { auth: true })
  }

  createOrgUnit(input: CreateOrgUnitRequest): Promise<OrgUnit> {
    return this.request('/api/org-units', z.any(), {
      method: 'POST',
      body: input,
      auth: true,
    })
  }

  // ─── Requisitions ───────────────────────────────────────────────────────────

  listRequisitions(params?: { status?: string }): Promise<ListRequisitionsResponse> {
    const qs = params?.status ? `?status=${encodeURIComponent(params.status)}` : ''
    return this.request(`/api/requisitions${qs}`, listRequisitionsResponseSchema, { auth: true })
  }

  getRequisition(id: string): Promise<Requisition> {
    return this.request(`/api/requisitions/${id}`, requisitionSchema, { auth: true })
  }

  createRequisition(input: CreateRequisitionRequest): Promise<Requisition> {
    return this.request('/api/requisitions', requisitionSchema, {
      method: 'POST',
      body: input,
      auth: true,
    })
  }

  transitionRequisition(id: string, input: TransitionRequisitionRequest): Promise<Requisition> {
    return this.request(`/api/requisitions/${id}/transition`, requisitionSchema, {
      method: 'PATCH',
      body: input,
      auth: true,
    })
  }

  // ─── Vacancies ──────────────────────────────────────────────────────────────

  listVacancies(params?: { isPublished?: boolean }): Promise<ListVacanciesResponse> {
    const qs =
      params?.isPublished !== undefined ? `?is_published=${params.isPublished}` : ''
    return this.request(`/api/vacancies${qs}`, listVacanciesResponseSchema, { auth: true })
  }

  getVacancy(id: string): Promise<Vacancy> {
    return this.request(`/api/vacancies/${id}`, vacancySchema, { auth: true })
  }

  publishVacancy(id: string, input: PublishVacancyRequest): Promise<Vacancy> {
    return this.request(`/api/vacancies/${id}/publish`, vacancySchema, {
      method: 'PATCH',
      body: input,
      auth: true,
    })
  }

  // ─── Candidates ─────────────────────────────────────────────────────────────

  listCandidates(params?: { q?: string }): Promise<ListCandidatesResponse> {
    const qs = params?.q ? `?q=${encodeURIComponent(params.q)}` : ''
    return this.request(`/api/candidates${qs}`, listCandidatesResponseSchema, { auth: true })
  }

  createCandidate(input: CreateCandidateRequest): Promise<CreateCandidateResponse> {
    return this.request('/api/candidates', createCandidateResponseSchema, {
      method: 'POST',
      body: input,
      auth: true,
    })
  }

  // ─── Applications ───────────────────────────────────────────────────────────

  listApplications(params?: { vacancyId?: string; stage?: string }): Promise<ListApplicationsResponse> {
    const qs = new URLSearchParams()
    if (params?.vacancyId) qs.set('vacancy_id', params.vacancyId)
    if (params?.stage) qs.set('stage', params.stage)
    const qStr = qs.toString() ? `?${qs.toString()}` : ''
    return this.request(`/api/applications${qStr}`, listApplicationsResponseSchema, { auth: true })
  }

  getApplication(id: string): Promise<ApplicationDetail> {
    return this.request(`/api/applications/${id}`, applicationDetailSchema, { auth: true })
  }

  createApplication(input: CreateApplicationRequest): Promise<z.infer<typeof applicationSchema>> {
    return this.request('/api/applications', applicationSchema, {
      method: 'POST',
      body: input,
      auth: true,
    })
  }

  moveApplicationStage(id: string, input: MoveApplicationStageRequest): Promise<z.infer<typeof applicationSchema>> {
    return this.request(`/api/applications/${id}/stage`, applicationSchema, {
      method: 'PATCH',
      body: input,
      auth: true,
    })
  }

  rescoreApplication(id: string): Promise<{ queued: boolean; reason?: string }> {
    return this.request(
      `/api/applications/${id}/rescore`,
      z.object({ queued: z.boolean(), reason: z.string().optional() }),
      {
        method: 'POST',
        auth: true,
      },
    )
  }

  submitApplicationScoreFeedback(id: string, input: ScoreFeedbackRequest): Promise<z.infer<typeof applicationSchema>> {
    return this.request(`/api/applications/${id}/score-feedback`, applicationSchema, {
      method: 'POST',
      body: input,
      auth: true,
    })
  }

  // ─── Admin ──────────────────────────────────────────────────────────────────

  listAdminUsers(): Promise<ListUsersResponse> {
    return this.request('/api/admin/users', listUsersResponseSchema, { auth: true })
  }

  listAuditEvents(params?: {
    cursor?: string
    limit?: number
    actorUserId?: string
    entityType?: string
  }): Promise<ListAuditEventsResponse> {
    const qs = new URLSearchParams()
    if (params?.cursor) qs.set('cursor', params.cursor)
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.actorUserId) qs.set('actorUserId', params.actorUserId)
    if (params?.entityType) qs.set('entityType', params.entityType)
    const qStr = qs.toString() ? `?${qs.toString()}` : ''
    return this.request(`/api/admin/audit-events${qStr}`, listAuditEventsResponseSchema, {
      auth: true,
    })
  }

  // ─── HH integration ──────────────────────────────────────────────────────────

  getHhAuthorizeUrl(params?: { redirectUri?: string }): Promise<HhAuthorizeUrlResponse> {
    const qs = new URLSearchParams()
    if (params?.redirectUri) qs.set('redirect_uri', params.redirectUri)
    const qStr = qs.toString() ? `?${qs.toString()}` : ''
    return this.request(`/api/integrations/hh/authorize-url${qStr}`, hhAuthorizeUrlResponseSchema, { auth: true })
  }

  completeHhOAuth(input: { code: string; redirectUri?: string }): Promise<HhCallbackResponse> {
    const qs = new URLSearchParams({ code: input.code })
    if (input.redirectUri) qs.set('redirect_uri', input.redirectUri)
    return this.request(`/api/integrations/hh/callback?${qs.toString()}`, hhCallbackResponseSchema, { auth: true })
  }

  getHhIntegrationStatus(): Promise<HhIntegrationStatus> {
    return this.request('/api/integrations/hh/status', hhIntegrationStatusSchema, { auth: true })
  }

  syncHhNow(): Promise<HhSyncResponse> {
    return this.request('/api/integrations/hh/sync', hhSyncResponseSchema, { method: 'POST', auth: true })
  }

  linkVacancyToHh(id: string, input: LinkVacancyToHhRequest): Promise<HhVacancyLinkResponse> {
    const payload = linkVacancyToHhRequestSchema.parse(input)
    return this.request(`/api/integrations/hh/vacancies/${id}/link`, hhVacancyLinkResponseSchema, {
      method: 'PATCH',
      body: payload,
      auth: true,
    })
  }

  async logout(input: LogoutRequest = {}) {
    const payload = logoutRequestSchema.parse(input)
    await this.rawRequest('/api/auth/logout', {
      method: 'POST',
      body: payload,
      auth: false,
      retryOnUnauthorized: false,
    })
  }

  async expireSession() {
    this.options.setAccessToken(null)
    await this.rawRequest('/api/auth/logout', {
      method: 'POST',
      body: {},
      auth: false,
      retryOnUnauthorized: false,
    }).catch(() => undefined)
    await this.options.onAuthExpired?.()
  }

  private async request<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    options: RequestOptions,
  ): Promise<z.infer<TSchema>> {
    const response = await this.rawRequest(path, options)
    const data = await response.json()
    return schema.parse(data)
  }

  private async rawRequest(path: string, options: RequestOptions): Promise<Response> {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: this.headers(options),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    if (response.status === 401 && options.auth && options.retryOnUnauthorized !== false) {
      const refreshed = await this.refreshOnce().catch(async (error: unknown) => {
        await this.expireSession()
        throw error
      })
      this.options.setAccessToken(refreshed.accessToken)
      return this.rawRequest(path, {
        ...options,
        accessTokenOverride: refreshed.accessToken,
        retryOnUnauthorized: false,
      })
    }

    if (!response.ok) {
      throw await toApiError(response)
    }

    return response
  }

  private refreshOnce() {
    this.refreshPromise ??= this.refresh().finally(() => {
      this.refreshPromise = null
    })

    return this.refreshPromise
  }

  private headers(options: RequestOptions) {
    const headers = new Headers({
      'X-Client-Platform': 'web',
    })

    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }

    if (options.auth) {
      const accessToken = options.accessTokenOverride ?? this.options.getAccessToken()
      if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`)
      }
    }

    return headers
  }
}

async function toApiError(response: Response) {
  const fallbackMessage = `Request failed with status ${response.status}`

  try {
    const parsed = apiErrorSchema.parse(await response.json())
    return new ApiRequestError(response.status, parsed.error.code, parsed.error.message)
  } catch {
    return new ApiRequestError(response.status, 'INTERNAL_ERROR', fallbackMessage)
  }
}
