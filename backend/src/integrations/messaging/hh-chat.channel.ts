/**
 * HhChatChannel — send messages via HH.ru negotiations thread.
 *
 * Reuses the existing HH client. The `destination` field is the HH
 * `messages_url` from the negotiation object. Gated by the existing
 * `HH_INTEGRATION_ENABLED` feature flag and a live HH connection.
 *
 * Inbound HH chat messages are pulled by extending the existing HH
 * negotiations sync (Phase 1A) to also ingest message threads for linked
 * candidates. See `backend/src/integrations/hh/` for the sync job.
 *
 * TODO(phase-1e+): implement inbound HH message ingestion in the sync job.
 */
import type { MessageChannelAdapter, SendInput, SendResult } from './channel'
import type { HhHttpTransport } from '../hh/client'

type HhChatChannelOptions = {
  accessToken: string
  http?: HhHttpTransport
}

const DEFAULT_TIMEOUT_MS = 10_000

function createFetchTransport(): HhHttpTransport {
  return async (request) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      })
      const body = await response.json().catch(() => null)
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class HhChatChannel implements MessageChannelAdapter {
  readonly channelName = 'hh_chat'
  private readonly accessToken: string
  private readonly http: HhHttpTransport

  constructor(options: HhChatChannelOptions) {
    this.accessToken = options.accessToken
    this.http = options.http ?? createFetchTransport()
  }

  async send(input: SendInput): Promise<SendResult> {
    const messagesUrl = input.destination
    if (!messagesUrl) {
      return { externalId: null, status: 'failed', failureReason: 'No HH messages_url on destination' }
    }

    try {
      const response = await this.http({
        method: 'POST',
        url: messagesUrl,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'hr-system/integration',
          'HH-User-Agent': 'hr-system/integration',
        },
        body: JSON.stringify({ message: input.body }),
      })

      if (response.status < 200 || response.status >= 300) {
        return {
          externalId: null,
          status: 'failed',
          failureReason: `HH API returned ${response.status}`,
        }
      }

      const data = response.body as { id?: string } | null
      return {
        externalId: data?.id ?? null,
        status: 'sent',
      }
    } catch (err) {
      return {
        externalId: null,
        status: 'failed',
        failureReason: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }
}
