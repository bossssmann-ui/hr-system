import {
  apiErrorSchema,
  applicationDetailSchema,
  applicationSchema,
  authResponseSchema,
  createCandidateResponseSchema,
  interviewSchema,
  listApplicationsResponseSchema,
  listAuditEventsResponseSchema,
  listCandidatesResponseSchema,
  listInterviewsResponseSchema,
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
  listConversationsResponseSchema,
  listMessageTemplatesResponseSchema,
  sendMessageResponseSchema,
  aiDraftResponseSchema,
  assessmentConsentRequestSchema,
  assessmentSessionSchema,
  assessmentSubmitRequestSchema,
  assessmentSubmitResponseSchema,
  assessmentTemplateSchema,
  createAssessmentTemplateRequestSchema,
  channelStatusListSchema,
  generateInterviewQuestionsResponseSchema,
  inviteAssessmentRequestSchema,
  inviteAssessmentResponseSchema,
  listAssessmentTemplatesResponseSchema,
  publicAssessmentViewSchema,
  trustPreviewRequestSchema,
  trustPreviewResponseSchema,
  type ApplicationDetail,
  type AuthResponse,
  type CreateApplicationRequest,
  type CreateCandidateRequest,
  type CreateCandidateResponse,
  type CreateOrgUnitRequest,
  type CreateRequisitionRequest,
  type Interview,
  type ListApplicationsResponse,
  type ListAuditEventsResponse,
  type ListCandidatesResponse,
  type ListInterviewsResponse,
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
  type ListConversationsResponse,
  type ListMessageTemplatesResponse,
  type SendMessageResponse,
  type AiDraftResponse,
  type AssessmentConsentRequest,
  type AssessmentSession,
  type AssessmentSubmitRequest,
  type AssessmentSubmitResponse,
  type AssessmentTemplate,
  type ChannelStatusList,
  type ConversationDetail,
  type MessageTemplate,
  type CreateConversationRequest,
  type SendMessageRequest,
  type CreateMessageTemplateRequest,
  type UpdateMessageTemplateRequest,
  type CreateAssessmentTemplateRequest,
  type GenerateInterviewQuestionsResponse,
  type InviteAssessmentRequest,
  type InviteAssessmentResponse,
  type ListAssessmentTemplatesResponse,
  type PublicAssessmentView,
  type TrustPreviewRequest,
  type TrustPreviewResponse,
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

  generateInterviewQuestions(id: string): Promise<GenerateInterviewQuestionsResponse> {
    return this.request(`/api/applications/${id}/generate-questions`, generateInterviewQuestionsResponseSchema, {
      method: 'POST',
      auth: true,
    })
  }

  // ─── Assessments (Phase 1D) ─────────────────────────────────────────────────

  listAssessmentTemplates(): Promise<ListAssessmentTemplatesResponse> {
    return this.request('/api/assessments/templates', listAssessmentTemplatesResponseSchema, {
      auth: true,
    })
  }

  createAssessmentTemplate(input: CreateAssessmentTemplateRequest): Promise<AssessmentTemplate> {
    const payload = createAssessmentTemplateRequestSchema.parse(input)
    return this.request('/api/assessments/templates', assessmentTemplateSchema, {
      method: 'POST',
      body: payload,
      auth: true,
    })
  }

  inviteAssessment(templateId: string, input: InviteAssessmentRequest): Promise<InviteAssessmentResponse> {
    const payload = inviteAssessmentRequestSchema.parse(input)
    return this.request(`/api/assessments/${templateId}/invite`, inviteAssessmentResponseSchema, {
      method: 'POST',
      body: payload,
      auth: true,
    })
  }

  listAssessmentSessions(applicationId: string): Promise<{ items: AssessmentSession[] }> {
    return this.request(`/api/assessments/sessions?applicationId=${encodeURIComponent(applicationId)}`, z.object({
      items: z.array(assessmentSessionSchema),
    }), { auth: true })
  }

  trustPreview(input: TrustPreviewRequest): Promise<TrustPreviewResponse> {
    const payload = trustPreviewRequestSchema.parse(input)
    return this.request('/api/assessments/trust-preview', trustPreviewResponseSchema, {
      method: 'POST',
      body: payload,
      auth: true,
    })
  }

  getPublicAssessment(token: string): Promise<PublicAssessmentView> {
    return this.request(`/api/public/assessment/${token}`, publicAssessmentViewSchema, {
      auth: false,
    })
  }

  consentPublicAssessment(token: string, input: AssessmentConsentRequest): Promise<{ consented: boolean }> {
    const payload = assessmentConsentRequestSchema.parse(input)
    return this.request(`/api/public/assessment/${token}/consent`, z.object({ consented: z.boolean() }), {
      method: 'POST',
      body: payload,
      auth: false,
    })
  }

  startPublicAssessment(token: string): Promise<{ status: string }> {
    return this.request(`/api/public/assessment/${token}/start`, z.object({ status: z.string() }), {
      method: 'POST',
      auth: false,
    })
  }

  submitPublicAssessment(token: string, input: AssessmentSubmitRequest): Promise<AssessmentSubmitResponse> {
    const payload = assessmentSubmitRequestSchema.parse(input)
    return this.request(`/api/public/assessment/${token}/submit`, assessmentSubmitResponseSchema, {
      method: 'POST',
      body: payload,
      auth: false,
    })
  }

  // ─── Selection System (Phase 2) ─────────────────────────────────────────────

  createSelectionSession(input: {
    vacancyId: string
    applicationId?: string
    role: 'logist' | 'sales_manager'
  }): Promise<{ sessionId: string; token: string; assessmentUrl: string }> {
    return this.request(
      '/api/selection/sessions',
      z.object({ sessionId: z.string(), token: z.string(), assessmentUrl: z.string() }),
      { method: 'POST', body: input, auth: true },
    )
  }

  getSelectionSession(token: string): Promise<{
    sessionId: string
    status: string
    role: string
    currentStage: number | null
    stageData: unknown
    startedAt: string | null
  }> {
    return this.request(
      `/api/selection/sessions/${token}`,
      z.object({
        sessionId: z.string(),
        status: z.string(),
        role: z.string(),
        currentStage: z.number().nullable(),
        stageData: z.unknown(),
        startedAt: z.string().nullable(),
        message: z.string().optional(),
      }),
      { auth: false },
    )
  }

  submitSelectionStage(
    token: string,
    stage: number,
    answers: Record<string, unknown>,
  ): Promise<{ submitted: boolean; nextStatus: string }> {
    return this.request(
      `/api/selection/sessions/${token}/stage/${stage}`,
      z.object({ submitted: z.boolean(), nextStatus: z.string() }),
      { method: 'POST', body: { answers }, auth: false },
    )
  }

  getSelectionVerdict(sessionId: string): Promise<{
    sessionId: string
    status: string
    role: string
    verdict: string | null
    totalWeightedScore: string | null
    stageScores: unknown
    crossCheckFlags: unknown
    lieScaleResult: unknown
    verdictReason: string | null
    hrNotes: string | null
    createdAt: string
  }> {
    return this.request(
      `/api/selection/sessions/${sessionId}/verdict`,
      z.object({
        sessionId: z.string(),
        status: z.string(),
        role: z.string(),
        verdict: z.string().nullable(),
        totalWeightedScore: z.string().nullable(),
        stageScores: z.unknown(),
        crossCheckFlags: z.unknown(),
        lieScaleResult: z.unknown(),
        verdictReason: z.string().nullable(),
        hrNotes: z.string().nullable(),
        createdAt: z.string(),
      }),
      { auth: true },
    )
  }

  listSelectionSessions(params?: {
    page?: number
    pageSize?: number
    vacancyId?: string
    role?: 'logist' | 'sales_manager'
  }): Promise<{
    total: number
    page: number
    pageSize: number
    items: Array<{
      id: string
      token: string
      status: string
      role: string
      vacancyId: string
      applicationId: string | null
      startedAt: string | null
      completedAt: string | null
      createdAt: string
      verdict: {
        verdict: string
        totalWeightedScore: string | null
        crossCheckFlags: unknown
        createdAt: string
      } | null
    }>
  }> {
    const qs = new URLSearchParams()
    if (params?.page) qs.set('page', String(params.page))
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize))
    if (params?.vacancyId) qs.set('vacancyId', params.vacancyId)
    if (params?.role) qs.set('role', params.role)
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return this.request(
      `/api/selection/admin${query}`,
      z.object({
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        items: z.array(
          z.object({
            id: z.string(),
            token: z.string(),
            status: z.string(),
            role: z.string(),
            vacancyId: z.string(),
            applicationId: z.string().nullable(),
            startedAt: z.string().nullable(),
            completedAt: z.string().nullable(),
            createdAt: z.string(),
            verdict: z
              .object({
                verdict: z.string(),
                totalWeightedScore: z.string().nullable(),
                crossCheckFlags: z.unknown(),
                createdAt: z.string(),
              })
              .nullable(),
          }),
        ),
      }),
      { auth: true },
    )
  }

  // ─── Interviews ─────────────────────────────────────────────────────────────
  // TODO(phase-1f+): meeting-platform integration (Telemost / Zoom / Google Meet)

  listInterviews(applicationId: string): Promise<ListInterviewsResponse> {
    return this.request(
      `/api/interviews?application_id=${encodeURIComponent(applicationId)}`,
      listInterviewsResponseSchema,
      { auth: true },
    )
  }

  getInterview(id: string): Promise<Interview> {
    return this.request(`/api/interviews/${id}`, interviewSchema, { auth: true })
  }

  createInterview(input: { applicationId: string; scheduledAt?: string }): Promise<Interview> {
    return this.request('/api/interviews', interviewSchema, {
      method: 'POST',
      body: input,
      auth: true,
    })
  }

  updateInterviewConsent(id: string, consentRecorded: boolean): Promise<Interview> {
    return this.request(`/api/interviews/${id}/consent`, interviewSchema, {
      method: 'PATCH',
      body: { consentRecorded },
      auth: true,
    })
  }

  uploadInterviewRecording(id: string, file: File): Promise<Interview> {
    return this.rawRequestMultipart(`/api/interviews/${id}/recording`, file).then(async (res) => {
      const data = await res.json()
      return interviewSchema.parse(data)
    })
  }

  triggerTranscription(id: string): Promise<{ queued: boolean; reason?: string }> {
    return this.request(
      `/api/interviews/${id}/transcribe`,
      z.object({ queued: z.boolean(), reason: z.string().optional() }),
      { method: 'POST', auth: true },
    )
  }

  triggerBuildProtocol(id: string): Promise<{ queued: boolean; reason?: string }> {
    return this.request(
      `/api/interviews/${id}/build-protocol`,
      z.object({ queued: z.boolean(), reason: z.string().optional() }),
      { method: 'POST', auth: true },
    )
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

  // ─── Messaging (Phase 1E) ───────────────────────────────────────────────────

  listConversations(params?: { candidateId?: string }): Promise<ListConversationsResponse> {
    const qs = params?.candidateId ? `?candidate_id=${params.candidateId}` : ''
    return this.request(`/api/conversations${qs}`, listConversationsResponseSchema, { auth: true })
  }

  getConversation(id: string): Promise<ConversationDetail> {
    return this.request(`/api/conversations/${id}`, z.any(), { auth: true })
  }

  createConversation(input: CreateConversationRequest): Promise<{ conversation: ConversationDetail; created: boolean }> {
    return this.request('/api/conversations', z.any(), {
      method: 'POST',
      body: input,
      auth: true,
    })
  }

  sendMessage(conversationId: string, input: SendMessageRequest): Promise<SendMessageResponse> {
    return this.request(`/api/conversations/${conversationId}/messages`, sendMessageResponseSchema, {
      method: 'POST',
      body: input,
      auth: true,
    })
  }

  getAiDraft(conversationId: string, input: { hint?: string } = {}): Promise<AiDraftResponse> {
    return this.request(`/api/conversations/${conversationId}/ai-draft`, aiDraftResponseSchema, {
      method: 'POST',
      body: input,
      auth: true,
    })
  }

  getChannelStatus(): Promise<ChannelStatusList> {
    return this.request('/api/conversations/channels', channelStatusListSchema, { auth: true })
  }

  listMessageTemplates(): Promise<ListMessageTemplatesResponse> {
    return this.request('/api/message-templates', listMessageTemplatesResponseSchema, { auth: true })
  }

  createMessageTemplate(input: CreateMessageTemplateRequest): Promise<MessageTemplate> {
    return this.request('/api/message-templates', z.any(), {
      method: 'POST',
      body: input,
      auth: true,
    })
  }

  updateMessageTemplate(id: string, input: UpdateMessageTemplateRequest): Promise<MessageTemplate> {
    return this.request(`/api/message-templates/${id}`, z.any(), {
      method: 'PATCH',
      body: input,
      auth: true,
    })
  }

  deleteMessageTemplate(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/message-templates/${id}`, z.object({ ok: z.boolean() }), {
      method: 'DELETE',
      auth: true,
    })
  }

  previewTemplate(id: string, variables: Record<string, string>): Promise<{ body: string; subject: string | null }> {
    return this.request(`/api/message-templates/${id}/preview`, z.object({ body: z.string(), subject: z.string().nullable() }), {
      method: 'POST',
      body: { variables },
      auth: true,
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

  async rawRequestMultipart(path: string, file: File): Promise<Response> {
    const accessToken = this.options.getAccessToken()
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Client-Platform': 'web',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: formData,
    })

    if (!response.ok) {
      throw await toApiError(response)
    }

    return response
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
