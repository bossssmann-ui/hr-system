/**
 * Expo Push API client — Phase 11.
 *
 * Thin wrapper around the Expo Push HTTP API:
 *   https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * Behaviour:
 *   - Batches up to 100 messages per request (Expo's documented limit).
 *   - Returns `{ ok, invalidTokens }` so the caller (the Notifier) can
 *     deactivate tokens for `DeviceNotRegistered` errors.
 *   - Never throws; all transport / HTTP errors are translated into a
 *     non-ok result. The Notifier treats this as a best-effort delivery.
 *
 * The HTTP fetch is injectable so unit tests can stub the network.
 */

export type ExpoPushMessage = {
  to: string
  title?: string
  body?: string
  data?: Record<string, unknown>
}

export type ExpoPushResult = {
  ok: boolean
  invalidTokens: string[]
}

type ExpoTicket = {
  status?: 'ok' | 'error'
  message?: string
  details?: { error?: string }
}

type ExpoResponse = {
  data?: ExpoTicket[]
}

export type ExpoPushClient = {
  send(messages: ExpoPushMessage[]): Promise<ExpoPushResult>
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>

export type CreateExpoPushClientOptions = {
  apiUrl: string
  fetchImpl?: FetchLike
}

const BATCH_SIZE = 100

export function createExpoPushClient({
  apiUrl,
  fetchImpl = fetch as unknown as FetchLike,
}: CreateExpoPushClientOptions): ExpoPushClient {
  return {
    async send(messages) {
      if (messages.length === 0) {
        return { ok: true, invalidTokens: [] }
      }

      const invalidTokens: string[] = []
      let allOk = true

      for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        const batch = messages.slice(i, i + BATCH_SIZE)
        try {
          const response = await fetchImpl(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'Accept-Encoding': 'gzip, deflate',
            },
            body: JSON.stringify(batch),
          })

          if (!response.ok) {
            allOk = false
            continue
          }

          const json = (await response.json()) as ExpoResponse
          const tickets = json.data ?? []
          for (let j = 0; j < tickets.length; j += 1) {
            const ticket = tickets[j]
            if (ticket?.status === 'error') {
              allOk = false
              if (ticket.details?.error === 'DeviceNotRegistered') {
                const token = batch[j]?.to
                if (token) invalidTokens.push(token)
              }
            }
          }
        } catch {
          allOk = false
        }
      }

      return { ok: allOk, invalidTokens }
    },
  }
}
