/**
 * Interview pipeline service — three chained stages:
 *   1. transcribeInterview  — ASR → stores Transcript, sets status=transcribed
 *   2. buildProtocol        — LLM → stores InterviewProtocol, Zod-validated
 *   3. buildOfferDraft      — deterministic mapping from agreed_terms → OfferDraft
 *
 * Each stage is idempotent and graceful on failure (never crashes the process).
 * AuditEvents: interview.transcribed, interview.protocol_built, interview.offer_draft_built.
 *
 * Consent gate: transcription MUST NOT start unless consent_recorded = true.
 * Legal basis: 152-ФЗ, candidate's recorded consent. See docs/contracts/40-audit.md.
 */

import { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import {
  createTranscriptionProvider,
  isTranscriptionConfigured,
  TranscriptionProviderError,
  type TranscriptionProvider,
} from '../../integrations/asr'
import {
  AnthropicProtocolProvider,
  isAiScoringConfigured,
  ProtocolProviderMalformedResponseError,
  type ProtocolProvider,
} from '../../integrations/llm'
import {
  transcriptSchema,
  interviewProtocolSchema,
  offerDraftSchema,
  type AgreedTerms,
  type OfferDraft,
} from './interviews.schemas'

// ─── Stage 1: Transcribe ──────────────────────────────────────────────────────

type TranscribeInput = {
  prisma: DbClient
  env: AppEnv
  interviewId: string
  actorUserId?: string
  provider?: TranscriptionProvider
}

export async function transcribeInterview(input: TranscribeInput) {
  const { prisma, env, interviewId, actorUserId } = input

  if (!isTranscriptionConfigured(env)) {
    return { skipped: true as const, reason: 'not_configured' as const }
  }

  const interview = await prisma.interview.findFirst({ where: { id: interviewId } })
  if (!interview) {
    return { skipped: true as const, reason: 'not_found' as const }
  }

  if (!interview.consentRecorded) {
    return { skipped: true as const, reason: 'consent_not_recorded' as const }
  }

  if (!interview.recordingUrl) {
    return { skipped: true as const, reason: 'no_recording' as const }
  }

  // Idempotency: skip if already transcribed with same recording.
  if (interview.status === 'transcribed' || interview.status === 'protocol_ready') {
    return { skipped: true as const, reason: 'already_transcribed' as const }
  }

  const provider = input.provider ?? createTranscriptionProvider(env)

  // Mark as transcribing.
  await prisma.interview.update({
    where: { id: interviewId },
    data: { status: 'transcribing' },
  })

  try {
    const result = await provider.transcribe({
      audioRef: interview.recordingUrl,
      language: env.ASR_LANGUAGE,
    })

    const transcript = transcriptSchema.parse({
      ...result,
      created_at: new Date().toISOString(),
    })

    await prisma.interview.update({
      where: { id: interviewId },
      data: {
        transcript: transcript as Prisma.InputJsonValue,
        status: 'transcribed',
      },
    })

    await prisma.auditEvent.create({
      data: {
        tenantId: interview.tenantId,
        actorUserId: actorUserId ?? null,
        action: 'interview.transcribed',
        entityType: 'Interview',
        entityId: interview.id,
        diff: {
          asr_provider: result.asr_provider,
          asr_model: result.asr_model,
          segment_count: result.segments.length,
          status: 'transcribed',
        } as Prisma.InputJsonValue,
      },
    })

    return { skipped: false as const, status: 'transcribed' as const }
  } catch (error) {
    await prisma.interview.update({
      where: { id: interviewId },
      data: { status: 'failed' },
    })

    const message = error instanceof Error ? error.message : 'Unknown transcription error'

    return { skipped: false as const, status: 'failed' as const, error: message }
  }
}

// ─── Stage 2: Build Protocol ──────────────────────────────────────────────────

type BuildProtocolInput = {
  prisma: DbClient
  env: AppEnv
  interviewId: string
  actorUserId?: string
  provider?: ProtocolProvider
}

export async function buildInterviewProtocol(input: BuildProtocolInput) {
  const { prisma, env, interviewId, actorUserId } = input

  if (!isAiScoringConfigured(env)) {
    return { skipped: true as const, reason: 'llm_not_configured' as const }
  }

  const interview = await prisma.interview.findFirst({ where: { id: interviewId } })
  if (!interview) {
    return { skipped: true as const, reason: 'not_found' as const }
  }

  if (interview.status !== 'transcribed') {
    return { skipped: true as const, reason: 'not_yet_transcribed' as const }
  }

  if (!interview.transcript) {
    return { skipped: true as const, reason: 'no_transcript' as const }
  }

  const transcriptParsed = transcriptSchema.safeParse(interview.transcript)
  if (!transcriptParsed.success) {
    return { skipped: true as const, reason: 'invalid_transcript' as const }
  }

  const provider =
    input.provider ??
    new AnthropicProtocolProvider({
      apiKey: env.LLM_SCORING_API_KEY!,
      model: env.LLM_SCORING_MODEL,
    })

  try {
    const protocol = await provider.buildProtocol(transcriptParsed.data.segments)

    // Validate with Zod (already done inside provider, but double-check here).
    const validated = interviewProtocolSchema.parse(protocol)

    await prisma.interview.update({
      where: { id: interviewId },
      data: {
        protocol: validated as Prisma.InputJsonValue,
        // status stays 'transcribed' until offer draft is built
      },
    })

    await prisma.auditEvent.create({
      data: {
        tenantId: interview.tenantId,
        actorUserId: actorUserId ?? null,
        action: 'interview.protocol_built',
        entityType: 'Interview',
        entityId: interview.id,
        diff: {
          model: validated.model,
          schema_version: validated.schema_version,
          has_agreed_terms: Object.keys(validated.agreed_terms).length > 0,
        } as Prisma.InputJsonValue,
      },
    })

    return { skipped: false as const, status: 'protocol_built' as const, protocol: validated }
  } catch (error) {
    await prisma.interview.update({
      where: { id: interviewId },
      data: { status: 'failed' },
    })

    const message =
      error instanceof ProtocolProviderMalformedResponseError
        ? 'Protocol provider returned malformed JSON twice'
        : error instanceof Error
          ? error.message
          : 'Unknown protocol error'

    return { skipped: false as const, status: 'failed' as const, error: message }
  }
}

// ─── Stage 3: Build Offer Draft ───────────────────────────────────────────────

type BuildOfferDraftInput = {
  prisma: DbClient
  interviewId: string
  actorUserId?: string
}

/**
 * Deterministic mapping from protocol.agreed_terms → OfferDraft.
 * No LLM — auditable straight mapping.
 * TODO(phase-3): replace with full Offer + approval chain + DocuSeal signing.
 */
export async function buildOfferDraft(input: BuildOfferDraftInput) {
  const { prisma, interviewId, actorUserId } = input

  const interview = await prisma.interview.findFirst({ where: { id: interviewId } })
  if (!interview) {
    return { skipped: true as const, reason: 'not_found' as const }
  }

  if (!interview.protocol) {
    return { skipped: true as const, reason: 'no_protocol' as const }
  }

  const protocolParsed = interviewProtocolSchema.safeParse(interview.protocol)
  if (!protocolParsed.success) {
    return { skipped: true as const, reason: 'invalid_protocol' as const }
  }

  const draft: OfferDraft = mapAgreedTermsToOfferDraft(protocolParsed.data.agreed_terms)

  // Validate before storing.
  const validated = offerDraftSchema.parse(draft)

  await prisma.interview.update({
    where: { id: interviewId },
    data: {
      offerDraft: validated as Prisma.InputJsonValue,
      status: 'protocol_ready',
    },
  })

  await prisma.auditEvent.create({
    data: {
      tenantId: interview.tenantId,
      actorUserId: actorUserId ?? null,
      action: 'interview.offer_draft_built',
      entityType: 'Interview',
      entityId: interview.id,
      diff: {
        has_salary: validated.salary != null,
        has_start_date: validated.start_date != null,
        conditions_count: validated.conditions.length,
        status: 'protocol_ready',
      } as Prisma.InputJsonValue,
    },
  })

  return { skipped: false as const, status: 'offer_draft_built' as const, offerDraft: validated }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function mapAgreedTermsToOfferDraft(agreedTerms: AgreedTerms): OfferDraft {
  return {
    salary: agreedTerms.salary ?? null,
    currency: agreedTerms.currency ?? null,
    start_date: agreedTerms.start_date ?? null,
    conditions: agreedTerms.special_conditions ?? [],
    grade: null,
    status: 'draft',
  }
}
