/**
 * Notification Bell — Phase 10.
 *
 * Header dropdown with an unread badge and the 10 most recent in-app
 * notifications. Live-updates via the realtime SSE stream:
 * `useRealtime()` (mounted once in `RootLayout`) invalidates the
 * `['notifications']` query whenever a `notification.new` event arrives.
 *
 * The bell is hidden when the user isn't authenticated.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Notification } from '@web-app-demo/contracts'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/lib/use-auth'

const NOTIFICATIONS_QUERY_KEY = ['notifications', 'recent'] as const

function notificationTitle(n: Notification): string {
  const payload = n.payload ?? {}
  const fromPayload = (payload as Record<string, unknown>)['title']
  if (typeof fromPayload === 'string' && fromPayload.length > 0) return fromPayload
  // Fallback: humanise the template key (e.g. `offer.accepted` → "Offer accepted").
  const [scope, ...rest] = n.template.split('.')
  const label = [scope, ...rest].filter(Boolean).join(' ').replace(/_/g, ' ')
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : n.template
}

function notificationBody(n: Notification): string | null {
  const body = (n.payload as Record<string, unknown>)?.['body']
  return typeof body === 'string' && body.length > 0 ? body : null
}

export function NotificationBell() {
  const { api, isAuthenticated } = useAuth()
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => api.listNotifications({ limit: 10 }),
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
  })

  const markRead = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const markAllRead = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  if (!isAuthenticated) return null

  const unreadCount = data?.unreadCount ?? 0
  const items = data?.items ?? []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          className="relative"
        >
          <span aria-hidden>🔔</span>
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 min-w-5 justify-center rounded-full px-1 text-[10px] leading-none"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-2 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <Typography variant="h6">Notifications</Typography>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            Mark all read
          </Button>
        </div>
        <ul className="max-h-96 overflow-y-auto">
          {items.length === 0 && (
            <li className="px-4 py-6 text-center">
              <Typography variant="body" tone="muted">
                No notifications yet
              </Typography>
            </li>
          )}
          {items.map((n) => {
            const unread = n.readAt === null
            return (
              <li
                key={n.id}
                className={
                  unread
                    ? 'border-b bg-secondary/40 px-4 py-3'
                    : 'border-b px-4 py-3'
                }
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <Typography variant="body" className="font-medium">
                      {notificationTitle(n)}
                    </Typography>
                    {notificationBody(n) && (
                      <Typography variant="body" tone="muted" className="line-clamp-2">
                        {notificationBody(n)}
                      </Typography>
                    )}
                    <Typography variant="caption" tone="muted">
                      {new Date(n.createdAt).toLocaleString()}
                    </Typography>
                  </div>
                  {unread && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => markRead.mutate(n.id)}
                      aria-label="Mark as read"
                    >
                      ✓
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
