import { describe, expect, test } from 'bun:test'

import type { AppEnv } from '../../env'
import type { TranscriptionProvider } from '../../integrations/asr'
import { TranscriptionProviderError } from '../../integrations/asr'
import type { ProtocolProvider } from '../../integrations/llm'
import { ProtocolProviderMalformedResponseError } from '../../integrations/llm'
import {
  buildInterviewProtocol,
  buildOfferDraft,
  mapAgreedTermsToOfferDraft,
  transcribeInterview,
} from './interviews.service'
import {
  interviewProtocolSchema,
  offerDraftSchema,
  transcriptSchema,
} from './interviews.schemas'

// ─── Base env fixture ─────────────────────────────────────────────────────────

const baseEnv: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
  CORS_ORIGINS: ['http://localhost:5173'],
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  COOKIE_SECURE: false,
  HH_INTEGRATION_ENABLED: false,
  HH_CLIENT_ID: undefined,
  HH_CLIENT_SECRET: undefined,
  HH_TOKEN_ENCRYPTION_KEY: undefined,
  AI_SCORING_ENABLED: true,
  LLM_SCORING_PROVIDER: 'anthropic',
  LLM_SCORING_API_KEY: 'test-llm-key',
  LLM_SCORING_MODEL: 'claude-haiku-4-5-20251001',
  TRANSCRIPTION_ENABLED: true,
  ASR_PROVIDER: 'yandex_speechkit',
  ASR_API_KEY: 'test-asr-key',
  ASR_FOLDER_ID: 'test-folder',
  ASR_LANGUAGE: 'ru-RU',
  INTERVIEW_RECORDING_MAX_BYTES: 500 * 1024 * 1024,
  SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  SPACES_UPLOAD_URL_TTL_SECONDS: 900,
  SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
  SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  TELEGRAM_ENABLED: false,
  EMAIL_ENABLED: false,
  DOCUSEAL_ENABLED: false,
  SBER_PODBOR_ENABLED: false,
  AVITO_JOBS_ENABLED: false,
  RABOTA_RU_ENABLED: false,
  DOCUSEAL_API_URL: 'https://api.docuseal.com',
  CAREERS_PAGE_ENABLED: false,
  CAREERS_RATE_LIMIT_PER_HOUR: 20,
ASSESSMENTS_ENABLED: false,
  ASSESSMENT_SYSTEM_ENABLED: false,
  GEMINI_API_KEY: undefined,
  GEMINI_MODEL: 'gemini-2.0-flash',
PROCTORING_WEBCAM_ENABLED: false,
TRUST_WEIGHT_PASTE: 0.35,
TRUST_WEIGHT_FOCUS: 0.4,
TRUST_WEIGHT_KEYSTROKE: 0.25,
TRUST_LOW_THRESHOLD: 50,
QUIET_HOURS_QUIET_START_UTC: 15,
QUIET_HOURS_QUIET_END_UTC: 23,
  KNOWLEDGE_HUB_PGVECTOR_ENABLED: false,
  SIGNALS_OPEN_THRESHOLD: 60,
  REALTIME_ENABLED: false,
  MOBILE_PUSH_ENABLED: false,
  EXPO_PUSH_API_URL: 'https://exp.host/--/api/v2/push/send',
  BILLING_ENABLED: false,
  SUBDOMAIN_ROUTING_ENABLED: false,
  TENANT_REGISTRATION_ENABLED: true,
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const sampleTranscriptFixture = await Bun.file(
  new URL('./__fixtures__/sample-transcript.json', import.meta.url),
).json()

const sampleProtocolFixture = await Bun.file(
  new URL('./__fixtures__/sample-protocol.json', import.meta.url),
).json()

const sampleTranscript = transcriptSchema.parse(sampleTranscriptFixture)
const sampleProtocol = interviewProtocolSchema.parse(sampleProtocolFixture)

// ─── Transcript schema validation ─────────────────────────────────────────────

describe('transcript schema', () => {
  test('parses valid transcript fixture', () => {
    expect(sampleTranscript.segments).toHaveLength(6)
    expect(sampleTranscript.asr_provider).toBe('yandex_speechkit')
  })

  test('rejects transcript with negative start_ms', () => {
    const invalid = {
      ...sampleTranscript,
      segments: [{ speaker: 'a', start_ms: -1, end_ms: 5000, text: 'hi' }],
    }
    expect(transcriptSchema.safeParse(invalid).success).toBe(false)
  })
})

// ─── Protocol schema validation ───────────────────────────────────────────────

describe('interview protocol schema', () => {
  test('parses valid protocol fixture', () => {
    expect(sampleProtocol.summary).toBeTruthy()
    expect(sampleProtocol.agreed_terms.salary).toBe(250000)
    expect(sampleProtocol.agreed_terms.currency).toBe('RUB')
    expect(sampleProtocol.agreed_terms.start_date).toBe('2026-06-01')
    expect(sampleProtocol.agreed_terms.special_conditions).toHaveLength(1)
    expect(sampleProtocol.agreed_terms.salary_source?.segment_index).toBe(4)
    expect(sampleProtocol.agreed_terms.salary_source?.quote).toContain('250 000')
  })

  test('rejects protocol with empty summary', () => {
    const invalid = { ...sampleProtocol, summary: '' }
    expect(interviewProtocolSchema.safeParse(invalid).success).toBe(false)
  })
})

// ─── Offer draft mapping ──────────────────────────────────────────────────────

describe('mapAgreedTermsToOfferDraft', () => {
  test('maps all agreed terms to offer draft', () => {
    const draft = mapAgreedTermsToOfferDraft(sampleProtocol.agreed_terms)
    expect(draft.status).toBe('draft')
    expect(draft.salary).toBe(250000)
    expect(draft.currency).toBe('RUB')
    expect(draft.start_date).toBe('2026-06-01')
    expect(draft.conditions).toHaveLength(1)
    expect(draft.conditions[0]).toContain('2 дня в неделю')
  })

  test('offer draft is valid per offerDraftSchema', () => {
    const draft = mapAgreedTermsToOfferDraft(sampleProtocol.agreed_terms)
    expect(() => offerDraftSchema.parse(draft)).not.toThrow()
  })

  test('maps empty agreed_terms to draft with nulls', () => {
    const draft = mapAgreedTermsToOfferDraft({
      special_conditions: [],
      special_conditions_sources: [],
    })
    expect(draft.salary).toBeNull()
    expect(draft.currency).toBeNull()
    expect(draft.start_date).toBeNull()
    expect(draft.conditions).toHaveLength(0)
    expect(draft.status).toBe('draft')
  })
})

// ─── transcribeInterview service ──────────────────────────────────────────────

describe('transcribeInterview', () => {
  test('skips when transcription not configured', async () => {
    const env = { ...baseEnv, TRANSCRIPTION_ENABLED: false }
    const prisma = createInterviewPrismaMock()
    const result = await transcribeInterview({ prisma: prisma as never, env, interviewId: 'iv-1' })
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('not_configured')
  })

  test('skips when consent not recorded (consent gate)', async () => {
    const prisma = createInterviewPrismaMock({ consentRecorded: false })
    const result = await transcribeInterview({ prisma: prisma as never, env: baseEnv, interviewId: 'iv-1' })
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('consent_not_recorded')
  })

  test('skips when no recording URL', async () => {
    const prisma = createInterviewPrismaMock({ consentRecorded: true, recordingUrl: null })
    const result = await transcribeInterview({ prisma: prisma as never, env: baseEnv, interviewId: 'iv-1' })
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('no_recording')
  })

  test('stores transcript and emits audit event on success', async () => {
    const prisma = createInterviewPrismaMock({ consentRecorded: true, recordingUrl: 'local://test.mp3' })
    const provider: TranscriptionProvider = {
      transcribe: async () => ({
        segments: sampleTranscript.segments,
        language: 'ru-RU',
        asr_provider: 'yandex_speechkit',
        asr_model: 'general',
      }),
    }

    const result = await transcribeInterview({
      prisma: prisma as never,
      env: baseEnv,
      interviewId: 'iv-1',
      actorUserId: 'user-1',
      provider,
    })

    expect(result.skipped).toBe(false)
    expect(result.status).toBe('transcribed')
    expect(prisma.state.lastStatus).toBe('transcribed')
    expect(prisma.state.auditEvents).toHaveLength(1)
    expect(prisma.state.auditEvents[0]?.action).toBe('interview.transcribed')
  })

  test('writes failed status when provider throws', async () => {
    const prisma = createInterviewPrismaMock({ consentRecorded: true, recordingUrl: 'local://test.mp3' })
    const provider: TranscriptionProvider = {
      transcribe: async () => {
        throw new TranscriptionProviderError('yandex_speechkit', 'Network error')
      },
    }

    const result = await transcribeInterview({
      prisma: prisma as never,
      env: baseEnv,
      interviewId: 'iv-1',
      provider,
    })

    expect(result.skipped).toBe(false)
    expect(result.status).toBe('failed')
    expect(prisma.state.lastStatus).toBe('failed')
  })
})

// ─── buildInterviewProtocol service ──────────────────────────────────────────

describe('buildInterviewProtocol', () => {
  test('skips when LLM not configured', async () => {
    const env = { ...baseEnv, AI_SCORING_ENABLED: false }
    const prisma = createInterviewPrismaMock({ status: 'transcribed', transcript: sampleTranscriptFixture })
    const result = await buildInterviewProtocol({ prisma: prisma as never, env, interviewId: 'iv-1' })
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('llm_not_configured')
  })

  test('skips when interview not yet transcribed', async () => {
    const prisma = createInterviewPrismaMock({ status: 'created', transcript: null })
    const result = await buildInterviewProtocol({ prisma: prisma as never, env: baseEnv, interviewId: 'iv-1' })
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('not_yet_transcribed')
  })

  test('stores protocol and emits audit event on success', async () => {
    const prisma = createInterviewPrismaMock({
      status: 'transcribed',
      transcript: sampleTranscriptFixture,
    })
    const provider: ProtocolProvider = {
      buildProtocol: async () => sampleProtocol,
    }

    const result = await buildInterviewProtocol({
      prisma: prisma as never,
      env: baseEnv,
      interviewId: 'iv-1',
      actorUserId: 'user-1',
      provider,
    })

    expect(result.skipped).toBe(false)
    expect(result.status).toBe('protocol_built')
    expect(prisma.state.lastProtocol?.summary).toBeTruthy()
    expect(prisma.state.auditEvents).toHaveLength(1)
    expect(prisma.state.auditEvents[0]?.action).toBe('interview.protocol_built')
  })

  test('writes failed status when provider returns malformed JSON twice', async () => {
    const prisma = createInterviewPrismaMock({
      status: 'transcribed',
      transcript: sampleTranscriptFixture,
    })
    const provider: ProtocolProvider = {
      buildProtocol: async () => {
        throw new ProtocolProviderMalformedResponseError('claude-haiku-4-5-20251001')
      },
    }

    const result = await buildInterviewProtocol({
      prisma: prisma as never,
      env: baseEnv,
      interviewId: 'iv-1',
      provider,
    })

    expect(result.skipped).toBe(false)
    expect(result.status).toBe('failed')
    expect(prisma.state.lastStatus).toBe('failed')
  })
})

// ─── buildOfferDraft service ──────────────────────────────────────────────────

describe('buildOfferDraft', () => {
  test('skips when no protocol present', async () => {
    const prisma = createInterviewPrismaMock({ protocol: null })
    const result = await buildOfferDraft({ prisma: prisma as never, interviewId: 'iv-1' })
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('no_protocol')
  })

  test('builds offer draft deterministically from protocol', async () => {
    const prisma = createInterviewPrismaMock({
      status: 'transcribed',
      protocol: sampleProtocolFixture,
    })

    const result = await buildOfferDraft({ prisma: prisma as never, interviewId: 'iv-1', actorUserId: 'user-1' })

    expect(result.skipped).toBe(false)
    expect(result.status).toBe('offer_draft_built')
    expect(result.offerDraft?.salary).toBe(250000)
    expect(result.offerDraft?.currency).toBe('RUB')
    expect(result.offerDraft?.start_date).toBe('2026-06-01')
    expect(result.offerDraft?.status).toBe('draft')
    expect(prisma.state.lastStatus).toBe('protocol_ready')
    expect(prisma.state.auditEvents).toHaveLength(1)
    expect(prisma.state.auditEvents[0]?.action).toBe('interview.offer_draft_built')
  })

  test('offer draft is Zod-valid', async () => {
    const prisma = createInterviewPrismaMock({ status: 'transcribed', protocol: sampleProtocolFixture })
    const result = await buildOfferDraft({ prisma: prisma as never, interviewId: 'iv-1' })

    if (result.skipped === false && result.status === 'offer_draft_built') {
      expect(() => offerDraftSchema.parse(result.offerDraft)).not.toThrow()
    }
  })
})

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function createInterviewPrismaMock(overrides: Partial<{
  id: string
  tenantId: string
  consentRecorded: boolean
  recordingUrl: string | null
  status: string
  transcript: unknown
  protocol: unknown
  offerDraft: unknown
}> = {}) {
  const state = {
    interview: {
      id: 'iv-1',
      tenantId: 'tenant-1',
      applicationId: 'app-1',
      consentRecorded: false,
      recordingUrl: null as string | null,
      status: 'created',
      transcript: null as unknown,
      protocol: null as unknown,
      offerDraft: null as unknown,
      createdByUserId: 'user-1',
      ...overrides,
    },
    lastStatus: null as string | null,
    lastProtocol: null as Record<string, unknown> | null,
    lastOfferDraft: null as unknown,
    auditEvents: [] as Array<Record<string, unknown>>,
  }

  return {
    interview: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        return where.id === state.interview.id ? { ...state.interview } : null
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.status) state.lastStatus = data.status as string
        if (data.transcript) state.interview.transcript = data.transcript
        if (data.protocol) {
          state.interview.protocol = data.protocol
          state.lastProtocol = data.protocol as Record<string, unknown>
        }
        if (data.offerDraft) {
          state.interview.offerDraft = data.offerDraft
          state.lastOfferDraft = data.offerDraft
        }
        Object.assign(state.interview, data)
        return { ...state.interview }
      },
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditEvents.push(data)
      },
    },
    state,
  }
}
