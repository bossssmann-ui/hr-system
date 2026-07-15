import {
  listOneOnOnesResponseSchema,
  oneOnOneResponseSchema,
  type CreateOneOnOneRequest,
  type CompleteOneOnOneRequest,
  type ListOneOnOnesResponse,
  type OneOnOneResponse,
  reviewCycleWithStatsResponseSchema,
  reviewRequestResponseSchema,
  type OpenReviewCycleRequest,
  type CreateReviewCycleRequest,
  type SubmitReviewRequest,
  type ReviewCycleWithStatsResponse,
  type ReviewRequestResponse,
  listPerformanceOkrsResponseSchema,
  performanceOkrResponseSchema,
  performanceOkrKeyResultResponseSchema,
  type ListPerformanceOkrsResponse,
  type PerformanceOkrResponse,
  type PerformanceOkrKeyResultResponse,
  type PatchOkrKeyResultRequest,
  listPerformanceIdpsResponseSchema,
  performanceIdpResponseSchema,
  performanceIdpItemResponseSchema,
  type ListPerformanceIdpsResponse,
  type PerformanceIdpResponse,
  type PerformanceIdpItemResponse,
  type PatchIdpItemRequest,
  engagementSurveySchema,
  enpsResultSchema,
  surveyResponseSchema,
  type EngagementSurvey,
  type EngagementSurveyStatus,
  type EngagementSurveyKind,
  type EnpsResult,
  type SurveyResponse,
  type CreateEngagementSurveyRequest,
  type SubmitSurveyResponseRequest,
  learningCourseSchema,
  learningPathSchema,
  learningAssignmentSchema,
  type LearningCourse,
  type LearningPath,
  type LearningAssignment,
  type LearningCourseCreateRequest,
  type LearningCourseUpdateRequest,
  type LearningPathCreateRequest,
  type LearningPathUpdateRequest,
  type LearningAssignmentCreateRequest,
  type LearningAssignmentUpdateRequest,
} from '@web-app-demo/contracts'
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
  integrationsStatusSchema,
  tenantSettingsSchema,
  updateTenantSettingsRequestSchema,
  linkVacancyToHhRequestSchema,
  loginRequestSchema,
  logoutRequestSchema,
  meResponseSchema,
  okResponseSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  refreshRequestSchema,
  refreshResponseSchema,
  registerRequestSchema,
  rescoreAllApplicationsRequestSchema,
  rescoreAllApplicationsResponseSchema,
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
  processCandidateQuestionnaireReplyResponseSchema,
  publicAssessmentViewSchema,
  sendCandidateQuestionnaireResponseSchema,
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
  type PasswordResetConfirmRequest,
  type PasswordResetRequest,
  type ProcessCandidateQuestionnaireReplyRequest,
  type ProcessCandidateQuestionnaireReplyResponse,
  type OrgUnit,
  type PublishVacancyRequest,
  type RefreshRequest,
  type RefreshResponse,
  type RegisterRequest,
  type Requisition,
  type ScoreFeedbackRequest,
  type SendCandidateQuestionnaireResponse,
  type TransitionRequisitionRequest,
  type Vacancy,
  type HhAuthorizeUrlResponse,
  type HhCallbackResponse,
  type HhIntegrationStatus,
  type HhSyncResponse,
  type HhVacancyLinkResponse,
  type IntegrationsStatus,
  type TenantSettings,
  type UpdateTenantSettingsRequest,
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
  analyticsSignalSchema,
  generateQuestionsResponseSchema,
  knowledgeArticleSchema,
  knowledgeSearchResponseSchema,
  listAnalyticsSignalsResponseSchema,
  listKnowledgeArticlesResponseSchema,
  suggestSalaryResponseSchema,
  type AnalyticsSignal,
  type CreateKnowledgeArticleRequest,
  type KnowledgeSearchResponse,
  type KnowledgeArticle,
  compBandSchema,
  compCalculatorResponseSchema,
  hrDashboardSchema,
  listCompBandsResponseSchema,
  listHrSnapshotsResponseSchema,
  listOffersResponseSchema,
  recruiterFunnelMetricsSchema,
  offerSchema,
  payrollExportResponseSchema,
  type CompBandCreateRequest,
  type CompBandUpdateRequest,
  type CreateOfferRequest,
  type UpdateOfferRequest,
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
  type ListNotificationsResponse,
  type MarkNotificationsReadResponse,
  type Notification,
  type PublicAssessmentView,
  type TrustPreviewRequest,
  type TrustPreviewResponse,
  listNotificationsResponseSchema,
  markNotificationsReadResponseSchema,
  notificationSchema,
} from '@web-app-demo/contracts'
import { z } from 'zod'

export const apiBaseUrl = (import.meta.env?.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

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

  requestPasswordReset(input: PasswordResetRequest): Promise<{ ok: true }> {
    const payload = passwordResetRequestSchema.parse(input)
    return this.request('/api/auth/password-reset/request', okResponseSchema, {
      method: 'POST',
      body: payload,
      auth: false,
    })
  }

  resetPassword(input: PasswordResetConfirmRequest): Promise<{ ok: true }> {
    const payload = passwordResetConfirmSchema.parse(input)
    return this.request('/api/auth/password-reset/confirm', okResponseSchema, {
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

  rescoreAllApplications(
    input: z.infer<typeof rescoreAllApplicationsRequestSchema> = {},
  ): Promise<z.infer<typeof rescoreAllApplicationsResponseSchema>> {
    return this.request('/api/applications/rescore-all', rescoreAllApplicationsResponseSchema, {
      method: 'POST',
      body: input,
      auth: true,
    })
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

  sendCandidateQuestionnaire(id: string): Promise<SendCandidateQuestionnaireResponse> {
    return this.request(`/api/applications/${id}/send-questionnaire`, sendCandidateQuestionnaireResponseSchema, {
      method: 'POST',
      auth: true,
    })
  }

  processCandidateQuestionnaireReply(
    id: string,
    input: ProcessCandidateQuestionnaireReplyRequest,
  ): Promise<ProcessCandidateQuestionnaireReplyResponse> {
    return this.request(`/api/applications/${id}/questionnaire-reply`, processCandidateQuestionnaireReplyResponseSchema, {
      method: 'POST',
      body: input,
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
    role?: 'logist' | 'sales_manager' | 'logist_domestic'
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

  // ─── Offers (Phase 3) ───────────────────────────────────────────────────────

  listApplicationOffers(applicationId: string) {
    return this.request(
      `/api/applications/${encodeURIComponent(applicationId)}/offers`,
      listOffersResponseSchema,
      { auth: true },
    )
  }

  getOffer(id: string) {
    return this.request(`/api/offers/${encodeURIComponent(id)}`, offerSchema, { auth: true })
  }

  createOffer(input: CreateOfferRequest) {
    return this.request('/api/offers', offerSchema, { method: 'POST', body: input, auth: true })
  }

  updateOffer(id: string, input: UpdateOfferRequest) {
    return this.request(`/api/offers/${encodeURIComponent(id)}`, offerSchema, {
      method: 'PATCH', body: input, auth: true,
    })
  }

  transitionOffer(id: string, action: 'submit' | 'approve' | 'reject' | 'send' | 'decline' | 'accept', body?: unknown) {
    return this.request(`/api/offers/${encodeURIComponent(id)}/${action}`, offerSchema, {
      method: 'POST', body: body ?? {}, auth: true,
    })
  }

  // ─── Compensation (Phase 3) ─────────────────────────────────────────────────

  listCompBands() {
    return this.request('/api/comp/bands', listCompBandsResponseSchema, { auth: true })
  }

  createCompBand(input: CompBandCreateRequest) {
    return this.request('/api/comp/bands', compBandSchema, { method: 'POST', body: input, auth: true })
  }

  updateCompBand(id: string, input: CompBandUpdateRequest) {
    return this.request(`/api/comp/bands/${encodeURIComponent(id)}`, compBandSchema, {
      method: 'PATCH', body: input, auth: true,
    })
  }

  deleteCompBand(id: string) {
    return this.request(`/api/comp/bands/${encodeURIComponent(id)}`, z.object({ ok: z.boolean() }), {
      method: 'DELETE', auth: true,
    })
  }

  compCalculator(params: { grade: string; salary: number; currency: string }) {
    const qs = new URLSearchParams({
      grade: params.grade,
      salary: String(params.salary),
      currency: params.currency,
    }).toString()
    return this.request(`/api/comp/calculator?${qs}`, compCalculatorResponseSchema, { auth: true })
  }

  // ─── HR Analytics (Phase 7) ─────────────────────────────────────────────────

  getHrDashboard() {
    return this.request('/api/analytics/dashboard', hrDashboardSchema, { auth: true })
  }

  getRecruiterFunnel(period: 'today' | 'week' | 'all') {
    return this.request(
      `/api/analytics/recruiter-funnel?period=${encodeURIComponent(period)}`,
      recruiterFunnelMetricsSchema,
      { auth: true },
    )
  }

  listHrSnapshots(params?: { limit?: number; from?: string; to?: string }) {
    const qs = new URLSearchParams()
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.from) qs.set('from', params.from)
    if (params?.to) qs.set('to', params.to)
    const qStr = qs.toString() ? `?${qs.toString()}` : ''
    return this.request(`/api/analytics/snapshots${qStr}`, listHrSnapshotsResponseSchema, { auth: true })
  }

  computeHrSnapshot() {
    return this.request('/api/analytics/snapshots/compute', hrDashboardSchema, {
      method: 'POST',
      body: {},
      auth: true,
    })
  }

  getPayrollExport(params: { month: string }) {
    const qs = new URLSearchParams({ month: params.month, format: 'json' }).toString()
    return this.request(`/api/payroll/export?${qs}`, payrollExportResponseSchema, { auth: true })
  }

  payrollExportCsvUrl(params: { month: string }) {
    const qs = new URLSearchParams({ month: params.month, format: 'csv' }).toString()
    return `${apiBaseUrl}/api/payroll/export?${qs}`
  }

  async downloadPayrollCsv(params: { month: string }): Promise<string> {
    const qs = new URLSearchParams({ month: params.month, format: 'csv' }).toString()
    const response = await this.rawRequest(`/api/payroll/export?${qs}`, { auth: true })
    return response.text()
  }

  // ─── Phase 9 — Analytics signals ─────────────────────────────────────────

  listSignals(params?: { status?: AnalyticsSignal['status']; type?: AnalyticsSignal['type']; limit?: number }) {
    const qs = new URLSearchParams()
    if (params?.status) qs.set('status', params.status)
    if (params?.type) qs.set('type', params.type)
    if (params?.limit) qs.set('limit', String(params.limit))
    const qStr = qs.toString() ? `?${qs.toString()}` : ''
    return this.request(`/api/analytics/signals${qStr}`, listAnalyticsSignalsResponseSchema, { auth: true })
  }

  reviewSignal(id: string, patch: Pick<AnalyticsSignal, 'status'>): Promise<AnalyticsSignal> {
    return this.request(`/api/analytics/signals/${id}`, analyticsSignalSchema, {
      method: 'PATCH',
      body: patch,
      auth: true,
    })
  }

  listAnalyticsSignals(params?: { status?: 'open' | 'reviewed' | 'dismissed'; type?: 'flight_risk' | 'burnout'; limit?: number }) {
    return this.listSignals(params)
  }

  updateAnalyticsSignal(id: string, status: 'open' | 'reviewed' | 'dismissed'): Promise<AnalyticsSignal> {
    return this.reviewSignal(id, { status })
  }

  computeAnalyticsSignals() {
    return this.request(
      '/api/analytics/signals/compute',
      z.object({ employees: z.number(), upserted: z.number(), opened: z.number() }),
      { method: 'POST', body: {}, auth: true },
    )
  }

  getEmployeeSignals(employeeId: string) {
    return this.request(`/api/employees/${employeeId}/signals`, listAnalyticsSignalsResponseSchema, { auth: true })
  }

  // ─── Phase 9 — Knowledge Hub ─────────────────────────────────────────────

  listKnowledgeArticles(params?: { limit?: number; tag?: string; visibility?: 'internal' | 'portal' }) {
    const qs = new URLSearchParams()
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.tag) qs.set('tag', params.tag)
    if (params?.visibility) qs.set('visibility', params.visibility)
    const qStr = qs.toString() ? `?${qs.toString()}` : ''
    return this.request(`/api/knowledge${qStr}`, listKnowledgeArticlesResponseSchema, { auth: true })
  }

  createKnowledgeArticle(input: CreateKnowledgeArticleRequest): Promise<KnowledgeArticle> {
    return this.request('/api/knowledge', knowledgeArticleSchema, {
      method: 'POST',
      body: input,
      auth: true,
    })
  }

  updateKnowledgeArticle(id: string, patch: Partial<CreateKnowledgeArticleRequest>): Promise<KnowledgeArticle> {
    return this.request(`/api/knowledge/${id}`, knowledgeArticleSchema, {
      method: 'PATCH',
      body: patch,
      auth: true,
    })
  }

  deleteKnowledgeArticle(id: string) {
    return this.request(`/api/knowledge/${id}`, z.object({ ok: z.boolean() }), {
      method: 'DELETE',
      auth: true,
    })
  }

  searchKnowledge(input: { query: string; limit?: number; visibility?: 'internal' | 'portal' }): Promise<KnowledgeSearchResponse> {
    return this.request('/api/knowledge/search', knowledgeSearchResponseSchema, {
      method: 'POST',
      body: input,
      auth: true,
    })
  }

  // ─── Phase 9 — AI v2 helpers ─────────────────────────────────────────────

  generateInterviewQuestionsAi(input: { candidateId: string; vacancyId: string }) {
    return this.request('/api/ai/generate-questions', generateQuestionsResponseSchema, {
      method: 'POST',
      body: input,
      auth: true,
    })
  }

  suggestSalary(input: { candidateId: string; grade: string; currency: 'RUB' | 'USD' | 'THB' | 'USDT' }) {
    return this.request('/api/ai/suggest-salary', suggestSalaryResponseSchema, {
      method: 'POST',
      body: input,
      auth: true,
    })
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

  getIntegrationsStatus(): Promise<IntegrationsStatus> {
    return this.request('/api/integrations/status', integrationsStatusSchema, { auth: true })
  }

  getTenantSettings(): Promise<TenantSettings> {
    return this.request('/api/settings/tenant', tenantSettingsSchema, { auth: true })
  }

  updateTenantSettings(patch: UpdateTenantSettingsRequest): Promise<TenantSettings> {
    const payload = updateTenantSettingsRequestSchema.parse(patch)
    return this.request('/api/settings/tenant', tenantSettingsSchema, {
      method: 'PATCH',
      body: payload,
      auth: true,
    })
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

  // ─── Notifications (Phase 10) ───────────────────────────────────────────────

  listNotifications(params: { limit?: number; unread?: boolean } = {}): Promise<ListNotificationsResponse> {
    const qs = new URLSearchParams()
    if (params.limit !== undefined) qs.set('limit', String(params.limit))
    if (params.unread !== undefined) qs.set('unread', params.unread ? 'true' : 'false')
    const tail = qs.toString() ? `?${qs.toString()}` : ''
    return this.request(`/api/notifications${tail}`, listNotificationsResponseSchema, { auth: true })
  }

  markNotificationRead(id: string): Promise<Notification> {
    return this.request(`/api/notifications/${id}/read`, notificationSchema, {
      method: 'PATCH',
      auth: true,
    })
  }

  markAllNotificationsRead(): Promise<MarkNotificationsReadResponse> {
    return this.request('/api/notifications/read-all', markNotificationsReadResponseSchema, {
      method: 'POST',
      auth: true,
    })
  }

  async deleteNotification(id: string): Promise<void> {
    await this.rawRequest(`/api/notifications/${id}`, {
      method: 'DELETE',
      auth: true,
    })
  }

  // ─── Performance: 1:1 ───────────────────────────────────────────────────

  listOneOnOnes(params?: {
    employeeId?: string
    managerUserId?: string
    status?: 'scheduled' | 'completed' | 'cancelled'
    page?: number
    pageSize?: number
  }): Promise<ListOneOnOnesResponse> {
    const qs = new URLSearchParams()
    if (params?.employeeId) qs.set('employeeId', params.employeeId)
    if (params?.managerUserId) qs.set('managerUserId', params.managerUserId)
    if (params?.status) qs.set('status', params.status)
    if (params?.page != null) qs.set('page', String(params.page))
    if (params?.pageSize != null) qs.set('pageSize', String(params.pageSize))
    const query = qs.toString()
    return this.request(
      `/api/one-on-ones${query ? `?${query}` : ''}`,
      listOneOnOnesResponseSchema,
      { auth: true },
    )
  }

  createOneOnOne(body: CreateOneOnOneRequest): Promise<OneOnOneResponse> {
    return this.request('/api/one-on-ones', oneOnOneResponseSchema, {
      method: 'POST',
      body,
      auth: true,
    })
  }

  completeOneOnOne(id: string, body: CompleteOneOnOneRequest): Promise<OneOnOneResponse> {
    return this.request(`/api/one-on-ones/${id}/complete`, oneOnOneResponseSchema, {
      method: 'POST',
      body,
      auth: true,
    })
  }

  // ─── Performance: Reviews / 360 ─────────────────────────────────────────

  listReviewCycles(): Promise<{ items: ReviewCycleWithStatsResponse[] }> {
    return this.request(
      '/api/reviews/cycles',
      z.object({ items: z.array(reviewCycleWithStatsResponseSchema) }),
      { auth: true },
    )
  }

  createReviewCycle(body: CreateReviewCycleRequest): Promise<ReviewCycleWithStatsResponse> {
    return this.request('/api/reviews/cycles', reviewCycleWithStatsResponseSchema, {
      method: 'POST',
      body,
      auth: true,
    })
  }

  openReviewCycle(id: string, body: OpenReviewCycleRequest): Promise<ReviewCycleWithStatsResponse> {
    return this.request(`/api/reviews/cycles/${id}/open`, reviewCycleWithStatsResponseSchema, {
      method: 'POST',
      body,
      auth: true,
    })
  }

  closeReviewCycle(id: string): Promise<ReviewCycleWithStatsResponse> {
    return this.request(`/api/reviews/cycles/${id}/close`, reviewCycleWithStatsResponseSchema, {
      method: 'POST',
      body: {},
      auth: true,
    })
  }

  listMyReviewRequests(params: {
    reviewerUserId: string
    status?: 'pending' | 'submitted' | 'declined'
  }): Promise<{ items: ReviewRequestResponse[] }> {
    const qs = new URLSearchParams({ reviewerUserId: params.reviewerUserId })
    if (params.status) qs.set('status', params.status)
    return this.request(
      `/api/reviews/requests?${qs.toString()}`,
      z.object({ items: z.array(reviewRequestResponseSchema) }),
      { auth: true },
    )
  }

  submitReviewRequest(id: string, body: SubmitReviewRequest): Promise<ReviewRequestResponse> {
    return this.request(`/api/reviews/requests/${id}/submit`, reviewRequestResponseSchema, {
      method: 'POST',
      body,
      auth: true,
    })
  }

  declineReviewRequest(id: string, body: { reason: string }): Promise<ReviewRequestResponse> {
    return this.request(`/api/reviews/requests/${id}/decline`, reviewRequestResponseSchema, {
      method: 'POST',
      body,
      auth: true,
    })
  }

  // ─── Performance: OKR ───────────────────────────────────────────────────

  listOkrs(params?: {
    employeeId?: string
    quarter?: string
    status?: 'draft' | 'active' | 'achieved' | 'missed'
  }): Promise<ListPerformanceOkrsResponse> {
    const qs = new URLSearchParams()
    if (params?.employeeId) qs.set('employeeId', params.employeeId)
    if (params?.quarter) qs.set('quarter', params.quarter)
    if (params?.status) qs.set('status', params.status)
    const query = qs.toString()
    return this.request(
      `/api/okrs${query ? `?${query}` : ''}`,
      listPerformanceOkrsResponseSchema,
      { auth: true },
    )
  }

  getOkr(id: string): Promise<PerformanceOkrResponse> {
    return this.request(`/api/okrs/${id}`, performanceOkrResponseSchema, { auth: true })
  }

  patchOkrKeyResult(
    _okrId: string,
    krId: string,
    body: PatchOkrKeyResultRequest,
  ): Promise<PerformanceOkrKeyResultResponse> {
    return this.request(
      `/api/okrs/key-results/${krId}`,
      performanceOkrKeyResultResponseSchema,
      { method: 'PATCH', body, auth: true },
    )
  }

  // ─── Performance: IDP ───────────────────────────────────────────────────

  listIdps(params?: {
    employeeId?: string
    quarter?: string
    status?: 'draft' | 'active' | 'completed'
  }): Promise<ListPerformanceIdpsResponse> {
    const qs = new URLSearchParams()
    if (params?.employeeId) qs.set('employeeId', params.employeeId)
    if (params?.quarter) qs.set('quarter', params.quarter)
    if (params?.status) qs.set('status', params.status)
    const query = qs.toString()
    return this.request(
      `/api/idps${query ? `?${query}` : ''}`,
      listPerformanceIdpsResponseSchema,
      { auth: true },
    )
  }

  getIdp(id: string): Promise<PerformanceIdpResponse> {
    return this.request(`/api/idps/${id}`, performanceIdpResponseSchema, { auth: true })
  }

  patchIdpItem(
    _idpId: string,
    itemId: string,
    body: PatchIdpItemRequest,
  ): Promise<PerformanceIdpItemResponse> {
    return this.request(
      `/api/idps/items/${itemId}`,
      performanceIdpItemResponseSchema,
      { method: 'PATCH', body, auth: true },
    )
  }

  // ─── Engagement: Surveys ────────────────────────────────────────────────

  listSurveys(params?: {
    status?: EngagementSurveyStatus
    kind?: EngagementSurveyKind
  }): Promise<{ items: EngagementSurvey[] }> {
    const qs = new URLSearchParams()
    if (params?.status) qs.set('status', params.status)
    if (params?.kind) qs.set('kind', params.kind)
    const query = qs.toString()
    return this.request(
      `/api/engagement/surveys${query ? `?${query}` : ''}`,
      z.object({ items: z.array(engagementSurveySchema) }),
      { auth: true },
    )
  }

  listOpenSurveys(): Promise<{ items: EngagementSurvey[] }> {
    return this.request(
      '/api/engagement/surveys/open',
      z.object({ items: z.array(engagementSurveySchema) }),
      { auth: true },
    )
  }

  getSurvey(id: string): Promise<EngagementSurvey & { responded: number; total: number }> {
    return this.request(
      `/api/engagement/surveys/${id}`,
      engagementSurveySchema.extend({ responded: z.number(), total: z.number() }),
      { auth: true },
    )
  }

  createSurvey(body: CreateEngagementSurveyRequest): Promise<EngagementSurvey> {
    return this.request(`/api/engagement/surveys`, engagementSurveySchema, {
      method: 'POST',
      body,
      auth: true,
    })
  }

  openSurvey(id: string): Promise<EngagementSurvey> {
    return this.request(`/api/engagement/surveys/${id}/open`, engagementSurveySchema, {
      method: 'POST',
      auth: true,
    })
  }

  closeSurvey(id: string): Promise<EngagementSurvey> {
    return this.request(`/api/engagement/surveys/${id}/close`, engagementSurveySchema, {
      method: 'POST',
      auth: true,
    })
  }

  submitSurveyResponse(id: string, body: SubmitSurveyResponseRequest): Promise<SurveyResponse> {
    return this.request(`/api/engagement/surveys/${id}/responses`, surveyResponseSchema, {
      method: 'POST',
      body,
      auth: true,
    })
  }

  getSurveyResults(id: string): Promise<EnpsResult & { comments: string[] }> {
    return this.request(
      `/api/engagement/surveys/${id}/results`,
      enpsResultSchema.extend({ comments: z.array(z.string()) }),
      { auth: true },
    )
  }

  // ─── Learning: Courses ──────────────────────────────────────────────────

  listCourses(): Promise<{ items: LearningCourse[] }> {
    return this.request(
      '/api/learning/courses',
      z.object({ items: z.array(learningCourseSchema) }),
      { auth: true },
    )
  }

  createCourse(body: LearningCourseCreateRequest): Promise<LearningCourse> {
    return this.request('/api/learning/courses', learningCourseSchema, {
      method: 'POST',
      body,
      auth: true,
    })
  }

  updateCourse(id: string, body: LearningCourseUpdateRequest): Promise<LearningCourse> {
    return this.request(`/api/learning/courses/${id}`, learningCourseSchema, {
      method: 'PATCH',
      body,
      auth: true,
    })
  }

  async deleteCourse(id: string): Promise<void> {
    await this.request(`/api/learning/courses/${id}`, z.object({ ok: z.boolean() }), {
      method: 'DELETE',
      auth: true,
    })
  }

  // ─── Learning: Paths ────────────────────────────────────────────────────

  listPaths(): Promise<{ items: LearningPath[] }> {
    return this.request(
      '/api/learning/paths',
      z.object({ items: z.array(learningPathSchema) }),
      { auth: true },
    )
  }

  createPath(body: LearningPathCreateRequest): Promise<LearningPath> {
    return this.request('/api/learning/paths', learningPathSchema, {
      method: 'POST',
      body,
      auth: true,
    })
  }

  updatePath(id: string, body: LearningPathUpdateRequest): Promise<LearningPath> {
    return this.request(`/api/learning/paths/${id}`, learningPathSchema, {
      method: 'PATCH',
      body,
      auth: true,
    })
  }

  async deletePath(id: string): Promise<void> {
    await this.request(`/api/learning/paths/${id}`, z.object({ ok: z.boolean() }), {
      method: 'DELETE',
      auth: true,
    })
  }

  // ─── Learning: Assignments ──────────────────────────────────────────────

  listAssignments(params: { employeeId: string }): Promise<{ items: LearningAssignment[] }> {
    return this.request(
      `/api/employees/${params.employeeId}/learning`,
      z.object({ items: z.array(learningAssignmentSchema) }),
      { auth: true },
    )
  }

  listMyAssignments(): Promise<{ items: LearningAssignment[] }> {
    return this.request(
      '/api/learning/my-assignments',
      z.object({ items: z.array(learningAssignmentSchema) }),
      { auth: true },
    )
  }

  createAssignment(
    employeeId: string,
    body: LearningAssignmentCreateRequest,
  ): Promise<LearningAssignment> {
    return this.request(
      `/api/employees/${employeeId}/learning`,
      learningAssignmentSchema,
      { method: 'POST', body, auth: true },
    )
  }

  updateAssignment(
    employeeId: string,
    id: string,
    body: LearningAssignmentUpdateRequest,
  ): Promise<LearningAssignment> {
    return this.request(`/api/employees/${employeeId}/learning/${id}`, learningAssignmentSchema, {
      method: 'PATCH',
      body,
      auth: true,
    })
  }

  /**
   * Build a same-origin SSE URL for the realtime stream. EventSource cannot
   * send custom headers, so we pass the access token as a query parameter and
   * the server verifies it the same way as the standard auth header.
   */
  realtimeEventsUrl(): string | null {
    const token = this.options.getAccessToken()
    if (!token) return null
    const url = new URL(`${apiBaseUrl}/api/realtime/events`)
    url.searchParams.set('access_token', token)
    return url.toString()
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
