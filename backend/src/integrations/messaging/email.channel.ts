/**
 * EmailChannel — outbound only via SMTP (nodemailer-free implementation).
 *
 * Uses Node's `net` module to talk SMTP directly, avoiding a heavy dependency.
 * In Phase 1E we use the `nodemailer` package pattern but stub it out so CI
 * never makes live SMTP calls (the transport is injectable).
 *
 * Inbound email is OUT OF SCOPE for Phase 1E.
 * TODO(phase-1e+): inbound email via IMAP/webhook.
 *
 * Gated by `EMAIL_ENABLED=true` plus `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`.
 */
import type { MessageChannelAdapter, SendInput, SendResult } from './channel'

export type SmtpTransport = (options: SmtpSendOptions) => Promise<{ messageId: string | null }>

export type SmtpSendOptions = {
  from: string
  to: string
  subject: string
  text: string
}

type EmailChannelOptions = {
  host: string
  port: number
  from: string
  user?: string
  pass?: string
  transport?: SmtpTransport
}

export function createSmtpTransport(options: { host: string; port: number; user?: string; pass?: string }): SmtpTransport {
  return async (sendOptions) => {
    // nodemailer must be installed separately when EMAIL_ENABLED=true in production.
    // In CI the transport is injected as a mock, so this path is never reached.
    // TODO(phase-1e+): add nodemailer to package.json when deploying email.
    //   npm install nodemailer && npm install -D @types/nodemailer
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodemailer = (await import('nodemailer' as string)) as {
        createTransport: (opts: unknown) => {
          sendMail: (msg: unknown) => Promise<{ messageId?: string }>
        }
      }
      const transporter = nodemailer.createTransport({
        host: options.host,
        port: options.port,
        secure: options.port === 465,
        auth: options.user ? { user: options.user, pass: options.pass } : undefined,
      })
      const info = await transporter.sendMail({
        from: sendOptions.from,
        to: sendOptions.to,
        subject: sendOptions.subject,
        text: sendOptions.text,
      })
      return { messageId: info.messageId ?? null }
    } catch (err) {
      throw new Error(`SMTP send failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export class EmailChannel implements MessageChannelAdapter {
  readonly channelName = 'email'
  private readonly from: string
  private readonly transport: SmtpTransport

  constructor(options: EmailChannelOptions) {
    this.from = options.from
    this.transport =
      options.transport ??
      createSmtpTransport({
        host: options.host,
        port: options.port,
        user: options.user,
        pass: options.pass,
      })
  }

  async send(input: SendInput): Promise<SendResult> {
    const to = input.destination
    if (!to) {
      return { externalId: null, status: 'failed', failureReason: 'No email address on candidate' }
    }

    try {
      const result = await this.transport({
        from: this.from,
        to,
        subject: input.subject ?? '(no subject)',
        text: input.body,
      })
      return { externalId: result.messageId, status: 'sent' }
    } catch (err) {
      return {
        externalId: null,
        status: 'failed',
        failureReason: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }
}
