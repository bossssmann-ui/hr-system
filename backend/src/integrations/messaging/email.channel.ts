/**
 * EmailChannel — outbound only via SMTP (nodemailer-free implementation).
 *
 * Uses Node's `net`/`tls` modules to talk SMTP directly, avoiding a heavy
 * dependency. In CI the transport is injectable, so tests never make live SMTP
 * calls.
 *
 * Inbound email is OUT OF SCOPE for Phase 1E.
 * TODO(phase-1e+): inbound email via IMAP/webhook.
 *
 * Gated by `EMAIL_ENABLED=true` plus `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`.
 */
import net from 'node:net'
import tls from 'node:tls'

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
    try {
      return await sendSmtp(options, sendOptions)
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

async function sendSmtp(
  options: { host: string; port: number; user?: string; pass?: string },
  message: SmtpSendOptions,
) {
  const client = await SmtpClient.connect(options.host, options.port)
  try {
    await client.expect(220)
    const capabilities = await client.command(`EHLO ${smtpDomain()}`, 250)

    if (options.port !== 465 && capabilities.some((line) => line.toUpperCase().includes('STARTTLS'))) {
      await client.command('STARTTLS', 220)
      client.upgradeToTls(options.host)
      await client.command(`EHLO ${smtpDomain()}`, 250)
    }

    if (options.user) {
      await client.command('AUTH LOGIN', 334)
      await client.command(Buffer.from(options.user).toString('base64'), 334)
      await client.command(Buffer.from(options.pass ?? '').toString('base64'), 235)
    }

    const fromAddress = extractEmailAddress(message.from)
    await client.command(`MAIL FROM:<${fromAddress}>`, 250)
    await client.command(`RCPT TO:<${message.to}>`, [250, 251])
    await client.command('DATA', 354)
    await client.writeData(formatSmtpMessage(message))
    await client.command('QUIT', 221)

    return { messageId: createMessageId(fromAddress) }
  } finally {
    client.close()
  }
}

class SmtpClient {
  private buffer = ''
  private pending: Array<(value: string[]) => void> = []

  private constructor(private socket: net.Socket | tls.TLSSocket) {
    this.bindSocket(socket)
  }

  static async connect(host: string, port: number) {
    const socket = port === 465
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port })

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('secureConnect', resolve)
      socket.once('error', reject)
    })

    return new SmtpClient(socket)
  }

  upgradeToTls(host: string) {
    this.socket.removeAllListeners('data')
    this.socket = tls.connect({ socket: this.socket, servername: host })
    this.buffer = ''
    this.pending = []
    this.bindSocket(this.socket)
  }

  async command(command: string, expected: number | number[]) {
    this.socket.write(`${command}\r\n`)
    return this.expect(expected)
  }

  async writeData(data: string) {
    this.socket.write(`${data}\r\n.\r\n`)
    return this.expect(250)
  }

  async expect(expected: number | number[]) {
    const accepted = Array.isArray(expected) ? expected : [expected]
    const lines = await this.readResponse()
    const code = Number(lines.at(-1)?.slice(0, 3))
    if (!accepted.includes(code)) {
      throw new Error(`Unexpected SMTP response ${lines.join(' | ')}`)
    }
    return lines
  }

  close() {
    this.socket.end()
  }

  private bindSocket(socket: net.Socket | tls.TLSSocket) {
    socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8')
      this.flushResponses()
    })
  }

  private readResponse() {
    return new Promise<string[]>((resolve) => {
      this.pending.push(resolve)
      this.flushResponses()
    })
  }

  private flushResponses() {
    while (this.pending.length > 0) {
      const lines = this.buffer.split(/\r?\n/)
      const completeIndex = lines.findIndex((line) => /^\d{3} /.test(line))
      if (completeIndex === -1) return

      const responseLines = lines.slice(0, completeIndex + 1).filter(Boolean)
      this.buffer = lines.slice(completeIndex + 1).join('\n')
      this.pending.shift()?.(responseLines)
    }
  }
}

function formatSmtpMessage(message: SmtpSendOptions) {
  const from = sanitizeHeader(message.from)
  const to = sanitizeHeader(message.to)
  const subject = encodeHeader(message.subject)
  const text = message.text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: ${createMessageId(extractEmailAddress(message.from))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
  ].join('\r\n')
}

function encodeHeader(value: string) {
  const sanitized = sanitizeHeader(value)
  if (/^[\x00-\x7F]*$/.test(sanitized)) return sanitized
  return `=?UTF-8?B?${Buffer.from(sanitized, 'utf8').toString('base64')}?=`
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function extractEmailAddress(value: string) {
  const match = value.match(/<([^>]+)>/)
  return (match?.[1] ?? value).trim()
}

function createMessageId(fromAddress: string) {
  const domain = fromAddress.split('@')[1] || smtpDomain()
  return `<${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`
}

function smtpDomain() {
  return 'career.pacificstar.ru'
}
