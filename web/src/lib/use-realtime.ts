import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeEvent, RealtimeEventType } from '@web-app-demo/contracts'
import { realtimeEventSchema } from '@web-app-demo/contracts'
import { useEffect, useRef } from 'react'

import { useAuth } from './use-auth'

/**
 * Phase 10 — Realtime hook.
 *
 * Opens a Server-Sent Events stream to `/api/realtime/events` for the
 * authenticated session and invalidates TanStack Query caches that are
 * affected by each event so the UI re-renders without a manual refresh.
 *
 * EventSource handles reconnects automatically (the server emits a `retry:`
 * hint on the initial `ready` event). On logout or token refresh the hook
 * tears down and re-opens the connection so the new token is used.
 */
export function useRealtime(): void {
  const { isAuthenticated, api } = useAuth()
  const queryClient = useQueryClient()
  // We keep the latest invalidator in a ref so EventSource doesn't have to
  // restart whenever React Query's `invalidateQueries` identity changes.
  const queryClientRef = useRef(queryClient)
  queryClientRef.current = queryClient

  useEffect(() => {
    if (!isAuthenticated) return
    const url = api.realtimeEventsUrl()
    if (!url || typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return
    }

    const source = new EventSource(url)

    const handle = (event: RealtimeEvent) => {
      const qc = queryClientRef.current
      switch (event.type satisfies RealtimeEventType) {
        case 'notification.new':
          qc.invalidateQueries({ queryKey: ['notifications'] })
          break
        case 'application.stage_changed':
          qc.invalidateQueries({ queryKey: ['applications'] })
          break
        case 'offer.status_changed':
          qc.invalidateQueries({ queryKey: ['offers'] })
          qc.invalidateQueries({ queryKey: ['applications'] })
          break
        case 'checklist.task_updated':
          // Reserved for future onboarding/offboarding checklist publishers.
          qc.invalidateQueries({ queryKey: ['checklist'] })
          qc.invalidateQueries({ queryKey: ['employees'] })
          break
        case 'review.request_submitted':
          // Reserved for the reviews module publisher.
          qc.invalidateQueries({ queryKey: ['reviews'] })
          break
      }
    }

    source.onmessage = (msg) => {
      // `ready` and `ping` events arrive as named events, so we ignore them
      // here — only the default `data` channel carries business events.
      if (!msg.data) return
      try {
        const parsed = realtimeEventSchema.parse(JSON.parse(msg.data))
        handle(parsed)
      } catch {
        // Unknown or future event types — safe to ignore.
      }
    }

    source.onerror = () => {
      // EventSource will auto-reconnect; nothing to do beyond letting it run.
    }

    return () => {
      source.close()
    }
  }, [api, isAuthenticated])
}
