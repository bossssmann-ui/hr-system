import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { createInMemoryQueue } from '../../queues'
import { isAiScoringConfigured } from '../../integrations/llm'

import { scoreApplication } from './scoring.service'

type ScoringJob = {
  prisma: DbClient
  env: AppEnv
  applicationId: string
  actorUserId?: string
  force?: boolean
}

const scoringQueue = createInMemoryQueue<ScoringJob>('application.ai_scoring')
let scoringQueueRegistered = false

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

  ensureScoringQueueRegistered()
  await scoringQueue.enqueue(input)
  return { queued: true as const }
}

ensureScoringQueueRegistered()
