/**
 * Seed script — bootstraps a single tenant + an `owner` user on first run.
 *
 * Idempotent: re-running the script does not duplicate the tenant or the
 * user. Used by `bun run --cwd backend prisma:migrate` (via the
 * `prisma.config.ts` seed hook) and standalone via
 * `bun run --cwd backend prisma:seed`.
 *
 * Reads credentials from environment variables only — no real secrets are
 * committed (see `.env.example`):
 *
 *   BOOTSTRAP_TENANT_NAME      default: "HR-System"
 *   BOOTSTRAP_OWNER_EMAIL      required when running the seed
 *   BOOTSTRAP_OWNER_PASSWORD   required when running the seed (>= 12 chars)
 *   BOOTSTRAP_OWNER_NAME       default: "HR-System Owner"
 *
 * The script intentionally connects with a BYPASSRLS migrator role (the
 * `DATABASE_URL`-credentials role from local dev) so RLS does not block the
 * tenant/owner bootstrap. Production deploys should use the same migrator
 * role for one-shot seeding.
 */

import 'dotenv/config'

import { hashPassword } from '../src/auth/passwords'
import { createPrisma, type DbClient } from '../src/db'

type SeedConfig = {
  tenantName: string
  ownerEmail: string
  ownerPassword: string
  ownerDisplayName: string
}

function readConfig(env: Record<string, string | undefined>): SeedConfig {
  const ownerEmail = env.BOOTSTRAP_OWNER_EMAIL?.trim()
  const ownerPassword = env.BOOTSTRAP_OWNER_PASSWORD?.trim()
  if (!ownerEmail) {
    throw new Error('BOOTSTRAP_OWNER_EMAIL is required to run the seed (see backend/.env.example).')
  }
  if (!ownerPassword || ownerPassword.length < 12) {
    throw new Error(
      'BOOTSTRAP_OWNER_PASSWORD must be at least 12 characters (see backend/.env.example).',
    )
  }
  return {
    tenantName: env.BOOTSTRAP_TENANT_NAME?.trim() || 'HR-System',
    ownerEmail,
    ownerPassword,
    ownerDisplayName: env.BOOTSTRAP_OWNER_NAME?.trim() || 'HR-System Owner',
  }
}

export async function seed(prisma: DbClient, config: SeedConfig): Promise<{
  tenantId: string
  userId: string
  created: { tenant: boolean; user: boolean; ownerRole: boolean }
}> {
  // Tenant: pick the first existing one by created_at to remain idempotent
  // without depending on a stable id. If none exists, create one.
  const existingTenant = await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } })
  const tenant = existingTenant
    ?? (await prisma.tenant.create({ data: { name: config.tenantName } }))

  const existingUser = await prisma.user.findUnique({ where: { email: config.ownerEmail } })
  const user = existingUser
    ?? (await prisma.user.create({
      data: {
        email: config.ownerEmail,
        passwordHash: await hashPassword(config.ownerPassword),
        displayName: config.ownerDisplayName,
      },
    }))

  const ownerRole = await prisma.userRole.upsert({
    where: { userId_role_tenantId: { userId: user.id, role: 'owner', tenantId: tenant.id } },
    update: {},
    create: { userId: user.id, role: 'owner', tenantId: tenant.id },
  })

  return {
    tenantId: tenant.id,
    userId: user.id,
    created: {
      tenant: !existingTenant,
      user: !existingUser,
      // upsert always returns the row; we cannot distinguish "newly created"
      // from "already existed" without a second query. Report `true` only
      // when the user itself is new.
      ownerRole: !existingUser && Boolean(ownerRole),
    },
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.')
  }
  const config = readConfig(process.env)
  const prisma = createPrisma(databaseUrl)
  try {
    const result = await seed(prisma, config)
    console.log(
      JSON.stringify(
        {
          msg: 'seed.completed',
          tenantId: result.tenantId,
          ownerUserId: result.userId,
          created: result.created,
        },
        null,
        2,
      ),
    )
  } finally {
    await prisma.$disconnect()
  }
}

// Bun executes this file directly when invoked via `bun seed.ts`. Guard so
// that importing the module from tests does not run the side-effects.
if (import.meta.main) {
  await main()
}
