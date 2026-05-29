/**
 * Phase 2 — Selection System candidate-facing page.
 *
 * Public route: /selection/:token
 * No authentication required. Loads the 4-stage screening flow from
 * GET /api/selection/sessions/:token and submits answers per stage via
 * POST /api/selection/sessions/:token/stage/:n
 */

import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'

type AnswerMap = Record<string, unknown>

const STAGE_2_LIMIT_MS = 30 * 60 * 1000

// ─── Local-storage key for stage-2 timer ────────────────────────────────────

function timerKey(sessionId: string) {
  return `selection_stage2_started_${sessionId}`
}

function getStage2StartedAt(sessionId: string): number | null {
  const raw = localStorage.getItem(timerKey(sessionId))
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

function setStage2StartedAt(sessionId: string, ts: number) {
  localStorage.setItem(timerKey(sessionId), String(ts))
}

// ─── Progress indicator ──────────────────────────────────────────────────────

function StageProgress({ current }: { current: number | null }) {
  const { t } = useTranslation('selection')
  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3, 4].map((n) => (
        <div
          key={n}
          className={`h-3 w-3 rounded-full ${
            current !== null && n <= current
              ? 'bg-primary'
              : 'bg-muted-foreground/30'
          }`}
          aria-label={
            current !== null && n <= current
              ? t('candidate.stageCompletedAria', { n })
              : t('candidate.stageAria', { n })
          }
        />
      ))}
      <Typography variant="bodySm" tone="muted">
        {current !== null && current <= 4
          ? t('candidate.stageOfFour', { n: current })
          : t('candidate.allComplete')}
      </Typography>
    </div>
  )
}

// ─── Countdown timer (Stage 2 only) ─────────────────────────────────────────

function CountdownTimer({ sessionId, startedAt }: { sessionId: string; startedAt: string | null }) {
  const { t } = useTranslation('selection')
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  // Prefer server-provided startedAt, fall back to localStorage
  const startMs = useMemo(() => {
    if (startedAt) {
      const ts = new Date(startedAt).getTime()
      if (Number.isFinite(ts)) {
        setStage2StartedAt(sessionId, ts)
        return ts
      }
    }
    return getStage2StartedAt(sessionId) ?? nowMs
  }, [startedAt, sessionId, nowMs])

  const remainingMs = Math.max(0, startMs + STAGE_2_LIMIT_MS - nowMs)
  const minutes = Math.floor(remainingMs / 60000)
  const seconds = Math.floor((remainingMs % 60000) / 1000)
  const isUrgent = remainingMs < 5 * 60 * 1000

  return (
    <div
      className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium ${
        isUrgent ? 'border-destructive text-destructive' : 'border-muted text-muted-foreground'
      }`}
    >
      {t('candidate.timer', {
        minutes: String(minutes).padStart(2, '0'),
        seconds: String(seconds).padStart(2, '0'),
      })}
    </div>
  )
}

// ─── Stage 2 — no-going-back questionnaire ───────────────────────────────────

type Stage2QuestionAnswer = { questionKey: string; value: unknown }

function Stage2Questions({
  stageData,
  onSubmit,
  isSubmitting,
  sessionId,
  startedAt,
}: {
  stageData: unknown
  onSubmit: (answers: AnswerMap) => void
  isSubmitting: boolean
  sessionId: string
  startedAt: string | null
}) {
  const { t } = useTranslation('selection')
  // The stage data shape from the server is just metadata. For Stage 2 we show
  // a simple text entry per question, with no ability to navigate backwards.
  const [currentQ, setCurrentQ] = useState(0)
  const [collectedAnswers, setCollectedAnswers] = useState<Stage2QuestionAnswer[]>([])
  const [currentAnswer, setCurrentAnswer] = useState<string>('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const stage = stageData as { questions?: Array<{ key: string; text: string; type?: string; options?: string[] }> } | null

  // Fallback placeholder if server sends no question list
  const questions: Array<{ key: string; text: string; type?: string; options?: string[] }> = stage?.questions ?? [
    { key: 'q1', text: t('candidate.stage2Fallback') },
  ]

  const total = questions.length
  const isLast = currentQ === total - 1
  const q = questions[currentQ]

  useEffect(() => {
    inputRef.current?.focus()
    setCurrentAnswer('')
  }, [currentQ])

  function handleNext() {
    if (!q) return
    const updated = [...collectedAnswers, { questionKey: q.key, value: currentAnswer }]
    setCollectedAnswers(updated)

    if (isLast) {
      const answerMap: AnswerMap = {}
      for (const item of updated) {
        answerMap[item.questionKey] = item.value
      }
      onSubmit(answerMap)
    } else {
      setCurrentQ((n) => n + 1)
      setCurrentAnswer('')
    }
  }

  if (!q) return null

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between">
        <CountdownTimer sessionId={sessionId} startedAt={startedAt} />
        <Typography variant="bodySm" tone="muted">
          {t('candidate.questionOf', { current: currentQ + 1, total })}
        </Typography>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{currentQ + 1}. {q.text}</CardTitle>
          <CardDescription>{t('candidate.noGoBack')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {q.type === 'single_choice' && q.options ? (
            <div className="grid gap-2">
              {q.options.map((option) => (
                <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="stage2_q"
                    value={option}
                    checked={currentAnswer === option}
                    onChange={() => setCurrentAnswer(option)}
                  />
                  {option}
                </label>
              ))}
            </div>
          ) : (
            <textarea
              ref={inputRef}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={4}
              placeholder={t('candidate.answerPlaceholder')}
              value={currentAnswer}
              onChange={(e) => setCurrentAnswer(e.target.value)}
            />
          )}
          <Button
            onClick={handleNext}
            disabled={isSubmitting && isLast}
          >
            {isLast
              ? isSubmitting
                ? t('candidate.submitting')
                : t('candidate.finishTest')
              : t('candidate.nextQuestion')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Generic stage form ───────────────────────────────────────────────────────

function GenericStageForm({
  stageData,
  stageNumber,
  onSubmit,
  isSubmitting,
}: {
  stageData: unknown
  stageNumber: number
  onSubmit: (answers: AnswerMap) => void
  isSubmitting: boolean
}) {
  const { t } = useTranslation('selection')
  const [answers, setAnswers] = useState<AnswerMap>({})
  const stage = stageData as {
    title?: string
    questions?: Array<{ key: string; text: string; type?: string; options?: string[] }>
  } | null

  const questions = stage?.questions ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>{stage?.title ?? t(`stages.${stageNumber}`)}</CardTitle>
        <CardDescription>
          {stageNumber === 3
            ? t('candidate.generic.scaleHint')
            : stageNumber === 4
            ? t('candidate.generic.practicalHint')
            : t('candidate.generic.fillAll')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {questions.length === 0 ? (
          <div className="grid gap-2">
            <Typography variant="bodySm" tone="muted">
              {t('candidate.generic.configuredInTemplate')}
            </Typography>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={6}
              placeholder={t('candidate.generic.answerPlaceholder')}
              value={typeof answers['answer'] === 'string' ? String(answers['answer']) : ''}
              onChange={(e) => setAnswers({ answer: e.target.value })}
            />
          </div>
        ) : (
          questions.map((q) => (
            <div key={q.key} className="grid gap-2">
              <Typography className="text-sm font-medium">{q.text}</Typography>
              {q.type === 'scale' ? (
                <div className="flex gap-3">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <label key={v} className="flex cursor-pointer flex-col items-center gap-1 text-xs">
                      <input
                        type="radio"
                        name={q.key}
                        value={v}
                        checked={answers[q.key] === v}
                        onChange={() => setAnswers((a) => ({ ...a, [q.key]: v }))}
                      />
                      {v}
                    </label>
                  ))}
                </div>
              ) : q.type === 'single_choice' && q.options ? (
                <div className="grid gap-1">
                  {q.options.map((option) => (
                    <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={q.key}
                        value={option}
                        checked={answers[q.key] === option}
                        onChange={() => setAnswers((a) => ({ ...a, [q.key]: option }))}
                      />
                      {option}
                    </label>
                  ))}
                </div>
              ) : (
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  rows={3}
                  value={typeof answers[q.key] === 'string' ? String(answers[q.key]) : ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
                />
              )}
            </div>
          ))
        )}
        <Button onClick={() => onSubmit(answers)} disabled={isSubmitting}>
          {isSubmitting ? t('candidate.submitting') : t('candidate.submitContinue')}
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function PublicSelectionPage() {
  const params = useParams({ strict: false }) as { token?: string }
  const token = params.token ?? ''
  const { api } = useAuth()
  const { t } = useTranslation('selection')
  const [locallyCompleted, setLocallyCompleted] = useState(false)

  const sessionQuery = useQuery({
    queryKey: ['selection-public', token],
    queryFn: () => api.getSelectionSession(token),
    enabled: Boolean(token),
    refetchInterval: 3000,
  })

  const submitStageMutation = useMutation({
    mutationFn: ({ stage, answers }: { stage: number; answers: AnswerMap }) =>
      api.submitSelectionStage(token, stage, answers),
    onSuccess: (result) => {
      if (result.nextStatus === 'completed') {
        setLocallyCompleted(true)
        toast.success(t('candidate.toasts.allComplete'))
      } else {
        toast.success(t('candidate.toasts.stagePassed'))
        void sessionQuery.refetch()
      }
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError && error.status === 422) {
        toast.error(t('candidate.toasts.timeUp'))
      } else {
        toast.error(error instanceof ApiRequestError ? error.message : t('candidate.toasts.submitFailed'))
      }
      void sessionQuery.refetch()
    },
  })

  function handleStageSubmit(stage: number, answers: AnswerMap) {
    submitStageMutation.mutate({ stage, answers })
  }

  // Loading state
  if (sessionQuery.isPending) {
    return (
      <section className="mx-auto w-full max-w-2xl px-5 py-12">
        <Typography>{t('candidate.loading')}</Typography>
      </section>
    )
  }

  if (sessionQuery.isError || !sessionQuery.data) {
    return (
      <section className="mx-auto w-full max-w-2xl px-5 py-12">
        <Card>
          <CardHeader>
            <CardTitle>{t('candidate.unavailableTitle')}</CardTitle>
            <CardDescription>{t('candidate.unavailableHint')}</CardDescription>
          </CardHeader>
        </Card>
      </section>
    )
  }

  const session = sessionQuery.data

  // Terminal states
  const isTerminal = locallyCompleted
    || session.status === 'completed'
    || session.status === 'rejected'
    || session.status === 'expired'

  if (isTerminal) {
    const isExpired = session.status === 'expired'
    const isRejected = session.status === 'rejected'
    return (
      <section className="mx-auto w-full max-w-2xl px-5 py-12">
        <Card>
          <CardHeader>
            <CardTitle>
              {isExpired
                ? t('candidate.expiredTitle')
                : isRejected
                ? t('candidate.rejectedTitle')
                : t('candidate.thanksTitle')}
            </CardTitle>
            <CardDescription>
              {isExpired
                ? t('candidate.expiredHint')
                : isRejected
                ? t('candidate.rejectedHint')
                : t('candidate.thanksHint')}
            </CardDescription>
          </CardHeader>
        </Card>
      </section>
    )
  }

  const currentStage = session.currentStage

  return (
    <section className="mx-auto grid w-full max-w-2xl gap-6 px-5 py-12">
      {/* Header */}
      <div className="grid gap-2">
        <Badge variant="outline" className="w-fit">{t('candidate.badge')}</Badge>
        <Typography variant="h1">
          {session.role === 'logist' ? t('candidate.roles.logist') : t('candidate.roles.sales_manager')}
        </Typography>
        {currentStage !== null && currentStage <= 4 && (
          <Typography tone="muted">{t(`stages.${currentStage}`)}</Typography>
        )}
      </div>

      {/* Progress */}
      <StageProgress current={currentStage} />

      {/* Stage content */}
      {currentStage === null && (
        <Card>
          <CardHeader>
            <CardTitle>{t('candidate.completedTitle')}</CardTitle>
            <CardDescription>{t('candidate.completedHint')}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {currentStage === 1 && (
        <GenericStageForm
          stageData={session.stageData}
          stageNumber={1}
          onSubmit={(answers) => handleStageSubmit(1, answers)}
          isSubmitting={submitStageMutation.isPending}
        />
      )}

      {currentStage === 2 && (
        <Stage2Questions
          stageData={session.stageData}
          onSubmit={(answers) => handleStageSubmit(2, answers)}
          isSubmitting={submitStageMutation.isPending}
          sessionId={session.sessionId}
          startedAt={session.startedAt}
        />
      )}

      {currentStage === 3 && (
        <GenericStageForm
          stageData={session.stageData}
          stageNumber={3}
          onSubmit={(answers) => handleStageSubmit(3, answers)}
          isSubmitting={submitStageMutation.isPending}
        />
      )}

      {currentStage === 4 && (
        <GenericStageForm
          stageData={session.stageData}
          stageNumber={4}
          onSubmit={(answers) => handleStageSubmit(4, answers)}
          isSubmitting={submitStageMutation.isPending}
        />
      )}
    </section>
  )
}
