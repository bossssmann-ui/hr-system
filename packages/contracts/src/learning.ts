import { z } from 'zod'

// ─── LMS ────────────────────────────────────────────────────────────────────

export const learningContentTypeSchema = z.enum([
  'video',
  'article',
  'quiz',
  'external_link',
  'scorm',
])
export type LearningContentType = z.infer<typeof learningContentTypeSchema>

export const learningAssignmentStatusSchema = z.enum([
  'assigned',
  'started',
  'completed',
  'expired',
])
export type LearningAssignmentStatus = z.infer<typeof learningAssignmentStatusSchema>

export const learningCourseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  contentType: learningContentTypeSchema,
  contentUrl: z.string().nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  isMandatory: z.boolean(),
  orgUnitId: z.string().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type LearningCourse = z.infer<typeof learningCourseSchema>

export const learningCourseCreateRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  contentType: learningContentTypeSchema,
  contentUrl: z.string().url().optional(),
  durationMinutes: z.number().int().positive().optional(),
  isMandatory: z.boolean().optional(),
  orgUnitId: z.string().uuid().optional(),
})
export type LearningCourseCreateRequest = z.infer<typeof learningCourseCreateRequestSchema>

export const learningCourseUpdateRequestSchema = learningCourseCreateRequestSchema.partial()
export type LearningCourseUpdateRequest = z.infer<typeof learningCourseUpdateRequestSchema>

export const learningPathSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  roleFamily: z.string().nullable(),
  autoAssign: z.boolean(),
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type LearningPath = z.infer<typeof learningPathSchema>

export const learningPathCreateRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  roleFamily: z.string().optional(),
  autoAssign: z.boolean().optional(),
  courseIds: z.array(z.string().uuid()).optional(),
})
export type LearningPathCreateRequest = z.infer<typeof learningPathCreateRequestSchema>

export const learningPathUpdateRequestSchema = learningPathCreateRequestSchema.partial()
export type LearningPathUpdateRequest = z.infer<typeof learningPathUpdateRequestSchema>

export const learningAssignmentSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  employeeId: z.string(),
  courseId: z.string().nullable(),
  pathId: z.string().nullable(),
  status: learningAssignmentStatusSchema,
  progressPercent: z.number().int().min(0).max(100),
  score: z.number().int().nullable(),
  dueDate: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  assignedByUserId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type LearningAssignment = z.infer<typeof learningAssignmentSchema>

export const learningAssignmentCreateRequestSchema = z
  .object({
    courseId: z.string().uuid().optional(),
    pathId: z.string().uuid().optional(),
    dueDate: z.string().date().optional(),
  })
  .refine((d) => Boolean(d.courseId) !== Boolean(d.pathId), {
    message: 'Exactly one of courseId or pathId is required',
  })
export type LearningAssignmentCreateRequest = z.infer<typeof learningAssignmentCreateRequestSchema>

export const learningAssignmentUpdateRequestSchema = z.object({
  status: learningAssignmentStatusSchema.optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
  score: z.number().int().optional(),
})
export type LearningAssignmentUpdateRequest = z.infer<typeof learningAssignmentUpdateRequestSchema>

// ─── 1:1 ────────────────────────────────────────────────────────────────────

export const oneOnOneStatusSchema = z.enum(['scheduled', 'completed', 'cancelled'])
export type OneOnOneStatus = z.infer<typeof oneOnOneStatusSchema>

export const oneOnOneActionItemSchema = z.object({
  text: z.string().min(1),
  owner: z.enum(['employee', 'manager']).optional(),
  done: z.boolean().optional(),
})
export type OneOnOneActionItem = z.infer<typeof oneOnOneActionItemSchema>

export const oneOnOneSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  employeeId: z.string(),
  managerUserId: z.string(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().positive().nullable(),
  status: oneOnOneStatusSchema,
  agenda: z.string().nullable(),
  notes: z.string().nullable(),
  actionItems: z.array(oneOnOneActionItemSchema),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type OneOnOne = z.infer<typeof oneOnOneSchema>

export const oneOnOneCreateRequestSchema = z.object({
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().positive().optional(),
  agenda: z.string().optional(),
  managerUserId: z.string().uuid().optional(),
})
export type OneOnOneCreateRequest = z.infer<typeof oneOnOneCreateRequestSchema>

export const oneOnOneUpdateRequestSchema = z.object({
  status: oneOnOneStatusSchema.optional(),
  scheduledAt: z.string().datetime().optional(),
  agenda: z.string().optional(),
  notes: z.string().optional(),
  actionItems: z.array(oneOnOneActionItemSchema).optional(),
})
export type OneOnOneUpdateRequest = z.infer<typeof oneOnOneUpdateRequestSchema>

// ─── 360° Reviews ───────────────────────────────────────────────────────────

export const reviewCycleStatusSchema = z.enum(['draft', 'open', 'closed'])
export type ReviewCycleStatus = z.infer<typeof reviewCycleStatusSchema>

export const reviewRequestStatusSchema = z.enum(['pending', 'submitted', 'declined'])
export type ReviewRequestStatus = z.infer<typeof reviewRequestStatusSchema>

export const reviewQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  type: z.enum(['rating', 'text']),
})
export type ReviewQuestion = z.infer<typeof reviewQuestionSchema>

export const reviewCycleSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string(),
  quarter: z.string(),
  status: reviewCycleStatusSchema,
  questions: z.array(reviewQuestionSchema),
  openedAt: z.string().datetime().nullable(),
  closesAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type ReviewCycle = z.infer<typeof reviewCycleSchema>

export const reviewCycleCreateRequestSchema = z.object({
  title: z.string().min(1),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/, 'quarter must look like 2026-Q1'),
  closesAt: z.string().datetime().optional(),
  questions: z.array(reviewQuestionSchema).optional(),
})
export type ReviewCycleCreateRequest = z.infer<typeof reviewCycleCreateRequestSchema>

export const reviewCycleUpdateRequestSchema = z.object({
  status: reviewCycleStatusSchema.optional(),
  closesAt: z.string().datetime().optional(),
  questions: z.array(reviewQuestionSchema).optional(),
})
export type ReviewCycleUpdateRequest = z.infer<typeof reviewCycleUpdateRequestSchema>

export const reviewRequestSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  cycleId: z.string(),
  subjectEmployeeId: z.string(),
  reviewerUserId: z.string(),
  relationship: z.string(),
  status: reviewRequestStatusSchema,
  response: z.unknown().nullable(),
  declineReason: z.string().nullable(),
  submittedAt: z.string().datetime().nullable(),
  declinedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type ReviewRequest = z.infer<typeof reviewRequestSchema>

export const reviewRequestsCreateRequestSchema = z.object({
  requests: z
    .array(
      z.object({
        subjectEmployeeId: z.string().uuid(),
        reviewerUserId: z.string().uuid(),
        relationship: z.string().optional(),
      }),
    )
    .min(1),
})
export type ReviewRequestsCreateRequest = z.infer<typeof reviewRequestsCreateRequestSchema>

export const reviewSubmitRequestSchema = z.object({
  response: z.record(z.string(), z.union([z.string(), z.number()])),
})
export type ReviewSubmitRequest = z.infer<typeof reviewSubmitRequestSchema>

export const reviewDeclineRequestSchema = z.object({
  reason: z.string().max(500).optional(),
})
export type ReviewDeclineRequest = z.infer<typeof reviewDeclineRequestSchema>

// ─── OKRs ───────────────────────────────────────────────────────────────────

export const okrStatusSchema = z.enum(['draft', 'active', 'achieved', 'missed'])
export type OkrStatus = z.infer<typeof okrStatusSchema>

export const keyResultStatusSchema = z.enum(['open', 'on_track', 'at_risk', 'achieved'])
export type KeyResultStatus = z.infer<typeof keyResultStatusSchema>

export const keyResultSchema = z.object({
  id: z.string(),
  okrId: z.string(),
  title: z.string(),
  unit: z.string().nullable(),
  startValue: z.number(),
  targetValue: z.number(),
  currentValue: z.number(),
  status: keyResultStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type KeyResult = z.infer<typeof keyResultSchema>

export const okrSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  employeeId: z.string(),
  parentOkrId: z.string().nullable(),
  quarter: z.string(),
  objective: z.string(),
  description: z.string().nullable(),
  status: okrStatusSchema,
  progressPercent: z.number().int().min(0).max(100),
  keyResults: z.array(keyResultSchema).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Okr = z.infer<typeof okrSchema>

export const okrCreateRequestSchema = z.object({
  employeeId: z.string().uuid(),
  parentOkrId: z.string().uuid().optional(),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/),
  objective: z.string().min(1),
  description: z.string().optional(),
  status: okrStatusSchema.optional(),
})
export type OkrCreateRequest = z.infer<typeof okrCreateRequestSchema>

export const okrUpdateRequestSchema = z.object({
  objective: z.string().min(1).optional(),
  description: z.string().optional(),
  status: okrStatusSchema.optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
})
export type OkrUpdateRequest = z.infer<typeof okrUpdateRequestSchema>

export const keyResultCreateRequestSchema = z.object({
  title: z.string().min(1),
  unit: z.string().optional(),
  startValue: z.number().optional(),
  targetValue: z.number(),
  currentValue: z.number().optional(),
})
export type KeyResultCreateRequest = z.infer<typeof keyResultCreateRequestSchema>

export const keyResultUpdateRequestSchema = z.object({
  title: z.string().min(1).optional(),
  unit: z.string().optional(),
  currentValue: z.number().optional(),
  targetValue: z.number().optional(),
  status: keyResultStatusSchema.optional(),
})
export type KeyResultUpdateRequest = z.infer<typeof keyResultUpdateRequestSchema>

// ─── IDP ────────────────────────────────────────────────────────────────────

export const idpStatusSchema = z.enum(['draft', 'active', 'completed'])
export type IdpStatus = z.infer<typeof idpStatusSchema>

export const idpItemStatusSchema = z.enum(['planned', 'in_progress', 'completed', 'dropped'])
export type IdpItemStatus = z.infer<typeof idpItemStatusSchema>

export const idpItemSchema = z.object({
  id: z.string(),
  idpId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: idpItemStatusSchema,
  dueDate: z.string().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type IdpItem = z.infer<typeof idpItemSchema>

export const idpSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  employeeId: z.string(),
  quarter: z.string(),
  summary: z.string().nullable(),
  status: idpStatusSchema,
  items: z.array(idpItemSchema).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Idp = z.infer<typeof idpSchema>

export const idpCreateRequestSchema = z.object({
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/),
  summary: z.string().optional(),
})
export type IdpCreateRequest = z.infer<typeof idpCreateRequestSchema>

export const idpUpdateRequestSchema = z.object({
  summary: z.string().optional(),
  status: idpStatusSchema.optional(),
})
export type IdpUpdateRequest = z.infer<typeof idpUpdateRequestSchema>

export const idpItemCreateRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().date().optional(),
})
export type IdpItemCreateRequest = z.infer<typeof idpItemCreateRequestSchema>

export const idpItemUpdateRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: idpItemStatusSchema.optional(),
  dueDate: z.string().date().optional(),
})
export type IdpItemUpdateRequest = z.infer<typeof idpItemUpdateRequestSchema>
