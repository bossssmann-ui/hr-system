/**
 * Phase 0 read-only requisitions routes.
 *
 * Surfaces `GET /api/requisitions` so the web `/requisitions` page can render
 * the seeded owner's view. Mutating routes (create, submit, FSM transitions)
 * land in Phase 0.x alongside the matching forms — they will share this
 * router and the same `requireRole` guard.
 *
 * The Prisma query filters by the caller's tenant. RLS in PostgreSQL is the
 * second line of defence (see `docs/contracts/30-rls-policies.md`); the
 * application code MUST always filter by tenant explicitly.
 */

import type { ListRequisitionsResponse } from '@web-app-demo/contracts'
import { listRequisitionsResponseSchema } from '@web-app-demo/contracts'
import { Hono } from 'hono'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
  }
}

export function createRequisitionsRoutes() {
  const app = new Hono<RouteBindings>()

  app.get('/', requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const roles = c.get('roles')
    const userId = c.get('userId')

    // Hiring managers see only their own requisitions (matches
    // hiring_requisitions_select RLS policy). Owner / hr_admin / recruiter
    // see all requisitions in the tenant.
    const isHiringManagerOnly =
      roles.includes('hiring_manager') &&
      !roles.includes('owner') &&
      !roles.includes('hr_admin') &&
      !roles.includes('recruiter')

    const rows = await prisma.hiringRequisition.findMany({
      where: {
        tenantId,
        ...(isHiringManagerOnly ? { createdByUserId: userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    const body: ListRequisitionsResponse = {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        grade: row.grade,
        salaryMin: row.salaryMin,
        salaryMax: row.salaryMax,
        currency: row.currency,
        status: row.status,
        orgUnitId: row.orgUnitId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    }
    // Defence-in-depth: validate the outgoing shape with the shared schema.
    return c.json(listRequisitionsResponseSchema.parse(body))
  })

  return app
}
