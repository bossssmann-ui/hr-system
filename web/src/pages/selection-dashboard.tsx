/**
 * Phase 2 — Selection System HR dashboard.
 *
 * Protected route: /selection/dashboard
 * Lists all selection sessions with verdict, score, and cross-check flags.
 * Clicking a row opens a detail view with full verdict + hr_notes.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'

type CrossCheckFlag = {
  id?: number
  flag_id?: number
  type: 'RED' | 'ORANGE'
  description: string
  impact?: string
  triggeredAt?: number
}

type SelectionItem = {
  id: string
  token: string
  status: string
  role: string
  vacancyId: string
  applicationId: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  verdict: {
    verdict: string
    totalWeightedScore: string | null
    crossCheckFlags: unknown
    createdAt: string
  } | null
}

function verdictBadgeVariant(verdict: string): 'default' | 'outline' | 'secondary' | 'destructive' {
  if (verdict === 'ДОПУСТИТЬ') return 'default'
  if (verdict === 'ОТКЛОНИТЬ') return 'destructive'
  return 'secondary' // НА РУЧНУЮ ПРОВЕРКУ HR
}

function statusBadge(t: TFunction, status: string) {
  const key = `dashboard.status.${status}`
  const translated = t(key)
  return translated === key ? status : translated
}

function roleName(t: TFunction, role: string) {
  if (role === 'logist') return t('dashboard.roles.logistShort')
  if (role === 'sales_manager') return t('dashboard.roles.salesManagerShort')
  return role
}

function parseCrossCheckFlags(raw: unknown): CrossCheckFlag[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (item): item is CrossCheckFlag =>
      typeof item === 'object' && item !== null && ('type' in item),
  )
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

function VerdictDetail({
  session,
  onClose,
  onMoveToInterview,
  onReject,
}: {
  session: SelectionItem
  onClose: () => void
  onMoveToInterview: (applicationId: string) => void
  onReject: (applicationId: string) => void
}) {
  const { api } = useAuth()
  const { t } = useTranslation('selection')
  const verdictQuery = useQuery({
    queryKey: ['selection-verdict', session.id],
    queryFn: () => api.getSelectionVerdict(session.id),
    enabled: Boolean(session.verdict),
  })

  const flags = parseCrossCheckFlags(session.verdict?.crossCheckFlags)
  const redCount = flags.filter((f) => f.type === 'RED').length
  const orangeCount = flags.filter((f) => f.type === 'ORANGE').length

  const fullVerdict = verdictQuery.data

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background shadow-xl">
        <div className="grid gap-4 p-6">
          <div className="flex items-center justify-between">
            <Typography variant="h2">{t('dashboard.detail.title')}</Typography>
            <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
          </div>

          <div className="grid gap-1">
            <Typography variant="bodySm" tone="muted">{t('dashboard.detail.role', { name: roleName(t, session.role) })}</Typography>
            <Typography variant="bodySm" tone="muted">{t('dashboard.detail.status', { name: statusBadge(t, session.status) })}</Typography>
            {session.completedAt && (
              <Typography variant="bodySm" tone="muted">
                {t('dashboard.detail.completed', { date: new Date(session.completedAt).toLocaleString('ru-RU') })}
              </Typography>
            )}
          </div>

          {session.verdict ? (
            <div className="grid gap-3">
              <div className="flex items-center gap-3">
                <Badge variant={verdictBadgeVariant(session.verdict.verdict)}>
                  {session.verdict.verdict}
                </Badge>
                {session.verdict.totalWeightedScore && (
                  <Typography variant="bodySm">
                    {t('dashboard.detail.score', { score: Number(session.verdict.totalWeightedScore).toFixed(1) })}
                  </Typography>
                )}
              </div>

              {/* Cross-check flags */}
              {flags.length > 0 && (
                <div className="grid gap-2">
                  <Typography className="text-sm font-medium">
                    {t('dashboard.detail.flags', { red: redCount, orange: orangeCount })}
                  </Typography>
                  <ul className="grid gap-1">
                    {flags.map((flag, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className={flag.type === 'RED' ? 'text-destructive' : 'text-orange-500'}>
                          ●
                        </span>
                        <span>{flag.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Full verdict detail */}
              {fullVerdict && (
                <>
                  {fullVerdict.verdictReason && (
                    <div className="grid gap-1">
                      <Typography className="text-sm font-medium">{t('dashboard.detail.verdictReason')}</Typography>
                      <Typography variant="bodySm" tone="muted">{fullVerdict.verdictReason}</Typography>
                    </div>
                  )}
                  {fullVerdict.hrNotes && (
                    <div className="grid gap-1">
                      <Typography className="text-sm font-medium">{t('dashboard.detail.hrNotes')}</Typography>
                      <Typography variant="bodySm" tone="muted">{fullVerdict.hrNotes}</Typography>
                    </div>
                  )}
                  {fullVerdict.stageScores && typeof fullVerdict.stageScores === 'object' && (
                    <div className="grid gap-1">
                      <Typography className="text-sm font-medium">{t('dashboard.detail.stageScores')}</Typography>
                      <pre className="rounded-md bg-muted px-3 py-2 text-xs">
                        {JSON.stringify(fullVerdict.stageScores, null, 2)}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <Typography tone="muted">{t('dashboard.detail.verdictNotReady')}</Typography>
          )}

          {/* Action buttons */}
          {session.applicationId && (
            <div className="flex gap-2 border-t pt-3">
              <Button
                size="sm"
                onClick={() => {
                  onMoveToInterview(session.applicationId!)
                  onClose()
                }}
              >
                {t('dashboard.detail.moveToInterview')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onReject(session.applicationId!)
                  onClose()
                }}
              >
                {t('dashboard.detail.reject')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main HR dashboard page ───────────────────────────────────────────────────

export function SelectionDashboardPage() {
  const { api, user } = useAuth()
  const { t } = useTranslation('selection')
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [roleFilter, setRoleFilter] = useState<'logist' | 'sales_manager' | ''>('')
  const [selected, setSelected] = useState<SelectionItem | null>(null)

  const sessionsQuery = useQuery({
    queryKey: ['selection-sessions', page, roleFilter],
    queryFn: () =>
      api.listSelectionSessions({
        page,
        pageSize: 20,
        ...(roleFilter ? { role: roleFilter } : {}),
      }),
    enabled: Boolean(user),
  })

  const moveToInterviewMutation = useMutation({
    mutationFn: (applicationId: string) =>
      api.moveApplicationStage(applicationId, { to: 'tech' }),
    onSuccess: () => {
      toast.success(t('dashboard.toasts.movedToInterview'))
      void queryClient.invalidateQueries({ queryKey: ['selection-sessions'] })
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiRequestError ? error.message : t('dashboard.toasts.moveFailed')),
  })

  const rejectMutation = useMutation({
    mutationFn: (applicationId: string) =>
      api.moveApplicationStage(applicationId, { to: 'rejected' }),
    onSuccess: () => {
      toast.success(t('dashboard.toasts.rejected'))
      void queryClient.invalidateQueries({ queryKey: ['selection-sessions'] })
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiRequestError ? error.message : t('dashboard.toasts.rejectFailed')),
  })

  if (!user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-4 px-5 py-16">
        <Typography variant="h2">{t('dashboard.authRequired')}</Typography>
      </section>
    )
  }

  if (sessionsQuery.isPending) {
    return (
      <section className="mx-auto w-full max-w-6xl px-5 py-12">
        <Typography>{t('dashboard.loading')}</Typography>
      </section>
    )
  }

  if (sessionsQuery.isError) {
    return (
      <section className="mx-auto w-full max-w-6xl px-5 py-12">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.loadFailedTitle')}</CardTitle>
            <CardDescription>{t('dashboard.loadFailedHint')}</CardDescription>
          </CardHeader>
        </Card>
      </section>
    )
  }

  const data = sessionsQuery.data
  const items = data.items

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-2">
        <Badge variant="outline" className="w-fit">{t('dashboard.badge')}</Badge>
        <Typography variant="h1">{t('dashboard.title')}</Typography>
        <Typography tone="muted">
          {t('dashboard.subtitle', { total: data.total })}
        </Typography>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Typography variant="bodySm" tone="muted">{t('dashboard.filterRole')}</Typography>
        <select
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value as typeof roleFilter)
            setPage(1)
          }}
        >
          <option value="">{t('dashboard.allRoles')}</option>
          <option value="logist">{t('dashboard.roles.logist')}</option>
          <option value="sales_manager">{t('dashboard.roles.sales_manager')}</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium">{t('dashboard.columns.candidate')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('dashboard.columns.role')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('dashboard.columns.status')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('dashboard.columns.verdict')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('dashboard.columns.score')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('dashboard.columns.flags')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('dashboard.columns.date')}</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  {t('dashboard.empty')}
                </td>
              </tr>
            )}
            {items.map((item) => {
              const flags = parseCrossCheckFlags(item.verdict?.crossCheckFlags)
              const redCount = flags.filter((f) => f.type === 'RED').length
              const orangeCount = flags.filter((f) => f.type === 'ORANGE').length

              return (
                <tr
                  key={item.id}
                  className="cursor-pointer border-b transition-colors hover:bg-muted/30"
                  onClick={() => setSelected(item)}
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-muted-foreground">
                      {item.id.slice(0, 8)}…
                    </span>
                    {item.applicationId && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        app:{item.applicationId.slice(0, 6)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{roleName(t, item.role)}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{statusBadge(t, item.status)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {item.verdict ? (
                      <Badge variant={verdictBadgeVariant(item.verdict.verdict)}>
                        {item.verdict.verdict}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {item.verdict?.totalWeightedScore
                      ? `${Number(item.verdict.totalWeightedScore).toFixed(1)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {flags.length > 0 ? (
                      <div className="flex items-center gap-1.5">
                        {redCount > 0 && (
                          <span className="text-xs font-medium text-destructive">
                            {redCount}R
                          </span>
                        )}
                        {orangeCount > 0 && (
                          <span className="text-xs font-medium text-orange-500">
                            {orangeCount}O
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleDateString('ru-RU')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data.total > data.pageSize && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t('dashboard.pagination.prev')}
          </Button>
          <Typography variant="bodySm" tone="muted">
            {t('dashboard.pagination.pageOf', { current: page, total: Math.ceil(data.total / data.pageSize) })}
          </Typography>
          <Button
            variant="outline"
            size="sm"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('dashboard.pagination.next')}
          </Button>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <VerdictDetail
          session={selected}
          onClose={() => setSelected(null)}
          onMoveToInterview={(applicationId) => moveToInterviewMutation.mutate(applicationId)}
          onReject={(applicationId) => rejectMutation.mutate(applicationId)}
        />
      )}
    </section>
  )
}
