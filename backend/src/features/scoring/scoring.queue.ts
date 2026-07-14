import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { Prisma } from '../../generated/prisma/client'
import { createInMemoryQueue } from '../../queues'
import { isAiScoringConfigured } from '../../integrations/llm'

import { scoreApplication } from './scoring.service'
import type { ScoringProvider } from '../../integrations/llm'

type ScoringJob = {
  prisma: DbClient
  env: AppEnv
  applicationId: string
  actorUserId?: string
  force?: boolean
}

const scoringQueue = createInMemoryQueue<ScoringJob>('application.ai_scoring')
let scoringQueueRegistered = false
const DEFAULT_PENDING_STALE_MS = 5 * 60 * 1000

function ensureScoringQueueRegistered() {
  if (scoringQueueRegistered) return
  scoringQueueRegistered = true

  scoringQueue.process(async (job) => {
    await scoreApplication(job)
  })
}

export async function enqueueApplicationScoringJob(input: ScoringJob) {
  if (!isAiScoringConfigured(input.env)) {
    return { queued: false as const, reason: 'not_configured' as const }
  }

  await markApplicationScoringQueued(input)
  ensureScoringQueueRegistered()
  await scoringQueue.enqueue(input)
  return { queued: true as const }
}

export async function markApplicationScoringQueued(input: Omit<ScoringJob, 'env'>) {
  const existing = await input.prisma.application.findFirst({
    where: { id: input.applicationId },
    select: {
      id: true,
      aiScoring: true,
    },
  })

  if (!existing) {
    return { marked: false as const, reason: 'application_not_found' as const }
  }

  const existingScoring = asRecord(existing.aiScoring)
  await input.prisma.application.update({
    where: { id: input.applicationId },
    data: {
      aiScoring: {
        status: 'pending',
        queue: scoringQueue.name,
        queued_at: new Date().toISOString(),
        force: Boolean(input.force),
        previous_scoring: existingScoring?.status === 'scored' ? existingScoring : undefined,
      } as Prisma.InputJsonValue,
    },
  })

  return { marked: true as const }
}

export async function recoverPendingApplicationScoring(input: {
  prisma: DbClient
  env: AppEnv
  limit?: number
  staleAfterMs?: number
  provider?: ScoringProvider
}) {
  if (!isAiScoringConfigured(input.env)) {
    return { recovered: 0, skipped: 0, reason: 'not_configured' as const }
  }

  const limit = input.limit ?? 25
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_PENDING_STALE_MS
  const cutoff = Date.now() - staleAfterMs
  const rows = await input.prisma.application.findMany({
    where: {
      aiScoring: {
        path: ['status'],
        equals: 'pending',
      },
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    select: {
      id: true,
      aiScoring: true,
    },
  })

  let recovered = 0
  let skipped = 0

  for (const row of rows) {
    const scoring = asRecord(row.aiScoring)
    const queuedAt = typeof scoring?.queued_at === 'string' ? Date.parse(scoring.queued_at) : Number.NaN
    if (Number.isFinite(queuedAt) && queuedAt > cutoff) {
      skipped += 1
      continue
    }

    await scoreApplication({
      prisma: input.prisma,
      env: input.env,
      applicationId: row.id,
      force: scoring?.force === true,
      provider: input.provider,
    })
    recovered += 1
  }

  return { recovered, skipped }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
