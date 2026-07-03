/**
 * Horizon 8 — Engagement / eNPS page.
 *
 * Tabs: Surveys (HR admin) | Results | Respond (employee)
 * Route: /engagement
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type {
  EngagementSurvey,
  EnpsResult,
} from '@web-app-demo/contracts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'

// ─── Root ─────────────────────────────────────────────────────────────────────

export function EngagementPage() {
  const { user } = useAuth()
  const { t } = useTranslation('engagement')

  if (!user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-3 px-5 py-12">
        <h1>{t('title')}</h1>
        <p>{t('signInPrompt')}</p>
      </section>
    )
  }

  return <EngagementContent />
}

// ─── Main content ─────────────────────────────────────────────────────────────

function EngagementContent() {
  const { t } = useTranslation('engagement')
  const [tab, setTab] = useState('surveys')

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-12">
      <h1 className="mb-6 text-2xl font-semibold">{t('title')}</h1>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="surveys">{t('tabs.surveys')}</TabsTrigger>
          <TabsTrigger value="results">{t('tabs.results')}</TabsTrigger>
          <TabsTrigger value="respond">{t('tabs.respond')}</TabsTrigger>
        </TabsList>

        <TabsContent value="surveys" className="mt-6">
          <SurveysTab />
        </TabsContent>
        <TabsContent value="results" className="mt-6">
          <ResultsTab />
        </TabsContent>
        <TabsContent value="respond" className="mt-6">
          <RespondTab />
        </TabsContent>
      </Tabs>
    </section>
  )
}

// ─── Surveys Tab ──────────────────────────────────────────────────────────────

function SurveysTab() {
  const { api } = useAuth()
  const { t } = useTranslation('engagement')
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    title: '',
    kind: 'enps' as 'enps' | 'pulse',
    question: '',
    closesAt: '',
  })

  const query = useQuery({
    queryKey: ['engagement', 'surveys'],
    queryFn: () => api.listSurveys(),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.createSurvey({
        title: createForm.title,
        kind: createForm.kind,
        question: createForm.question,
        closesAt: createForm.closesAt ? new Date(createForm.closesAt).toISOString() : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['engagement', 'surveys'] })
      setCreateOpen(false)
      setCreateForm({ title: '', kind: 'enps', question: '', closesAt: '' })
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const openMutation = useMutation({
    mutationFn: (id: string) => api.openSurvey(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['engagement', 'surveys'] })
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const closeMutation = useMutation({
    mutationFn: (id: string) => api.closeSurvey(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['engagement', 'surveys'] })
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const surveys = query.data?.items ?? []

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('surveys.title')}</h2>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">{t('actions.create')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('create.title')}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm">
                {t('create.titleLabel')}
                <Input
                  value={createForm.title}
                  onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('create.kindLabel')}
                <select
                  className="rounded border px-2 py-1 text-sm"
                  value={createForm.kind}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      kind: e.target.value as 'enps' | 'pulse',
                    }))
                  }
                >
                  <option value="enps">{t('surveys.kind.enps')}</option>
                  <option value="pulse">{t('surveys.kind.pulse')}</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                {t('create.questionLabel')}
                <Input
                  value={createForm.question}
                  onChange={(e) => setCreateForm((f) => ({ ...f, question: e.target.value }))}
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('create.closesAtLabel')}
                <Input
                  type="datetime-local"
                  value={createForm.closesAt}
                  onChange={(e) => setCreateForm((f) => ({ ...f, closesAt: e.target.value }))}
                />
              </label>
              <Button
                disabled={
                  !createForm.title || !createForm.question || createMutation.isPending
                }
                onClick={() => createMutation.mutate()}
              >
                {t('actions.save')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {query.isLoading ? (
        <p>{t('loading')}</p>
      ) : query.isError ? (
        <p style={{ color: 'crimson' }}>{t('loadFailed')}</p>
      ) : surveys.length === 0 ? (
        <p>{t('surveys.empty')}</p>
      ) : (
        <div className="grid gap-3">
          {surveys.map((survey) => (
            <SurveyCard
              key={survey.id}
              survey={survey}
              onOpen={() => openMutation.mutate(survey.id)}
              onClose={() => closeMutation.mutate(survey.id)}
              isActioning={openMutation.isPending || closeMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

type SurveyCardProps = {
  survey: EngagementSurvey
  onOpen: () => void
  onClose: () => void
  isActioning: boolean
}

function SurveyCard({ survey, onOpen, onClose, isActioning }: SurveyCardProps) {
  const { t } = useTranslation('engagement')

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{survey.title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{survey.question}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline">
              {t(`surveys.kind.${survey.kind}`)}
            </Badge>
            <Badge variant={survey.status === 'open' ? 'default' : 'secondary'}>
              {t(`surveys.status.${survey.status}`)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {survey.closesAt && (
              <span>
                {t('surveys.closesAt')}: {new Date(survey.closesAt).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {survey.status === 'draft' && (
              <Button size="sm" variant="outline" disabled={isActioning} onClick={onOpen}>
                {t('actions.open')}
              </Button>
            )}
            {survey.status === 'open' && (
              <Button size="sm" variant="outline" disabled={isActioning} onClick={onClose}>
                {t('actions.close')}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Results Tab ──────────────────────────────────────────────────────────────

function ResultsTab() {
  const { api } = useAuth()
  const { t } = useTranslation('engagement')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const surveysQuery = useQuery({
    queryKey: ['engagement', 'surveys'],
    queryFn: () => api.listSurveys(),
  })

  const resultsQuery = useQuery({
    queryKey: ['engagement', 'results', selectedId],
    queryFn: () => api.getSurveyResults(selectedId!),
    enabled: !!selectedId,
  })

  const surveys = surveysQuery.data?.items ?? []

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <label className="text-sm font-medium">{t('results.title')}</label>
        {surveysQuery.isLoading ? (
          <p>{t('loading')}</p>
        ) : (
          <select
            className="rounded border px-2 py-1 text-sm"
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value || null)}
          >
            <option value="">{t('actions.selectSurvey')}</option>
            {surveys.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({t(`surveys.status.${s.status}`)})
              </option>
            ))}
          </select>
        )}
      </div>

      {!selectedId ? (
        <p className="text-muted-foreground">{t('results.noSurveySelected')}</p>
      ) : resultsQuery.isLoading ? (
        <p>{t('loading')}</p>
      ) : resultsQuery.isError ? (
        <p style={{ color: 'crimson' }}>{t('loadFailed')}</p>
      ) : resultsQuery.data ? (
        <EnpsResultsDisplay data={resultsQuery.data} />
      ) : null}
    </div>
  )
}

type EnpsResultsDisplayProps = {
  data: EnpsResult & { comments: string[] }
}

export function EnpsResultsDisplay({ data }: EnpsResultsDisplayProps) {
  const { t } = useTranslation('engagement')

  const total = data.responded
  const promoterPct = total > 0 ? Math.round((data.promoters / total) * 100) : 0
  const passivePct = total > 0 ? Math.round((data.passives / total) * 100) : 0
  const detractorPct = total > 0 ? Math.round((data.detractors / total) * 100) : 0

  const scoreColor =
    data.score >= 30 ? '#16a34a' : data.score >= 0 ? '#ca8a04' : '#dc2626'

  return (
    <div className="grid gap-6">
      {/* eNPS score */}
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-sm font-medium text-muted-foreground">{t('results.score')}</p>
            <p
              className="text-7xl font-bold tabular-nums"
              style={{ color: scoreColor }}
              data-testid="enps-score"
            >
              {data.score > 0 ? `+${data.score}` : data.score}
            </p>
            <p className="text-xs text-muted-foreground">{t('results.scoreRange')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('results.responses', { responded: data.responded, total: data.total })}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Groups */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('results.groups')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <GroupBar
              label={t('results.promoters')}
              count={data.promoters}
              pct={promoterPct}
              color="#16a34a"
              testId="promoters-count"
            />
            <GroupBar
              label={t('results.passives')}
              count={data.passives}
              pct={passivePct}
              color="#ca8a04"
              testId="passives-count"
            />
            <GroupBar
              label={t('results.detractors')}
              count={data.detractors}
              pct={detractorPct}
              color="#dc2626"
              testId="detractors-count"
            />
          </div>
        </CardContent>
      </Card>

      {/* Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('results.distribution')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ScoreDistribution distribution={data.distribution} total={total} />
        </CardContent>
      </Card>

      {/* Comments */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('results.comments')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('results.noComments')}</p>
          ) : (
            <ul className="grid gap-2">
              {data.comments.map((c, i) => (
                <li key={i} className="rounded border px-3 py-2 text-sm">
                  {c}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

type GroupBarProps = {
  label: string
  count: number
  pct: number
  color: string
  testId?: string
}

function GroupBar({ label, count, pct, color, testId }: GroupBarProps) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span data-testid={testId}>
          {count} ({pct}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

type ScoreDistributionProps = {
  distribution: Record<string, number>
  total: number
}

function ScoreDistribution({ distribution, total }: ScoreDistributionProps) {
  const maxCount = Math.max(...Object.values(distribution), 1)
  return (
    <div className="flex items-end gap-1">
      {Array.from({ length: 11 }, (_, i) => {
        const count = distribution[String(i)] ?? 0
        const heightPct = total > 0 ? Math.round((count / maxCount) * 100) : 0
        return (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs text-muted-foreground">{count > 0 ? count : ''}</span>
            <div
              className="w-full rounded-t"
              style={{
                height: `${Math.max(heightPct, count > 0 ? 4 : 0)}px`,
                minHeight: count > 0 ? '4px' : '0',
                backgroundColor: i >= 9 ? '#16a34a' : i >= 7 ? '#ca8a04' : '#dc2626',
              }}
            />
            <span className="text-xs">{i}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Respond Tab ──────────────────────────────────────────────────────────────

function RespondTab() {
  const { api } = useAuth()
  const { t } = useTranslation('engagement')

  const surveysQuery = useQuery({
    queryKey: ['engagement', 'surveys'],
    queryFn: () => api.listSurveys(),
  })

  const openSurveys = (surveysQuery.data?.items ?? []).filter((s) => s.status === 'open')
  const activeSurvey = openSurveys[0] ?? null

  if (surveysQuery.isLoading) {
    return <p>{t('loading')}</p>
  }

  if (!activeSurvey) {
    return <p>{t('respond.noOpenSurvey')}</p>
  }

  return <RespondForm surveyId={activeSurvey.id} question={activeSurvey.question} />
}

type RespondFormProps = {
  surveyId: string
  question: string
}

function RespondForm({ surveyId, question }: RespondFormProps) {
  const { api } = useAuth()
  const { t } = useTranslation('engagement')
  const [score, setScore] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [alreadyAnswered, setAlreadyAnswered] = useState(false)

  const submitMutation = useMutation({
    mutationFn: () =>
      api.submitSurveyResponse(surveyId, {
        score: score!,
        comment: comment || undefined,
      }),
    onSuccess: () => {
      toast.success(t('respond.success'))
      setScore(null)
      setComment('')
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.status === 409) {
        setAlreadyAnswered(true)
      } else {
        toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed'))
      }
    },
  })

  if (alreadyAnswered) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-center text-sm text-muted-foreground">{t('respond.alreadyAnswered')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('respond.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <p className="text-sm">{question}</p>

          <div className="grid gap-2">
            <label className="text-sm font-medium">{t('respond.scoreLabel')}</label>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 11 }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setScore(i)}
                  className={`flex h-10 w-10 items-center justify-center rounded border text-sm font-medium transition-colors ${
                    score === i
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background hover:bg-secondary'
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          <label className="grid gap-1 text-sm">
            {t('respond.commentLabel')}
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('respond.commentLabel')}
            />
          </label>

          <Button
            disabled={score === null || submitMutation.isPending}
            onClick={() => submitMutation.mutate()}
          >
            {t('actions.submit')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
