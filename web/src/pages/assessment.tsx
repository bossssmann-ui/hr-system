import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'

type AnswerMap = Record<string, unknown>

type SignalState = {
  pasteCount: number
  pasteSizes: number[]
  blurCount: number
  awayStartedAt: number | null
  awayTotalMs: number
  burstEvents: number
}

export function PublicAssessmentPage() {
  const params = useParams({ strict: false }) as { token?: string }
  const token = params.token ?? ''
  const { api } = useAuth()
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [consent, setConsent] = useState(false)
  const [webcamConsent, setWebcamConsent] = useState(false)
  const [submittedLocally, setSubmittedLocally] = useState(false)
  const [signalState, setSignalState] = useState<SignalState>({
    pasteCount: 0,
    pasteSizes: [],
    blurCount: 0,
    awayStartedAt: null,
    awayTotalMs: 0,
    burstEvents: 0,
  })
  const keyTimestampsRef = useRef<number[]>([])

  const assessmentQuery = useQuery({
    queryKey: ['assessment-public', token],
    queryFn: () => api.getPublicAssessment(token),
    enabled: Boolean(token),
    refetchInterval: (query) => query.state.data?.status === 'in_progress' ? 5000 : false,
  })

  const consentMutation = useMutation({
    mutationFn: () => api.consentPublicAssessment(token, {
      proctoring_consent: true,
      webcam_consent: webcamConsent,
      consent_basis: 'assessment_proctoring_phase1d',
    }),
    onSuccess: async () => {
      toast.success('Consent recorded')
      await assessmentQuery.refetch()
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Failed to record consent'),
  })

  const startMutation = useMutation({
    mutationFn: () => api.startPublicAssessment(token),
    onSuccess: () => {
      toast.success('Assessment started')
      void assessmentQuery.refetch()
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Failed to start'),
  })

  const submitMutation = useMutation({
    mutationFn: () =>
      api.submitPublicAssessment(token, {
        answers: Object.entries(answers).map(([question_id, answer]) => ({ question_id, answer })),
        signals: {
          paste_events: { count: signalState.pasteCount, sizes: signalState.pasteSizes },
          focus_loss_events: { count: signalState.blurCount, total_away_ms: signalState.awayTotalMs },
          keystroke_timing: { anomaly_flags: signalState.burstEvents, burst_events: signalState.burstEvents },
        },
      }),
    onSuccess: (result) => {
      setSubmittedLocally(true)
      toast.success(`Submitted. Trust score: ${result.trustScore}`)
      void assessmentQuery.refetch()
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Submit failed'),
  })

  const remainingSeconds = useMemo(() => {
    const assessment = assessmentQuery.data
    if (!assessment?.startedAt || !assessment.timeLimitMin) return null
    const startedAt = new Date(assessment.startedAt).getTime()
    const expiresAt = startedAt + assessment.timeLimitMin * 60 * 1000
    return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
  }, [assessmentQuery.data])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text') ?? ''
      setSignalState((current) => ({
        ...current,
        pasteCount: current.pasteCount + 1,
        pasteSizes: [...current.pasteSizes, text.length],
      }))
    }
    const onBlur = () => {
      setSignalState((current) => ({
        ...current,
        blurCount: current.blurCount + 1,
        awayStartedAt: Date.now(),
      }))
    }
    const onFocus = () => {
      setSignalState((current) => ({
        ...current,
        awayTotalMs: current.awayStartedAt ? current.awayTotalMs + (Date.now() - current.awayStartedAt) : current.awayTotalMs,
        awayStartedAt: null,
      }))
    }
    const onKeyDown = () => {
      const now = Date.now()
      keyTimestampsRef.current = [...keyTimestampsRef.current.filter((timestamp) => now - timestamp < 1000), now]
      // Heuristic burst signal: >20 keystrokes in 1 second is treated as anomalous.
      if (keyTimestampsRef.current.length > 20) {
        setSignalState((current) => ({ ...current, burstEvents: current.burstEvents + 1 }))
      }
    }

    window.addEventListener('paste', onPaste)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  if (assessmentQuery.isPending) {
    return <section className="mx-auto w-full max-w-3xl px-5 py-12"><Typography>Loading assessment…</Typography></section>
  }

  if (assessmentQuery.isError || !assessmentQuery.data) {
    return (
      <section className="mx-auto w-full max-w-3xl px-5 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Assessment unavailable</CardTitle>
            <CardDescription>Link is invalid or expired.</CardDescription>
          </CardHeader>
        </Card>
      </section>
    )
  }

  const assessment = assessmentQuery.data

  if (submittedLocally || assessment.status === 'submitted' || assessment.status === 'graded' || assessment.status === 'expired') {
    return (
      <section className="mx-auto w-full max-w-3xl px-5 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Assessment {assessment.status}</CardTitle>
            <CardDescription>Thank you. Your answers were received.</CardDescription>
          </CardHeader>
        </Card>
      </section>
    )
  }

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-4 px-5 py-12">
      <div className="grid gap-2">
        <Badge variant="outline" className="w-fit">Candidate assessment</Badge>
        <Typography variant="h1">{assessment.title}</Typography>
        {assessment.description && <Typography tone="muted">{assessment.description}</Typography>}
        {remainingSeconds !== null && (
          <Typography variant="bodySm" tone="muted">Time left: {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')}</Typography>
        )}
      </div>

      {assessment.status === 'invited' && (
        <Card>
          <CardHeader>
            <CardTitle>Consent required</CardTitle>
            <CardDescription>Proctoring consent is required before the test starts (152-ФЗ).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} data-testid="assessment-consent-checkbox" />
              I consent to behavioral proctoring for this assessment
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={webcamConsent} onChange={(event) => setWebcamConsent(event.target.checked)} />
              Optional webcam snapshots consent (if enabled)
            </label>
            <Button
              onClick={() => consentMutation.mutate()}
              disabled={!consent || consentMutation.isPending}
              data-testid="assessment-consent-submit"
            >
              {consentMutation.isPending ? 'Saving…' : 'Record consent'}
            </Button>
          </CardContent>
        </Card>
      )}

      {assessment.status !== 'in_progress' && (
        <Button onClick={() => startMutation.mutate()} disabled={assessment.status === 'invited' || startMutation.isPending} data-testid="assessment-start-button">
          {startMutation.isPending ? 'Starting…' : 'Start assessment'}
        </Button>
      )}

      {(assessment.status === 'in_progress' || assessment.status === 'consented') && (
        <Card>
          <CardHeader>
            <CardTitle>Questions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            {assessment.questions.map((question) => (
              <div key={question.id} className="grid gap-2">
                <Typography className="font-medium">{question.order + 1}. {question.prompt}</Typography>
                {question.type === 'open' && (
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    rows={4}
                    value={typeof answers[question.id] === 'string' ? String(answers[question.id]) : ''}
                    onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                  />
                )}
                {question.type === 'single_choice' && (
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={typeof answers[question.id] === 'string' ? String(answers[question.id]) : ''}
                    onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                  >
                    <option value="">Select…</option>
                    {(question.options ?? []).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                )}
                {question.type === 'multi_choice' && (
                  <div className="grid gap-1">
                    {(question.options ?? []).map((option) => {
                      const selected = Array.isArray(answers[question.id]) ? (answers[question.id] as string[]) : []
                      const checked = selected.includes(option)
                      return (
                        <label key={option} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...selected, option]
                                : selected.filter((item) => item !== option)
                              setAnswers((current) => ({ ...current, [question.id]: next }))
                            }}
                          />
                          {option}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
            <Button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending} data-testid="assessment-submit-button">
              {submitMutation.isPending ? 'Submitting…' : 'Submit assessment'}
            </Button>
          </CardContent>
        </Card>
      )}
    </section>
  )
}
