import type {
  LoginRequest,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  RegisterPayload,
  RoleName,
  UserDto,
} from '@web-app-demo/contracts'
import { createHash, randomBytes } from 'node:crypto'

import type { DbClient } from '../db'
import type { AppEnv } from '../env'
import { AppError } from '../http/errors'
import { Prisma } from '../generated/prisma/client'
import { EmailChannel, type SmtpTransport } from '../integrations/messaging/email.channel'
import { signAccessToken, verifyAccessToken } from './access-tokens'
import { hashPassword, verifyPassword } from './passwords'
import { createRefreshToken, hashRefreshToken } from './refresh-tokens'

type SessionMetadata = {
  userAgent?: string
  ipAddress?: string
}

type AuthServiceOptions = {
  passwordResetEmailTransport?: SmtpTransport
}

type UserRecord = {
  id: string
  email: string
  displayName: string | null
  createdAt: Date
  disabledAt: Date | null
}

export class AuthService {
  constructor(
    private readonly db: DbClient,
    private readonly env: AppEnv,
    private readonly options: AuthServiceOptions = {},
  ) {}

  async register(input: RegisterPayload, metadata: SessionMetadata) {
    const existingUser = await this.db.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    })

    if (existingUser) {
      throw new AppError(409, 'CONFLICT', 'User with this email already exists')
    }

    const passwordHash = await hashPassword(input.password)

    const user = await this.db.user
      .create({
        data: {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
        },
      })
      .catch((error: unknown) => {
        if (isUniqueConstraintError(error)) {
          throw new AppError(409, 'CONFLICT', 'User with this email already exists')
        }

        throw error
      })

    return this.issueSession(user, metadata)
  }

  async login(input: LoginRequest, metadata: SessionMetadata) {
    const user = await this.db.user.findUnique({
      where: { email: input.email },
    })

    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid email or password')
    }

    if (user.disabledAt) {
      throw new AppError(403, 'FORBIDDEN', 'Account disabled')
    }

    const passwordMatches = await verifyPassword(input.password, user.passwordHash)
    if (!passwordMatches) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid email or password')
    }

    return this.issueSession(user, metadata)
  }

  async requestPasswordReset(input: PasswordResetRequest, metadata: SessionMetadata) {
    const user = await this.db.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        email: true,
        disabledAt: true,
      },
    })

    if (!user || user.disabledAt) {
      return { ok: true as const }
    }

    const now = new Date()
    const token = createPasswordResetToken()
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000)

    await this.db.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
          expiresAt: {
            gt: now,
          },
        },
        data: {
          usedAt: now,
        },
      })

      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashPasswordResetToken(token),
          expiresAt,
          userAgent: metadata.userAgent,
          ipAddress: metadata.ipAddress,
        },
      })
    })

    const resetUrl = this.passwordResetUrl(token)
    const delivery = await this.sendPasswordResetEmail(user.email, resetUrl, expiresAt)
    this.logPasswordResetLink(user.email, resetUrl, expiresAt, delivery)

    return { ok: true as const }
  }

  async resetPassword(input: PasswordResetConfirmRequest) {
    const tokenHash = hashPasswordResetToken(input.token)
    const now = new Date()
    const resetToken = await this.db.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    })

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= now) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Password reset link is invalid or expired')
    }

    if (resetToken.user.disabledAt) {
      throw new AppError(403, 'FORBIDDEN', 'Account disabled')
    }

    const passwordHash = await hashPassword(input.password)

    await this.db.$transaction(async (tx) => {
      const consumeResult = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: {
            gt: now,
          },
        },
        data: {
          usedAt: now,
        },
      })

      if (consumeResult.count !== 1) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Password reset link is invalid or expired')
      }

      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      })

      await tx.authSession.updateMany({
        where: {
          userId: resetToken.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      })
    })

    return { ok: true as const }
  }

  async refresh(refreshToken: string | undefined, metadata: SessionMetadata) {
    if (!refreshToken) {
      throw new AppError(401, 'UNAUTHORIZED', 'Refresh token is required')
    }

    const refreshTokenHash = hashRefreshToken(refreshToken)
    const now = new Date()
    const currentSession = await this.db.authSession.findFirst({
      where: {
        refreshTokenHash,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      include: {
        user: true,
      },
    })

    if (!currentSession) {
      throw new AppError(401, 'UNAUTHORIZED', 'Refresh session is invalid or expired')
    }

    if (currentSession.user.disabledAt) {
      throw new AppError(403, 'FORBIDDEN', 'Account disabled')
    }

    const nextRefreshToken = createRefreshToken()
    const nextRefreshTokenHash = hashRefreshToken(nextRefreshToken)
    const expiresAt = this.refreshExpiresAt()

    const nextSession = await this.db.$transaction(async (tx) => {
      const revokeResult = await tx.authSession.updateMany({
        where: {
          id: currentSession.id,
          revokedAt: null,
          expiresAt: {
            gt: now,
          },
        },
        data: { revokedAt: now },
      })

      if (revokeResult.count !== 1) {
        throw new AppError(401, 'UNAUTHORIZED', 'Refresh session is invalid or expired')
      }

      return tx.authSession.create({
        data: {
          userId: currentSession.userId,
          refreshTokenHash: nextRefreshTokenHash,
          expiresAt,
          userAgent: metadata.userAgent,
          ipAddress: metadata.ipAddress,
        },
      })
    })

    const accessToken = await signAccessToken(
      {
        sub: currentSession.user.id,
        email: currentSession.user.email,
        sessionId: nextSession.id,
      },
      this.env,
    )

    return {
      accessToken,
      refreshToken: nextRefreshToken,
    }
  }

  async getMe(accessToken: string | undefined) {
    if (!accessToken) {
      throw new AppError(401, 'UNAUTHORIZED', 'Access token is required')
    }

    const payload = await verifyAccessToken(accessToken, this.env).catch(() => {
      throw new AppError(401, 'UNAUTHORIZED', 'Access token is invalid or expired')
    })

    const session = await this.db.authSession.findFirst({
      where: {
        id: payload.sessionId,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: true,
      },
    })

    if (!session) {
      throw new AppError(401, 'UNAUTHORIZED', 'Session is invalid or expired')
    }

    if (session.user.disabledAt) {
      throw new AppError(403, 'FORBIDDEN', 'Account disabled')
    }

    return {
      user: toUserDto(session.user, await this.loadRoles(session.user.id)),
    }
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return

    await this.db.authSession.updateMany({
      where: {
        refreshTokenHash: hashRefreshToken(refreshToken),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    })
  }

  private async issueSession(user: UserRecord, metadata: SessionMetadata) {
    if (user.disabledAt) {
      throw new AppError(403, 'FORBIDDEN', 'Account disabled')
    }

    const refreshToken = createRefreshToken()
    const session = await this.db.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt: this.refreshExpiresAt(),
        userAgent: metadata.userAgent,
        ipAddress: metadata.ipAddress,
      },
    })

    const accessToken = await signAccessToken(
      {
        sub: user.id,
        email: user.email,
        sessionId: session.id,
      },
      this.env,
    )

    return {
      user: toUserDto(user, await this.loadRoles(user.id)),
      accessToken,
      refreshToken,
    }
  }

  private async loadRoles(userId: string): Promise<RoleName[]> {
    const rows = await this.db.userRole.findMany({
      where: { userId },
      select: { role: true },
    })
    // Dedupe across tenants — the frontend gates UI on union of roles.
    const uniq = new Set<RoleName>(rows.map((r) => r.role as RoleName))
    return Array.from(uniq)
  }

  private refreshExpiresAt() {
    return new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
  }

  private passwordResetUrl(token: string) {
    const origin = this.env.CORS_ORIGINS[0] ?? 'http://localhost:5173'
    const url = new URL('/reset-password', origin)
    url.searchParams.set('token', token)
    return url.toString()
  }

  private async sendPasswordResetEmail(email: string, resetUrl: string, expiresAt: Date) {
    if (!this.env.EMAIL_ENABLED || !this.env.SMTP_HOST || !this.env.SMTP_PORT || !this.env.SMTP_FROM) {
      return { status: 'log' as const }
    }

    const channel = new EmailChannel({
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      from: this.env.SMTP_FROM,
      user: this.env.SMTP_USER,
      pass: this.env.SMTP_PASS,
      transport: this.options.passwordResetEmailTransport,
    })

    const result = await channel.send({
      destination: email,
      subject: 'Восстановление пароля Onboardix',
      body: [
        'Здравствуйте.',
        '',
        'Для смены пароля перейдите по ссылке:',
        resetUrl,
        '',
        `Ссылка действует до ${expiresAt.toISOString()}.`,
        '',
        'Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.',
      ].join('\n'),
    })

    if (result.status === 'sent') {
      return { status: 'email' as const, messageId: result.externalId }
    }

    return { status: 'failed' as const, failureReason: result.failureReason }
  }

  private logPasswordResetLink(
    email: string,
    resetUrl: string,
    expiresAt: Date,
    delivery: { status: 'email'; messageId: string | null } | { status: 'failed'; failureReason?: string } | { status: 'log' },
  ) {
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'auth.password_reset_link',
        email,
        resetUrl,
        expiresAt: expiresAt.toISOString(),
        delivery,
      }),
    )
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function createPasswordResetToken() {
  return randomBytes(32).toString('base64url')
}

function hashPasswordResetToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function toUserDto(user: UserRecord, roles: RoleName[] = []): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roles,
    createdAt: user.createdAt.toISOString(),
  }
}
