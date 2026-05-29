/**
 * Realtime SSE route — Phase 10.
 *
 * `GET /api/realtime/events` opens a long-lived Server-Sent Events stream and
 * forwards events from the in-process realtime bus to the authenticated user.
 *
 * Auth: native `EventSource` cannot set custom headers, so we accept the
 * access token from either the `Authorization: ****** header (used by the
 * `event-source-polyfill` and our own fetch-based readers) or the
 * `?access_token=…` query string. The token is verified the same way as in
 * `requireRole`; if it's missing or invalid we return a JSON error before
 * starting the stream.
 *
 * Keep-alive: every ~25s we write an SSE comment so intermediate proxies
 * (Caddy, browser tabs) don't drop the idle connection. The stream loops
 * until the client disconnects (`stream.aborted`).
 */
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'

import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { errorResponse } from '../../http/errors'
import { verifyAccessToken } from '../../auth/access-tokens'
import { getRealtimeBus, type RealtimeEvent } from '../../services/realtime'

type RouteBindings = {
  Variables: {
    env: AppEnv
    prisma: DbClient
  }
}

const KEEPALIVE_INTERVAL_MS = 25_000

function extractToken(c: Context<RouteBindings>): string | null {
  const auth = c.req.header('Authorization')
  if (auth) {
    const [scheme, token] = auth.split(' ')
    if (scheme?.toLowerCase() === 'bearer' && token) return token.trim() || null
  }
  const qp = c.req.query('access_token')
  return qp && qp.length > 0 ? qp : null
}

export function createRealtimeRoutes() {
  const app = new Hono<RouteBindings>()

  app.get('/events', async (c) => {
    const env = c.get('env')
    const prisma = c.get('prisma')

    if (!env.REALTIME_ENABLED) {
      return c.json(errorResponse('NOT_FOUND', 'Realtime stream is disabled'), 404)
    }

    const token = extractToken(c)
    if (!token) {
      return c.json(errorResponse('UNAUTHORIZED', 'Access token is required'), 401)
    }

    let userId: string
    try {
      const payload = await verifyAccessToken(token, env)
      userId = payload.sub
    } catch {
      return c.json(errorResponse('UNAUTHORIZED', 'Access token is invalid or expired'), 401)
    }

    // Resolve the user's tenant the same way requireRole does (single-tenant
    // Phase 0 assumption). If the user has no memberships, refuse the stream.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { disabledAt: true, roles: { select: { tenantId: true } } },
    })
    if (!user || user.disabledAt || user.roles.length === 0) {
      return c.json(errorResponse('FORBIDDEN', 'User has no tenant memberships'), 403)
    }
    const tenantId = user.roles[0]!.tenantId

    return streamSSE(c, async (stream) => {
      const bus = getRealtimeBus()
      const queue: RealtimeEvent[] = []
      let wake: (() => void) | null = null

      const unsubscribe = bus.subscribe(tenantId, userId, (event) => {
        queue.push(event)
        if (wake) {
          const fn = wake
          wake = null
          fn()
        }
      })

      stream.onAbort(() => {
        unsubscribe()
        if (wake) {
          const fn = wake
          wake = null
          fn()
        }
      })

      // Initial handshake — lets the client confirm the stream is open and
      // emits the protocol-recommended reconnect-retry hint.
      await stream.writeSSE({
        event: 'ready',
        data: JSON.stringify({ tenantId, userId }),
        retry: 5000,
      })

      while (!stream.aborted) {
        if (queue.length > 0) {
          const next = queue.shift()!
          await stream.writeSSE({ data: JSON.stringify(next) })
          continue
        }

        // Wait for the next event OR the keep-alive timeout, whichever
        // happens first. The bus subscriber triggers `wake()` so we don't
        // sleep through new events.
        await new Promise<void>((resolve) => {
          let settled = false
          const done = () => {
            if (settled) return
            settled = true
            resolve()
          }
          wake = done
          stream.sleep(KEEPALIVE_INTERVAL_MS).then(done)
        })

        if (stream.aborted) break
        if (queue.length === 0) {
          await stream.writeSSE({ event: 'ping', data: '' })
        }
      }
    })
  })

  return app
}
