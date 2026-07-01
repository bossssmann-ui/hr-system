import { describe, expect, test } from 'bun:test'

import { AnthropicScoringProvider } from './anthropic.provider'
import { createAssessmentProvider, createScoringProvider } from './index'
import { OpenAiCompatibleScoringProvider } from './openai-compatible.provider'
import type { AppEnv } from '../../env'

describe('AnthropicScoringProvider', () => {
  test('parses valid JSON and adds model metadata', async () => {
    const provider = new AnthropicScoringProvider({
      apiKey: 'test-key',
      model: 'claude-haiku-4-5-20251001',
      client: {
        messages: {
          create: async () => ({
            content: [{
              type: 'text',
              text: JSON.stringify({
                relevance_score: 82,
                summary: 'Strong technical alignment with partial domain gap.',
                strengths: ['Backend API design', 'TypeScript'],
                gaps: ['No direct payroll domain'],
                soft_skills_signals: ['Clear ownership language'],
                red_flags: [],
                anti_fraud_signals: [],
                values_fit_hypothesis: 'Likely collaborative and delivery-focused.',
                interview_focus_areas: ['Domain adaptation speed'],
              }),
            }],
          }),
        },
      },
    })

    const result = await provider.score({
      job_profile: {
        title: 'Backend Engineer',
        grade: 'M3',
        description: 'Build APIs',
        required_skills: ['TypeScript'],
        salary_range: { min: 200000, max: 300000, currency: 'RUB' },
      },
      candidate_resume: {
        title: 'Senior Backend Engineer',
        experience: ['Node.js API Engineer at Acme'],
        education: ['MSc Computer Science'],
        skills: ['TypeScript'],
        total_experience_months: 72,
        location: 'Moscow',
      },
    })

    expect(result.relevance_score).toBe(82)
    expect(result.model).toBe('claude-haiku-4-5-20251001')
    expect(result.schema_version).toBe(2)
  })

  test('retries once when first response is malformed JSON', async () => {
    let calls = 0
    const provider = new AnthropicScoringProvider({
      apiKey: 'test-key',
      model: 'claude-haiku-4-5-20251001',
      client: {
        messages: {
          create: async () => {
            calls += 1
            if (calls === 1) {
              return { content: [{ type: 'text', text: 'not json' }] }
            }
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  relevance_score: 55,
                  summary: 'Some match but gaps remain.',
                  strengths: ['API basics'],
                  gaps: ['System design depth'],
                  soft_skills_signals: ['Concise writing'],
                  red_flags: [],
                  anti_fraud_signals: [],
                  values_fit_hypothesis: 'Unknown due to sparse evidence.',
                  interview_focus_areas: ['Depth in distributed systems'],
                }),
              }],
            }
          },
        },
      },
    })

    const result = await provider.score({
      job_profile: {
        title: 'Backend Engineer',
        grade: 'M3',
        description: 'Build APIs',
        required_skills: ['TypeScript'],
        salary_range: { min: 200000, max: 300000, currency: 'RUB' },
      },
      candidate_resume: {
        title: null,
        experience: [],
        education: [],
        skills: [],
        total_experience_months: null,
        location: null,
      },
    })

    expect(calls).toBe(2)
    expect(result.relevance_score).toBe(55)
  })
})

describe('OpenAiCompatibleScoringProvider', () => {
  const scoringInput = {
    job_profile: {
      title: 'Backend Engineer',
      grade: 'M3',
      description: 'Build APIs',
      required_skills: ['TypeScript'],
      salary_range: { min: 200000, max: 300000, currency: 'RUB' },
    },
    candidate_resume: {
      title: null,
      experience: [],
      education: [],
      skills: [],
      total_experience_months: null,
      location: null,
    },
  }

  test('parses OpenAI-compatible response into scoring result', async () => {
    const provider = new OpenAiCompatibleScoringProvider({
      apiKey: 'test-key',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      fetcher: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    relevance_score: 91,
                    summary: 'Strong technical fit.',
                    strengths: ['TypeScript'],
                    gaps: [],
                    soft_skills_signals: ['Clear communication'],
                    red_flags: [],
                    anti_fraud_signals: [],
                    values_fit_hypothesis: 'Likely aligned.',
                    interview_focus_areas: ['Domain depth'],
                  }),
                },
              },
            ],
          }),
        ),
    })

    const result = await provider.score(scoringInput)

    expect(result.relevance_score).toBe(91)
    expect(result.model).toBe('deepseek-chat')
    expect(result.schema_version).toBe(2)
  })

  test('throws on invalid JSON after retry', async () => {
    const provider = new OpenAiCompatibleScoringProvider({
      apiKey: 'test-key',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      fetcher: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'not json' } }],
          }),
        ),
    })

    await expect(provider.score(scoringInput)).rejects.toThrow('Malformed JSON response from scoring provider')
  })
})

describe('LLM provider factories', () => {
  const envBase = {
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'db-url',
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: ['http://localhost:5173'],
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_DAYS: 30,
    COOKIE_SECURE: false,
    HH_INTEGRATION_ENABLED: false,
    HH_CLIENT_ID: undefined,
    HH_CLIENT_SECRET: undefined,
    HH_TOKEN_ENCRYPTION_KEY: undefined,
    AI_SCORING_ENABLED: true,
    LLM_SCORING_BASE_URL: undefined,
    LLM_SCORING_API_KEY: 'test-key',
    LLM_SCORING_MODEL: 'claude-haiku-4-5-20251001',
    TRANSCRIPTION_ENABLED: false,
    ASR_PROVIDER: 'yandex_speechkit',
    ASR_API_KEY: undefined,
    ASR_FOLDER_ID: undefined,
    ASR_LANGUAGE: 'ru-RU',
    INTERVIEW_RECORDING_MAX_BYTES: 1024,
    SPACES_REGION: undefined,
    SPACES_BUCKET: undefined,
    SPACES_ENDPOINT: undefined,
    SPACES_CDN_BASE_URL: undefined,
    SPACES_ACCESS_KEY_ID: undefined,
    SPACES_SECRET_ACCESS_KEY: undefined,
    SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
    SPACES_UPLOAD_URL_TTL_SECONDS: 900,
    SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
    SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
    TELEGRAM_ENABLED: false,
    TELEGRAM_BOT_TOKEN: undefined,
    EMAIL_ENABLED: false,
    SMTP_HOST: undefined,
    SMTP_PORT: undefined,
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
    SMTP_FROM: undefined,
    CAREERS_PAGE_ENABLED: false,
    CAREERS_RATE_LIMIT_PER_HOUR: 20,
    QUIET_HOURS_QUIET_START_UTC: 15,
    QUIET_HOURS_QUIET_END_UTC: 23,
    ASSESSMENTS_ENABLED: false,
    ASSESSMENT_SYSTEM_ENABLED: false,
  AUTO_SELECTION_ENABLED: false,
  AUTO_ASSESSMENT_ENABLED: false,
  COMPOSITE_SCORE_ENABLED: false,
  RECRUITER_NOTIFICATIONS_ENABLED: false,
  AUTO_SELECTION_THRESHOLD: 70,
  AUTO_REJECT_THRESHOLD: 30,
    GEMINI_API_KEY: undefined,
    GEMINI_MODEL: 'gemini-2.0-flash',
    PROCTORING_WEBCAM_ENABLED: false,
    TRUST_WEIGHT_PASTE: 0.35,
    TRUST_WEIGHT_FOCUS: 0.4,
    TRUST_WEIGHT_KEYSTROKE: 0.25,
    TRUST_LOW_THRESHOLD: 50,
    SBER_PODBOR_ENABLED: false,
    SBER_PODBOR_API_TOKEN: undefined,
    AVITO_JOBS_ENABLED: false,
    AVITO_JOBS_API_TOKEN: undefined,
    RABOTA_RU_ENABLED: false,
    RABOTA_RU_API_TOKEN: undefined,
    DOCUSEAL_ENABLED: false,
    DOCUSEAL_API_URL: 'https://api.docuseal.com',
    DOCUSEAL_API_KEY: undefined,
    DOCUSEAL_TEMPLATE_ID: undefined,
    DOCUSEAL_WEBHOOK_SECRET: undefined,
    KNOWLEDGE_HUB_PGVECTOR_ENABLED: false,
    SIGNALS_OPEN_THRESHOLD: 60,
    REALTIME_ENABLED: false,
    VALKEY_URL: undefined,
    MOBILE_PUSH_ENABLED: false,
    EXPO_PUSH_API_URL: 'https://exp.host/--/api/v2/push/send',
    QUEUE_POLL_INTERVAL_MS: undefined,
    QUEUE_BATCH_SIZE: undefined,
    QUEUE_MAX_RETRIES: undefined,
    QUEUE_JOB_TIMEOUT_MS: undefined,
    BILLING_ENABLED: false,
    SUBDOMAIN_ROUTING_ENABLED: false,
    TENANT_REGISTRATION_ENABLED: true,
    LLM_SCORING_PROVIDER: 'anthropic',
  } satisfies AppEnv

  test('selects openai-compatible providers when configured', () => {
    const env = {
      ...envBase,
      LLM_SCORING_PROVIDER: 'openai_compatible',
      LLM_SCORING_BASE_URL: 'http://localhost:8000/v1',
      LLM_SCORING_MODEL: 'qwen2.5-72b-instruct',
    } satisfies AppEnv

    expect(createScoringProvider(env)).toBeInstanceOf(OpenAiCompatibleScoringProvider)
    expect(createAssessmentProvider(env).constructor.name).toBe('OpenAiCompatibleAssessmentProvider')
  })

  test('throws clear error on unknown provider', () => {
    const env = {
      ...envBase,
      LLM_SCORING_PROVIDER: 'unknown-provider',
    } satisfies AppEnv

    expect(() => createScoringProvider(env)).toThrow('Unsupported LLM_SCORING_PROVIDER: unknown-provider')
    expect(() => createAssessmentProvider(env)).toThrow('Unsupported LLM_SCORING_PROVIDER: unknown-provider')
  })
})
