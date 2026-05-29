/**
 * Phase 3 — Offer panel embedded inside the Application detail page.
 *
 * Lists offers for an application, supports creating a new offer prefilled
 * from the most recent interview's `offerDraft`, and surfaces FSM action
 * buttons gated by the offer status.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateOfferRequest, Offer, RoleName } from '@web-app-demo/contracts'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { ApiRequestError } from '@/lib/api'
import { hasAnyRole } from '@/lib/roles'
import { useAuth } from '@/lib/use-auth'
import { cn } from '@/lib/utils'

const CURRENCIES = ['RUB', 'USD', 'THB', 'USDT'] as const

type Action = 'submit' | 'approve' | 'reject' | 'send' | 'decline' | 'accept'

const ACTIONS_BY_STATUS: Record<Offer['status'], Action[]> = {
  draft: ['submit'],
  manager_review: ['approve', 'reject'],
  approved: ['send'],
  sent: ['accept', 'decline'],
  accepted: [],
  declined: [],
  expired: [],
}

const ACTION_ROLES: Record<Action, RoleName[]> = {
  submit: ['recruiter', 'hr_admin', 'owner'],
  approve: ['hr_admin', 'owner'],
  reject: ['hr_admin', 'owner'],
  send: ['recruiter', 'hr_admin', 'owner'],
  decline: ['recruiter', 'hr_admin', 'owner'],
  accept: ['recruiter', 'hr_admin', 'owner'],
}

function statusBadgeClass(status: Offer['status']): string {
  switch (status) {
    case 'accepted':
      return 'bg-green-500 text-white'
    case 'declined':
    case 'expired':
      return 'bg-red-500 text-white'
    case 'sent':
      return 'bg-blue-500 text-white'
    case 'approved':
      return 'bg-emerald-500 text-white'
    case 'manager_review':
      return 'bg-amber-500 text-white'
    default:
      return ''
  }
}

export function OfferPanel({ applicationId }: { applicationId: string }) {
  const { api, user } = useAuth()
  const { t } = useTranslation('offers')
  const queryClient = useQueryClient()

  const canCreate = hasAnyRole(user, 'recruiter', 'hr_admin', 'owner')

  const offersQuery = useQuery({
    queryKey: ['offers', 'by-application', applicationId],
    queryFn: () => api.listApplicationOffers(applicationId),
  })

  const interviewsQuery = useQuery({
    queryKey: ['interviews', applicationId],
    queryFn: () => api.listInterviews(applicationId),
  })

  const [showForm, setShowForm] = useState(false)

  const latestDraft = useMemo(() => {
    const list = interviewsQuery.data?.items ?? []
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const draft = (list[i] as { offerDraft?: unknown }).offerDraft
      if (draft && typeof draft === 'object') return draft as Record<string, unknown>
    }
    return null
  }, [interviewsQuery.data])

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['offers', 'by-application', applicationId] })

  const createMutation = useMutation({
    mutationFn: (input: CreateOfferRequest) => api.createOffer(input),
    onSuccess: () => {
      toast.success(t('toasts.created'))
      setShowForm(false)
      invalidate()
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('toasts.createFailed')),
  })

  const transitionMutation = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: Action; body?: unknown }) =>
      api.transitionOffer(id, action, body),
    onSuccess: (_data, vars) => {
      toast.success(t('toasts.transitioned', { action: t(`actions.${vars.action}`) }))
      invalidate()
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('toasts.transitionFailed')),
  })

  const offers = offersQuery.data?.items ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t('title')}</CardTitle>
          {!showForm && canCreate && (
            <Button size="sm" onClick={() => setShowForm(true)}>
              {t('create')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {offersQuery.isPending && <Spinner />}
        {offersQuery.isError && (
          <Alert variant="destructive">
            <AlertTitle>{t('list.loadFailed')}</AlertTitle>
            <AlertDescription>
              {offersQuery.error instanceof ApiRequestError
                ? offersQuery.error.message
                : t('list.unknownError')}
            </AlertDescription>
          </Alert>
        )}

        {showForm && (
          <CreateOfferForm
            applicationId={applicationId}
            draft={latestDraft}
            onCancel={() => setShowForm(false)}
            onSubmit={(input) => createMutation.mutate(input)}
            isPending={createMutation.isPending}
          />
        )}

        {offers.length === 0 && !offersQuery.isPending && !showForm && (
          <Typography tone="muted">{t('list.empty')}</Typography>
        )}

        {offers.map((offer) => (
          <div key={offer.id} className="grid gap-2 rounded border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn(statusBadgeClass(offer.status))}>
                {t(`status.${offer.status}`)}
              </Badge>
              <Typography>
                {offer.salary.toLocaleString()} {offer.currency}
                {offer.grade && ` · ${offer.grade}`}
              </Typography>
              <Typography tone="muted">
                {t('list.startDate', { date: new Date(offer.startDate).toLocaleDateString() })}
              </Typography>
            </div>
            {offer.conditions && offer.conditions.length > 0 && (
              <ul className="ml-4 list-disc text-sm text-muted-foreground">
                {offer.conditions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
            {offer.status === 'sent' && offer.docusealSigningUrl && (
              <a
                href={offer.docusealSigningUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-blue-600 underline"
              >
                {t('list.openSigning')}
              </a>
            )}
            {offer.status === 'declined' && offer.declinedReason && (
              <Typography tone="muted">{t('list.reason', { reason: offer.declinedReason })}</Typography>
            )}
            <div className="flex flex-wrap gap-2">
              {ACTIONS_BY_STATUS[offer.status]
                .filter((action) => hasAnyRole(user, ...ACTION_ROLES[action]))
                .map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant={action === 'reject' || action === 'decline' ? 'destructive' : 'default'}
                  disabled={transitionMutation.isPending}
                  onClick={() => {
                    if (action === 'reject') {
                      const reason = window.prompt(t('list.rejectPrompt')) ?? ''
                      transitionMutation.mutate({ id: offer.id, action, body: { reason } })
                      return
                    }
                    if (action === 'decline') {
                      const reason = window.prompt(t('list.declinePrompt')) ?? ''
                      transitionMutation.mutate({ id: offer.id, action, body: { reason } })
                      return
                    }
                    transitionMutation.mutate({ id: offer.id, action })
                  }}
                >
                  {t(`actions.${action}`)}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function CreateOfferForm({
  applicationId,
  draft,
  onCancel,
  onSubmit,
  isPending,
}: {
  applicationId: string
  draft: Record<string, unknown> | null
  onCancel: () => void
  onSubmit: (input: CreateOfferRequest) => void
  isPending: boolean
}) {
  const { t } = useTranslation('offers')
  const [salary, setSalary] = useState<string>(
    typeof draft?.salary === 'number' ? String(draft.salary) : '',
  )
  const [currency, setCurrency] = useState<string>(
    typeof draft?.currency === 'string' ? (draft.currency as string) : 'RUB',
  )
  const [grade, setGrade] = useState<string>(
    typeof draft?.grade === 'string' ? (draft.grade as string) : '',
  )
  const [startDate, setStartDate] = useState<string>(
    typeof draft?.startDate === 'string'
      ? (draft.startDate as string).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  )
  const [conditions, setConditions] = useState<string>(
    Array.isArray(draft?.conditions) ? (draft!.conditions as string[]).join('\n') : '',
  )

  const canSubmit = salary && Number(salary) > 0 && startDate && currency

  return (
    <div className="grid gap-3 rounded border p-4">
      <Typography variant="h4">{t('newOffer')}</Typography>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="text-sm font-medium">{t('fields.salary')}</label>
          <Input type="number" value={salary} onChange={(e) => setSalary(e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium">{t('fields.currency')}</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">{t('fields.grade')}</label>
          <Input value={grade} onChange={(e) => setGrade(e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium">{t('fields.startDate')}</label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">{t('fields.conditions')}</label>
        <textarea
          className="min-h-24 w-full rounded-md border border-input bg-transparent p-2 text-sm"
          value={conditions}
          onChange={(e) => setConditions(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button
          disabled={!canSubmit || isPending}
          onClick={() => {
            const conds = conditions.split('\n').map((s) => s.trim()).filter(Boolean)
            const input: CreateOfferRequest = {
              applicationId,
              salary: Number(salary),
              currency: currency as CreateOfferRequest['currency'],
              startDate: new Date(startDate).toISOString(),
              grade: grade || undefined,
              conditions: conds.length > 0 ? conds : undefined,
            }
            onSubmit(input)
          }}
        >
          {t('form.create')}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          {t('form.cancel')}
        </Button>
      </div>
    </div>
  )
}

