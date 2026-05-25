/**
 * Phase 2 — Selection System HR dashboard.
 *
 * Protected route: /selection/dashboard
 * Lists all selection sessions with verdict, score, and cross-check flags.
 * Clicking a row opens a detail view with full verdict + hr_notes.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
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

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending: 'В ожидании',
    stage_1: 'Этап 1',
    stage_2: 'Этап 2',
    stage_3: 'Этап 3',
    stage_4: 'Этап 4',
    completed: 'Завершён',
    rejected: 'Отклонён',
    expired: 'Истёк',
  }
  return map[status] ?? status
}

function roleName(role: string) {
  return role === 'logist' ? 'Логист' : role === 'sales_manager' ? 'Менеджер продаж' : role
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
            <Typography variant="h2">Детали отбора</Typography>
            <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
          </div>

          <div className="grid gap-1">
            <Typography variant="bodySm" tone="muted">Роль: {roleName(session.role)}</Typography>
            <Typography variant="bodySm" tone="muted">Статус: {statusBadge(session.status)}</Typography>
            {session.completedAt && (
              <Typography variant="bodySm" tone="muted">
                Завершён: {new Date(session.completedAt).toLocaleString('ru-RU')}
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
                    Балл: {Number(session.verdict.totalWeightedScore).toFixed(1)} / 100
                  </Typography>
                )}
              </div>

              {/* Cross-check flags */}
              {flags.length > 0 && (
                <div className="grid gap-2">
                  <Typography className="text-sm font-medium">
                    Флаги ({redCount} RED, {orangeCount} ORANGE)
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
                      <Typography className="text-sm font-medium">Обоснование вердикта</Typography>
                      <Typography variant="bodySm" tone="muted">{fullVerdict.verdictReason}</Typography>
                    </div>
                  )}
                  {fullVerdict.hrNotes && (
                    <div className="grid gap-1">
                      <Typography className="text-sm font-medium">Заметки для HR</Typography>
                      <Typography variant="bodySm" tone="muted">{fullVerdict.hrNotes}</Typography>
                    </div>
                  )}
                  {fullVerdict.stageScores && typeof fullVerdict.stageScores === 'object' && (
                    <div className="grid gap-1">
                      <Typography className="text-sm font-medium">Баллы по этапам</Typography>
                      <pre className="rounded-md bg-muted px-3 py-2 text-xs">
                        {JSON.stringify(fullVerdict.stageScores, null, 2)}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <Typography tone="muted">Вердикт ещё не готов.</Typography>
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
                → Пригласить на интервью
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onReject(session.applicationId!)
                  onClose()
                }}
              >
                Отклонить
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
      toast.success('Кандидат переведён на этап интервью')
      void queryClient.invalidateQueries({ queryKey: ['selection-sessions'] })
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiRequestError ? error.message : 'Ошибка перевода'),
  })

  const rejectMutation = useMutation({
    mutationFn: (applicationId: string) =>
      api.moveApplicationStage(applicationId, { to: 'rejected' }),
    onSuccess: () => {
      toast.success('Кандидат отклонён')
      void queryClient.invalidateQueries({ queryKey: ['selection-sessions'] })
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiRequestError ? error.message : 'Ошибка отклонения'),
  })

  if (!user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-4 px-5 py-16">
        <Typography variant="h2">Требуется авторизация</Typography>
      </section>
    )
  }

  if (sessionsQuery.isPending) {
    return (
      <section className="mx-auto w-full max-w-6xl px-5 py-12">
        <Typography>Загрузка…</Typography>
      </section>
    )
  }

  if (sessionsQuery.isError) {
    return (
      <section className="mx-auto w-full max-w-6xl px-5 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Ошибка загрузки</CardTitle>
            <CardDescription>Не удалось загрузить список сессий отбора.</CardDescription>
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
        <Badge variant="outline" className="w-fit">HR-панель</Badge>
        <Typography variant="h1">Система отбора кандидатов</Typography>
        <Typography tone="muted">
          Автоматический 4-этапный скрининг. Всего: {data.total}
        </Typography>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Typography variant="bodySm" tone="muted">Роль:</Typography>
        <select
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value as typeof roleFilter)
            setPage(1)
          }}
        >
          <option value="">Все</option>
          <option value="logist">Логист-экспедитор</option>
          <option value="sales_manager">Менеджер по продажам ТЭУ</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Кандидат / Сессия</th>
              <th className="px-4 py-3 text-left font-medium">Роль</th>
              <th className="px-4 py-3 text-left font-medium">Статус</th>
              <th className="px-4 py-3 text-left font-medium">Вердикт</th>
              <th className="px-4 py-3 text-left font-medium">Балл</th>
              <th className="px-4 py-3 text-left font-medium">Флаги</th>
              <th className="px-4 py-3 text-left font-medium">Дата</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Нет сессий отбора
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
                  <td className="px-4 py-3">{roleName(item.role)}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{statusBadge(item.status)}</Badge>
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
            ← Назад
          </Button>
          <Typography variant="bodySm" tone="muted">
            Страница {page} из {Math.ceil(data.total / data.pageSize)}
          </Typography>
          <Button
            variant="outline"
            size="sm"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Далее →
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
