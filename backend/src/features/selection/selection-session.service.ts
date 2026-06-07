import { Prisma } from '../../generated/prisma/client'

import type { DbClient } from '../../db'
import { buildStagesForRole, isDomesticRole, type SupportedRole } from './selection-role-adapter'

const TERMINAL_SESSION_STATUSES = ['completed', 'rejected', 'expired'] as const

export type CreateSelectionSessionInput = {
  prisma: DbClient
  tenantId: string
  vacancyId: string
  role: SupportedRole
  applicationId?: string | null
}

export async function createSelectionSession(input: CreateSelectionSessionInput) {
  const applicationId = input.applicationId ?? null

  if (applicationId) {
    const existingActive = await input.prisma.selectionSession.findFirst({
      where: {
        tenantId: input.tenantId,
        applicationId,
        status: {
          notIn: [...TERMINAL_SESSION_STATUSES],
        },
      },
    })
    if (existingActive) {
      return { session: existingActive, created: false as const }
    }
  }

  let template = await input.prisma.selectionTemplate.findFirst({
    where: { tenantId: input.tenantId, vacancyId: input.vacancyId, role: input.role },
  })
  if (!template) {
    template = await input.prisma.selectionTemplate.create({
      data: {
        tenantId: input.tenantId,
        vacancyId: input.vacancyId,
        role: input.role,
        stages: buildStagesForRole(input.role) as unknown as Prisma.InputJsonValue,
      },
    })
  }

  try {
    const session = await input.prisma.selectionSession.create({
      data: {
        tenantId: input.tenantId,
        templateId: template.id,
        applicationId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        flags: {} as Prisma.InputJsonValue,
      },
    })
    return { session, created: true as const }
  } catch (error) {
    const prismaCode = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : null
    if (prismaCode === 'P2002' && applicationId) {
      const existingActive = await input.prisma.selectionSession.findFirst({
        where: {
          tenantId: input.tenantId,
          applicationId,
          status: {
            notIn: [...TERMINAL_SESSION_STATUSES],
          },
        },
      })
      if (existingActive) {
        return { session: existingActive, created: false as const }
      }
    }
    throw error
  }
}
