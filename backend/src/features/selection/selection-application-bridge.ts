import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { Prisma } from '../../generated/prisma/client'
import { getChannelAdapter } from '../messaging/messaging.service'
import { decryptHhSecret } from '../../integrations/hh/crypto'
import { getRealtimeBus } from '../../services/realtime'
import { notifyRecruitersAboutApplicationCreated } from '../applications/application-notifications'
import type { SupportedRole } from './selection-role-adapter'
import { createSelectionSession } from './selection-session.service'

type ApplicationSource = 'public_apply' | 'hh_sync' | 'manual'

export async function handleApplicationCreatedForSelection(input: {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  applicationId: string
  source: ApplicationSource
}) {
  if (!input.env.ASSESSMENT_SYSTEM_ENABLED) return { created: false as const, reason: 'selection_disabled' as const }

  const application = await input.prisma.application.findFirst({
    where: { id: input.applicationId, tenantId: input.tenantId },
    include: {
      candidate: true,
      vacancy: {
        include: {
          requisition: true,
        },
      },
    },
  })
  if (!application) return { created: false as const, reason: 'application_not_found' as const }

  const role = await inferSupportedRole({
    prisma: input.prisma,
    tenantId: input.tenantId,
    vacancyId: application.vacancyId,
    vacancyRole: asRecord(application.vacancy)['role'],
    requisitionRole: asRecord(application.vacancy.requisition)['role'],
    vacancyTitle: application.vacancy.title,
    vacancyDescription: application.vacancy.description,
    requisitionTitle: application.vacancy.requisition?.title ?? null,
  })
  if (!role) {
    console.warn(JSON.stringify({
      level: 'warn',
      msg: 'selection.bridge.role_not_supported',
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      vacancyId: application.vacancyId,
    }))
    await markApplicationPipelineBindingRequired(input.prisma, {
      tenantId: input.tenantId,
      applicationId: application.id,
      currentAiFlags: application.aiFlags,
    })
    return { created: false as const, reason: 'role_not_supported' as const }
  }

  const { session, created } = await createSelectionSession({
    prisma: input.prisma,
    tenantId: input.tenantId,
    vacancyId: application.vacancyId,
    role,
    applicationId: application.id,
  })

  if (created && await isTenantFlagEnabled(input.prisma, input.tenantId, 'selection.autoInvite.enabled')) {
    await sendSelectionInvite({
      prisma: input.prisma,
      env: input.env,
      tenantId: input.tenantId,
      candidate: {
        source: application.candidate.source,
        email: application.candidate.email,
        externalIds: asRecord(application.candidate.externalIds),
      },
      token: session.token,
    })
  }

  return { created, sessionId: session.id, token: session.token }
}

export function registerSelectionApplicationBridge(input: {
  prisma: DbClient
  env: AppEnv
}) {
  if (registeredPrismaClients.has(input.prisma as object)) return () => undefined
  registeredPrismaClients.add(input.prisma as object)
  return getRealtimeBus().subscribeAll(async ({ tenantId, event }) => {
    if (event.type !== 'application.created') return
    const applicationId = typeof event.payload.applicationId === 'string' ? event.payload.applicationId : null
    if (!applicationId) return
    const source = asSource(event.payload.source)
    try {
      await notifyRecruitersAboutApplicationCreated({
        prisma: input.prisma,
        env: input.env,
        tenantId,
        applicationId,
      })
    } catch {
      // notifier bridge is best-effort
    }
    try {
      await handleApplicationCreatedForSelection({
        prisma: input.prisma,
        env: input.env,
        tenantId,
        applicationId,
        source,
      })
    } catch {
      // selection bridge is best-effort and must never break realtime bus
    }
  })
}
const registeredPrismaClients = new WeakSet<object>()

function asSource(value: unknown): ApplicationSource {
  if (value === 'hh_sync') return 'hh_sync'
  if (value === 'public_apply') return 'public_apply'
  return 'manual'
}

async function inferSupportedRole(input: {
  prisma: DbClient
  tenantId: string
  vacancyId: string
  vacancyRole: unknown
  requisitionRole: unknown
  vacancyTitle: string
  vacancyDescription: string
  requisitionTitle: string | null
}): Promise<SupportedRole | null> {
  const explicitRole =
    parseSupportedRole(input.vacancyRole) ??
    parseSupportedRole(input.requisitionRole)
  if (explicitRole) return explicitRole

  const roleFromTemplate = await resolveRoleFromTemplate(input.prisma, input.tenantId, input.vacancyId)
  if (roleFromTemplate) return roleFromTemplate

  const haystack = `${input.vacancyTitle} ${input.vacancyDescription} ${input.requisitionTitle ?? ''}`.toLowerCase()
  if (
    haystack.includes('logist') ||
    haystack.includes('логист')
  ) {
    if (
      haystack.includes('domestic') ||
      haystack.includes('внутрен') ||
      haystack.includes('рф')
    ) {
      return 'logist_domestic'
    }
    return 'logist'
  }
  if (haystack.includes('sales') || haystack.includes('продаж')) {
    return 'sales_manager'
  }
  return null
}

function parseSupportedRole(value: unknown): SupportedRole | null {
  if (typeof value !== 'string') return null
  if (value === 'logist' || value === 'sales_manager' || value === 'logist_domestic') return value
  return null
}

async function resolveRoleFromTemplate(prisma: DbClient, tenantId: string, vacancyId: string): Promise<SupportedRole | null> {
  const templates = await prisma.selectionTemplate.findMany({
    where: { tenantId, vacancyId },
    select: { role: true },
  })
  const supported = Array.from(new Set(templates.map((item) => parseSupportedRole(item.role)).filter(Boolean)))
  if (supported.length === 1) return supported[0] ?? null
  return null
}

async function isTenantFlagEnabled(prisma: DbClient, tenantId: string, key: string): Promise<boolean> {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { featureFlags: true },
  })
  const flags = asRecord(settings?.featureFlags)
  return flags[key] === true
}

async function sendSelectionInvite(input: {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  candidate: {
    source: string
    email: string | null
    externalIds: Record<string, unknown>
  }
  token: string
}) {
  const hhAccessToken = await resolveHhAccessToken(input.prisma, input.env, input.tenantId)
  const channels = resolveCandidateChannels(input.candidate)
  const link = buildSelectionLink(input.env, input.token)
  const body = `Здравствуйте! Продолжите отбор по ссылке: ${link}`

  await Promise.all(channels.map(async (channel) => {
    const adapter = getChannelAdapter(channel, input.env, hhAccessToken ?? undefined)
    if (!adapter) return
    const destination = resolveDestination(channel, input.candidate.externalIds, input.candidate.email)
    if (!destination) return
    await adapter.send({ destination, body, subject: 'Ссылка на этап отбора' }).catch(() => undefined)
  }))
}

function buildSelectionLink(env: AppEnv, token: string) {
  const origin = env.CORS_ORIGINS[0]
  if (!origin) return `/selection/${token}`
  return `${origin.replace(/\/$/, '')}/selection/${token}`
}

function resolveCandidateChannels(candidate: {
  source: string
  email: string | null
  externalIds: Record<string, unknown>
}) {
  const channels: Array<'hh_chat' | 'email' | 'telegram' | 'in_app'> = []
  if (candidate.source === 'hh_ru' && typeof candidate.externalIds['hh_messages_url'] === 'string') {
    channels.push('hh_chat')
  } else {
    if (candidate.email) channels.push('email')
    if (typeof candidate.externalIds['telegram_chat_id'] === 'string') channels.push('telegram')
  }
  channels.push('in_app')
  return channels
}

function resolveDestination(
  channel: 'hh_chat' | 'email' | 'telegram' | 'in_app',
  externalIds: Record<string, unknown>,
  email: string | null,
) {
  if (channel === 'hh_chat') return typeof externalIds['hh_messages_url'] === 'string' ? externalIds['hh_messages_url'] : null
  if (channel === 'telegram') return typeof externalIds['telegram_chat_id'] === 'string' ? externalIds['telegram_chat_id'] : null
  if (channel === 'email') return email
  return 'in_app'
}

async function resolveHhAccessToken(prisma: DbClient, env: AppEnv, tenantId: string): Promise<string | null> {
  if (!env.HH_TOKEN_ENCRYPTION_KEY) return null
  const connection = await prisma.hhConnection.findUnique({
    where: { tenantId },
    select: { accessToken: true },
  })
  if (!connection) return null
  try {
    return decryptHhSecret(connection.accessToken, env.HH_TOKEN_ENCRYPTION_KEY)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

async function markApplicationPipelineBindingRequired(
  prisma: DbClient,
  input: { tenantId: string; applicationId: string; currentAiFlags: unknown },
) {
  const flags = asRecord(input.currentAiFlags)
  await prisma.application.update({
    where: { id: input.applicationId },
    data: {
      aiFlags: {
        ...flags,
        selectionPipelineBindingRequired: true,
        selectionPipelineBindingReason: 'role_not_supported',
      } as Prisma.InputJsonValue,
    },
  }).catch(() => undefined)
}
