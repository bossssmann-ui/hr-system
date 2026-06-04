import { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { createNotifier, type NotificationChannel } from '../../services/notifier'

const FALLBACK_RECRUITER_ROLES = ['recruiter', 'hr_admin', 'owner'] as const

type RecruiterRecipient = {
  userId: string
  tenantId: string
}

export async function notifyRecruitersAboutApplicationCreated(input: {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  applicationId: string
}) {
  try {
    const application = await input.prisma.application.findFirst({
      where: { id: input.applicationId, tenantId: input.tenantId },
      select: {
        id: true,
        vacancy: { select: { title: true } },
        assignedToUserId: true,
      },
    })
    if (!application) return

    const recipients = await resolveRecruiterRecipients(input.prisma, {
      tenantId: input.tenantId,
      assignedToUserId: application.assignedToUserId,
    })
    if (recipients.length === 0) return

    await notifyRecruiters(input.prisma, input.env, {
      recipients,
      template: 'application.created',
      payload: {
        applicationId: application.id,
        vacancyTitle: application.vacancy.title,
        title: 'Новый отклик',
        body: `Новый отклик на вакансию ${application.vacancy.title}`,
      },
    })
  } catch {
    // best-effort
  }
}

export async function notifyRecruitersAboutSelectionReady(input: {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  applicationId: string | null
  totalScore: number | null
}) {
  if (!input.applicationId) return
  try {
    const application = await input.prisma.application.findFirst({
      where: { id: input.applicationId, tenantId: input.tenantId },
      select: {
        id: true,
        vacancy: { select: { title: true } },
        assignedToUserId: true,
      },
    })
    if (!application) return

    const recipients = await resolveRecruiterRecipients(input.prisma, {
      tenantId: input.tenantId,
      assignedToUserId: application.assignedToUserId,
    })
    if (recipients.length === 0) return

    const scoreText = input.totalScore === null ? '—' : `${input.totalScore.toFixed(1)}/100`
    await notifyRecruiters(input.prisma, input.env, {
      recipients,
      template: 'selection.verdict_ready',
      payload: {
        applicationId: application.id,
        vacancyTitle: application.vacancy.title,
        totalScore: input.totalScore,
        title: 'Кандидат готов к ревью',
        body: `Кандидат прошёл авто-отбор, итог ${scoreText}, готов к ревью`,
      },
    })
  } catch {
    // best-effort
  }
}

async function resolveRecruiterRecipients(
  prisma: DbClient,
  input: { tenantId: string; assignedToUserId: string | null },
): Promise<RecruiterRecipient[]> {
  if (input.assignedToUserId) {
    return [{ userId: input.assignedToUserId, tenantId: input.tenantId }]
  }
  const roles = await prisma.userRole.findMany({
    where: {
      tenantId: input.tenantId,
      role: { in: [...FALLBACK_RECRUITER_ROLES] },
    },
    select: { userId: true },
  })
  const uniqueUserIds = Array.from(new Set(roles.map((item) => item.userId)))
  return uniqueUserIds.map((userId) => ({ userId, tenantId: input.tenantId }))
}

async function notifyRecruiters(
  prisma: DbClient,
  env: AppEnv,
  input: {
    recipients: RecruiterRecipient[]
    template: string
    payload: Record<string, unknown>
  },
) {
  const notifier = createNotifier(prisma, undefined, { env })
  const channels = buildNotificationChannels(env)
  await Promise.all(
    input.recipients.flatMap((recipient) =>
      channels.map((channel) =>
        notifier.notify({
          channel,
          recipient,
          template: input.template,
          payload: input.payload as Prisma.InputJsonValue,
        }),
      ),
    ),
  )
}

function buildNotificationChannels(env: AppEnv): NotificationChannel[] {
  const channels: NotificationChannel[] = ['in_app']
  if (env.EMAIL_ENABLED) channels.push('email')
  if (env.MOBILE_PUSH_ENABLED) channels.push('push')
  return channels
}
