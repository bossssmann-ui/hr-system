/**
 * Interview pipeline queues — three chained jobs:
 *   interview.transcribe → interview.build_protocol → interview.build_offer_draft
 *
 * Each job is idempotent and graceful on failure (queue swallows errors).
 * Chaining: transcribe job enqueues build_protocol on success; build_protocol
 * enqueues build_offer_draft on success.
 */

import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { createInMemoryQueue } from '../../queues'
import { isTranscriptionConfigured } from '../../integrations/asr'
import { isAiScoringConfigured } from '../../integrations/llm'
import {
  buildInterviewProtocol,
  buildOfferDraft,
  transcribeInterview,
} from './interviews.service'

type TranscribeJob = {
  prisma: DbClient
  env: AppEnv
  interviewId: string
  actorUserId?: string
}

type BuildProtocolJob = {
  prisma: DbClient
  env: AppEnv
  interviewId: string
  actorUserId?: string
}

type BuildOfferDraftJob = {
  prisma: DbClient
  interviewId: string
  actorUserId?: string
}

const transcribeQueue = createInMemoryQueue<TranscribeJob>('interview.transcribe')
const buildProtocolQueue = createInMemoryQueue<BuildProtocolJob>('interview.build_protocol')
const buildOfferDraftQueue = createInMemoryQueue<BuildOfferDraftJob>('interview.build_offer_draft')

let transcribeRegistered = false
let buildProtocolRegistered = false
let buildOfferDraftRegistered = false

function ensureTranscribeRegistered() {
  if (transcribeRegistered) return
  transcribeRegistered = true

  transcribeQueue.process(async (job) => {
    const result = await transcribeInterview(job)
    if (result.skipped === false && result.status === 'transcribed') {
      // Chain to protocol building.
      ensureBuildProtocolRegistered()
      await buildProtocolQueue.enqueue({
        prisma: job.prisma,
        env: job.env,
        interviewId: job.interviewId,
        actorUserId: job.actorUserId,
      })
    }
  })
}

function ensureBuildProtocolRegistered() {
  if (buildProtocolRegistered) return
  buildProtocolRegistered = true

  buildProtocolQueue.process(async (job) => {
    const result = await buildInterviewProtocol(job)
    if (result.skipped === false && result.status === 'protocol_built') {
      // Chain to offer draft.
      ensureBuildOfferDraftRegistered()
      await buildOfferDraftQueue.enqueue({
        prisma: job.prisma,
        interviewId: job.interviewId,
        actorUserId: job.actorUserId,
      })
    }
  })
}

function ensureBuildOfferDraftRegistered() {
  if (buildOfferDraftRegistered) return
  buildOfferDraftRegistered = true

  buildOfferDraftQueue.process(async (job) => {
    await buildOfferDraft(job)
  })
}

export async function enqueueTranscribeJob(input: TranscribeJob) {
  if (!isTranscriptionConfigured(input.env)) {
    return { queued: false as const, reason: 'not_configured' as const }
  }

  ensureTranscribeRegistered()
  await transcribeQueue.enqueue(input)
  return { queued: true as const }
}

export async function enqueueBuildProtocolJob(input: BuildProtocolJob) {
  if (!isAiScoringConfigured(input.env)) {
    return { queued: false as const, reason: 'llm_not_configured' as const }
  }

  ensureBuildProtocolRegistered()
  await buildProtocolQueue.enqueue(input)
  return { queued: true as const }
}
