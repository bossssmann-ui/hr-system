/**
 * Phase 2 — Selection System HR dashboard.
 * Phase 16 — Extended for logist_domestic role.
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

type SpecializationAssignment = {
  packageId: string
  level: 'primary' | 'secondary' | 'mentioned_only' | 'contradicted'
}

type DomesticStageScores = {
  resumeAndInterviewScore?: number
  coreOperationsScore?: number
  primarySpecScore?: number
  secondarySpecScore?: number
  practicalAssignmentScore?: number
  communicationScore?: number
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
  specializations?: SpecializationAssignment[]
  assessmentProfile?: {
    signals?: string[]
    riskFlags?: string[]
  }
}

function verdictBadgeVariant(verdict: string): 'default' | 'outline' | 'secondary' | 'destructive' {
  if (verdict === 'ДОПУСТИТЬ') return 'default'
  if (verdict === 'ОТКЛОНИТЬ') return 'destructive'
  return 'secondary' // НА РУЧНУЮ ПРОВЕРКУ HR
}

function statusBadge(t: TFunction<'selection'>, status: string) {
  const key = `dashboard.status.${status}`
  const translated = t(key, { defaultValue: status })
  return translated
}

function roleName(t: TFunction<'selection'>, role: string) {
  if (role === 'logist') return t('dashboard.roles.logistShort')
  if (role === 'sales_manager') return t('dashboard.roles.salesManagerShort')
  if (role === 'logist_domestic') return 'Логист (РФ)'
  return role
}

// ─── Domestic helpers ─────────────────────────────────────────────────────────

function packageName(packageId: string): string {
  const names: Record<string, string> = {
    domestic_core_operations: 'Базовые операции',
    domestic_road_ftl_ltl: 'Авто FTL/LTL',
    domestic_distribution: 'Развозка',
    domestic_rail_container: 'ЖД и контейнеры',
    domestic_oversized_heavy: 'Негабарит',
    domestic_remote_regions: 'Труднодоступные регионы',
    domestic_cabotage: 'Каботаж',
  }
  return names[packageId] ?? packageId
}

function levelName(level: string): string {
  const levels: Record<string, string> = {
    primary: 'Основной',
    secondary: 'Дополнительный',
    mentioned_only: 'Упомянут',
    contradicted: '⚠ Противоречие',
  }
  return levels[level] ?? level
}

function domesticVerdictVariant(verdict: string): 'default' | 'outline' | 'secondary' | 'destructive' {
  if (verdict === 'STRONG_CANDIDATE' || verdict === 'ADMIT_TO_INTERVIEW') return 'default'
  if (verdict === 'REJECT' || verdict === 'AUTO_REJECT') return 'destructive'
  if (verdict === 'MANUAL_REVIEW_HR' || verdict === 'MANUAL_EXCEPTION_ONLY') return 'secondary'
  return 'outline'
}

function domesticVerdictLabel(verdict: string): string {
  const labels: Record<string, string> = {
    STRONG_CANDIDATE: '⭐ Сильный кандидат',
    ADMIT_TO_INTERVIEW: '✓ Допустить',
    MANUAL_EXCEPTION_ONLY: '⚡ Ручное исключение',
    REJECT: '✕ Отклонить',
    MANUAL_REVIEW_HR: '🔍 Ручная проверка',
    AUTO_REJECT: '✕ Авто-отказ',
  }
  return labels[verdict] ?? verdict
}

function generateRecruiterQuestions(riskFlags: string[], _specializations: SpecializationAssignment[]): string[] {
  const questions: string[] = [
    'Назовите последний рейс который вы вели от заявки до закрывающих документов.',
    'Что именно было вашей зоной ответственности?',
  ]
  if (riskFlags.includes('oversized_depth_risk')) {
    questions.push('Назовите реальные габариты и вес негабаритного груза который вы перевозили.')
    questions.push('Кто оформлял разрешения и как вы контролировали готовность?')
  }
  if (riskFlags.includes('remote_region_depth_risk')) {
    questions.push('Какие труднодоступные направления вы реально вели?')
    questions.push('Как проверяли сезонность и доступность маршрута?')
  }
  if (riskFlags.includes('cabotage_depth_risk')) {
    questions.push('С какими портами и линиями вы реально работали?')
    questions.push('Как организовывали вывоз из порта?')
  }
  return questions
}

function parseSpecializations(raw: unknown): SpecializationAssignment[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const validLevels: ReadonlyArray<SpecializationAssignment['level']> = [
    'primary',
    'secondary',
    'mentioned_only',
    'contradicted',
  ]
  return raw.filter(
    (item): item is SpecializationAssignment =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { packageId?: unknown }).packageId === 'string' &&
      validLevels.includes((item as { level?: unknown }).level as SpecializationAssignment['level']),
  )
}

function parseAssessmentProfile(raw: unknown): { signals: string[]; riskFlags: string[] } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const obj = raw as Record<string, unknown>
  const signals = Array.isArray(obj.signals) ? obj.signals.filter((x): x is string => typeof x === 'string') : []
  const riskFlags = Array.isArray(obj.riskFlags)
    ? obj.riskFlags.filter((x): x is string => typeof x === 'string')
    : []
  if (signals.length === 0 && riskFlags.length === 0) return undefined
  return { signals, riskFlags }
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
  const isDomestic = session.role === 'logist_domestic'

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
              {fullVerdict != null && (
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
                  {!isDomestic && Boolean(fullVerdict.stageScores) && typeof fullVerdict.stageScores === 'object' && (
                    <div className="grid gap-1">
                      <Typography className="text-sm font-medium">{t('dashboard.detail.stageScores')}</Typography>
                      <pre className="rounded-md bg-muted px-3 py-2 text-xs">
                        {JSON.stringify(fullVerdict.stageScores, null, 2)}
                      </pre>
                    </div>
                  )}
                </>
              )}

              {/* Domestic: Specializations */}
              {isDomestic && session.specializations && session.specializations.length > 0 && (
                <div className="grid gap-2">
                  <Typography className="text-sm font-medium">Специализации</Typography>
                  <ul className="grid gap-1">
                    {session.specializations.map((spec) => (
                      <li key={spec.packageId} className="flex items-center justify-between text-sm">
                        <span>{packageName(spec.packageId)}</span>
                        <Badge variant={spec.level === 'contradicted' ? 'destructive' : 'outline'} className="text-xs">
                          {levelName(spec.level)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Domestic: Module scores */}
              {isDomestic && Boolean(fullVerdict?.stageScores) && typeof fullVerdict?.stageScores === 'object' &&
                fullVerdict?.stageScores != null && 'resumeAndInterviewScore' in (fullVerdict.stageScores as object) && (
                <div className="grid gap-2">
                  <Typography className="text-sm font-medium">Баллы по модулям</Typography>
                  <div className="grid gap-1 text-sm">
                    {Object.entries(fullVerdict.stageScores as DomesticStageScores).map(([key, val]) =>
                      val !== undefined ? (
                        <div key={key} className="flex justify-between">
                          <span className="text-muted-foreground">{key}</span>
                          <span className="font-medium">{typeof val === 'number' ? val.toFixed(1) : String(val)}</span>
                        </div>
                      ) : null
                    )}
                  </div>
                </div>
              )}

              {/* Domestic: Verdict badge */}
              {isDomestic && session.verdict && (
                <div className="flex items-center gap-2">
                  <Typography className="text-sm font-medium">Domestic вердикт:</Typography>
                  <Badge variant={domesticVerdictVariant(session.verdict.verdict)}>
                    {domesticVerdictLabel(session.verdict.verdict)}
                  </Badge>
                </div>
              )}

              {/* Domestic: Recruiter questions */}
              {isDomestic && (
                <div className="grid gap-2 rounded-md border border-dashed p-3">
                  <Typography className="text-sm font-medium">📋 Вопросы для рекрутера</Typography>
                  <ol className="grid gap-1 pl-4">
                    {generateRecruiterQuestions(
                      session.assessmentProfile?.riskFlags ?? [],
                      session.specializations ?? []
                    ).map((q, i) => (
                      <li key={i} className="text-sm text-muted-foreground">{i + 1}. {q}</li>
                    ))}
                  </ol>
                </div>
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
  const [roleFilter, setRoleFilter] = useState<'logist' | 'sales_manager' | 'logist_domestic' | ''>('')
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
          <option value="logist_domestic">Логист (РФ)</option>
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
                  onClick={() =>
                    setSelected({
                      ...item,
                      specializations: parseSpecializations(item.specializations),
                      assessmentProfile: parseAssessmentProfile(item.assessmentProfile),
                    })
                  }
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
