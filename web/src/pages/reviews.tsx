/**
 * Horizon 4 — Performance page.
 *
 * Tabs: 1:1 | Reviews/360 | OKR | IDP
 * Route: /reviews (existing, unchanged)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type {
  OneOnOneResponse,
  PerformanceOkrResponse,
  PerformanceIdpResponse,
  ReviewCycleWithStatsResponse,
  ReviewRequestResponse,
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

// ─── Root ────────────────────────────────────────────────────────────────────

export function ReviewsPage() {
  const { user } = useAuth()
  const { t } = useTranslation('performance')

  if (!user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-3 px-5 py-12">
        <h1>{t('title')}</h1>
        <p>{t('loading')}</p>
      </section>
    )
  }

  return <PerformanceContent />
}

// ─── Main content ─────────────────────────────────────────────────────────────

function PerformanceContent() {
  const { t } = useTranslation('performance')
  const [tab, setTab] = useState('one-on-one')

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-12">
      <h1 className="mb-6 text-2xl font-semibold">{t('title')}</h1>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="one-on-one">{t('tabs.oneOnOne')}</TabsTrigger>
          <TabsTrigger value="reviews">{t('tabs.reviews')}</TabsTrigger>
          <TabsTrigger value="okr">{t('tabs.okr')}</TabsTrigger>
          <TabsTrigger value="idp">{t('tabs.idp')}</TabsTrigger>
        </TabsList>

        <TabsContent value="one-on-one" className="mt-6">
          <OneOnOneTab />
        </TabsContent>
        <TabsContent value="reviews" className="mt-6">
          <ReviewsTab />
        </TabsContent>
        <TabsContent value="okr" className="mt-6">
          <OkrTab />
        </TabsContent>
        <TabsContent value="idp" className="mt-6">
          <IdpTab />
        </TabsContent>
      </Tabs>
    </section>
  )
}

// ─── 1:1 Tab ─────────────────────────────────────────────────────────────────

function OneOnOneTab() {
  const { api } = useAuth()
  const { t } = useTranslation('performance')
  const queryClient = useQueryClient()
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [completeTarget, setCompleteTarget] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['performance', 'one-on-ones'],
    queryFn: () => api.listOneOnOnes(),
  })

  const scheduleMutation = useMutation({
    mutationFn: (body: { employeeId: string; managerUserId: string; scheduledAt: string; agenda?: string }) =>
      api.createOneOnOne(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['performance', 'one-on-ones'] })
      setScheduleOpen(false)
      toast.success(t('oneOnOne.schedule'))
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const completeMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      api.completeOneOnOne(id, { notes }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['performance', 'one-on-ones'] })
      setCompleteTarget(null)
      toast.success(t('actions.complete'))
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const [scheduleForm, setScheduleForm] = useState({
    employeeId: '',
    managerUserId: '',
    scheduledAt: '',
    agenda: '',
  })
  const [completeNotes, setCompleteNotes] = useState('')

  const items = query.data?.items ?? []

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('oneOnOne.title')}</h2>
        <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
          <DialogTrigger asChild>
            <Button size="sm">{t('actions.schedule')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('oneOnOne.schedule')}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm">
                {t('oneOnOne.employeeId')}
                <Input
                  value={scheduleForm.employeeId}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, employeeId: e.target.value }))}
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('oneOnOne.managerUserId')}
                <Input
                  value={scheduleForm.managerUserId}
                  onChange={(e) =>
                    setScheduleForm((f) => ({ ...f, managerUserId: e.target.value }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('oneOnOne.scheduledAt')}
                <Input
                  type="datetime-local"
                  value={scheduleForm.scheduledAt}
                  onChange={(e) =>
                    setScheduleForm((f) => ({ ...f, scheduledAt: e.target.value }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('oneOnOne.agenda')}
                <Input
                  value={scheduleForm.agenda}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, agenda: e.target.value }))}
                />
              </label>
              <Button
                disabled={
                  !scheduleForm.employeeId ||
                  !scheduleForm.managerUserId ||
                  !scheduleForm.scheduledAt ||
                  scheduleMutation.isPending
                }
                onClick={() =>
                  scheduleMutation.mutate({
                    employeeId: scheduleForm.employeeId,
                    managerUserId: scheduleForm.managerUserId,
                    scheduledAt: new Date(scheduleForm.scheduledAt).toISOString(),
                    agenda: scheduleForm.agenda || undefined,
                  })
                }
              >
                {t('actions.save')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {query.isLoading ? (
        <p className="text-muted-foreground">{t('loading')}</p>
      ) : query.isError ? (
        <p className="text-destructive">{t('loadFailed')}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{t('oneOnOne.empty')}</p>
      ) : (
        items.map((item: OneOnOneResponse) => (
          <Card key={item.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">
                  {new Date(item.scheduledAt).toLocaleString()}
                </CardTitle>
                <OneOnOneBadge status={item.status} />
              </div>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {item.agenda && <p className="text-muted-foreground">{item.agenda}</p>}
              <p className="text-xs text-muted-foreground">
                employee: {item.employeeId} · manager: {item.managerUserId}
              </p>
              {item.status === 'scheduled' && (
                <Dialog
                  open={completeTarget === item.id}
                  onOpenChange={(open) => {
                    setCompleteTarget(open ? item.id : null)
                    if (!open) setCompleteNotes('')
                  }}
                >
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline">
                      {t('actions.complete')}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t('oneOnOne.complete')}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3">
                      <label className="grid gap-1 text-sm">
                        {t('oneOnOne.notes')}
                        <Input
                          value={completeNotes}
                          onChange={(e) => setCompleteNotes(e.target.value)}
                        />
                      </label>
                      <Button
                        disabled={completeMutation.isPending}
                        onClick={() =>
                          completeMutation.mutate({ id: item.id, notes: completeNotes })
                        }
                      >
                        {t('actions.save')}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

function OneOnOneBadge({ status }: { status: OneOnOneResponse['status'] }) {
  const { t } = useTranslation('performance')
  const variant =
    status === 'completed' ? 'default' : status === 'cancelled' ? 'destructive' : 'secondary'
  return <Badge variant={variant}>{t(`oneOnOne.status.${status}`)}</Badge>
}

// ─── Reviews / 360 Tab ───────────────────────────────────────────────────────

function ReviewsTab() {
  const { api, user } = useAuth()
  const { t } = useTranslation('performance')
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createQuarter, setCreateQuarter] = useState('')
  const [submitTarget, setSubmitTarget] = useState<ReviewRequestResponse | null>(null)
  const [submitNotes, setSubmitNotes] = useState('')

  const cyclesQuery = useQuery({
    queryKey: ['performance', 'review-cycles'],
    queryFn: () => api.listReviewCycles(),
  })

  const myRequestsQuery = useQuery({
    queryKey: ['performance', 'review-requests', user?.id],
    queryFn: () => (user ? api.listMyReviewRequests({ reviewerUserId: user.id }) : null),
    enabled: !!user,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.createReviewCycle({
        title: createTitle.trim(),
        quarter: createQuarter.trim(),
        questions: [
          { id: 'overall', prompt: 'Overall rating', type: 'rating' },
          { id: 'comments', prompt: 'Comments', type: 'text' },
        ],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['performance', 'review-cycles'] })
      setCreateOpen(false)
      setCreateTitle('')
      setCreateQuarter('')
      toast.success(t('actions.save'))
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const openMutation = useMutation({
    mutationFn: ({ id, closesAt }: { id: string; closesAt: string }) =>
      api.openReviewCycle(id, { closesAt }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['performance', 'review-cycles'] })
      toast.success(t('actions.open'))
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const closeMutation = useMutation({
    mutationFn: (id: string) => api.closeReviewCycle(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['performance', 'review-cycles'] })
      toast.success(t('actions.close'))
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const submitMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      api.submitReviewRequest(id, {
        response: {
          overall: 4,
          comments: notes.trim() || null,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['performance', 'review-requests'] })
      setSubmitTarget(null)
      setSubmitNotes('')
      toast.success(t('reviews.submitReview'))
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const declineMutation = useMutation({
    mutationFn: (id: string) => api.declineReviewRequest(id, { reason: 'Declined from UI' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['performance', 'review-requests'] })
      toast.success(t('actions.cancel'))
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const cycles = cyclesQuery.data?.items ?? []
  const myRequests = myRequestsQuery.data?.items ?? []
  const canCreate = createTitle.trim().length > 0 && /^\d{4}-Q[1-4]$/.test(createQuarter.trim())

  return (
    <div className="grid gap-6">
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">{t('reviews.title')}</h2>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">{t('reviews.create')}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('reviews.create')}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3">
                <label className="grid gap-1 text-sm">
                  {t('reviews.createTitle')}
                  <Input value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} />
                </label>
                <label className="grid gap-1 text-sm">
                  {t('reviews.createQuarter')}
                  <Input
                    value={createQuarter}
                    onChange={(e) => setCreateQuarter(e.target.value)}
                    placeholder="2026-Q1"
                  />
                </label>
                <Button
                  disabled={!canCreate || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  {t('actions.save')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        {cyclesQuery.isLoading ? (
          <p className="text-muted-foreground">{t('loading')}</p>
        ) : cyclesQuery.isError ? (
          <p className="text-destructive">{t('loadFailed')}</p>
        ) : cycles.length === 0 ? (
          <p className="text-muted-foreground">{t('reviews.empty')}</p>
        ) : (
          <div className="grid gap-3">
            {cycles.map((cycle: ReviewCycleWithStatsResponse) => (
              <Card key={cycle.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{cycle.title}</CardTitle>
                    <ReviewCycleBadge status={cycle.status} />
                  </div>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <p className="text-muted-foreground">{cycle.quarter}</p>
                  <p>
                    {t('reviews.completion', {
                      submitted: cycle.stats.submitted,
                      total: cycle.stats.total,
                    })}
                  </p>
                  {cycle.closesAt && (
                    <p className="text-xs text-muted-foreground">
                      {t('reviews.closesAt')}: {new Date(cycle.closesAt).toLocaleDateString()}
                    </p>
                  )}
                  <div className="flex gap-2">
                    {cycle.status === 'draft' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={openMutation.isPending}
                        onClick={() =>
                          openMutation.mutate({
                            id: cycle.id,
                            closesAt: new Date(
                              Date.now() + 14 * 24 * 60 * 60 * 1000,
                            ).toISOString(),
                          })
                        }
                      >
                        {t('actions.open')}
                      </Button>
                    )}
                    {cycle.status === 'open' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={closeMutation.isPending}
                        onClick={() => closeMutation.mutate(cycle.id)}
                      >
                        {t('actions.close')}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">{t('reviews.myRequests')}</h2>
        {myRequestsQuery.isLoading ? (
          <p className="text-muted-foreground">{t('loading')}</p>
        ) : myRequests.length === 0 ? (
          <p className="text-muted-foreground">{t('reviews.myRequestsEmpty')}</p>
        ) : (
          <div className="grid gap-3">
            {myRequests.map((req: ReviewRequestResponse) => (
              <Card key={req.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm">
                      {req.relationship} · {req.cycleId.slice(0, 8)}…
                    </CardTitle>
                    <ReviewRequestBadge status={req.status} />
                  </div>
                </CardHeader>
                {req.status === 'pending' && (
                  <CardContent className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setSubmitTarget(req)}>
                      {t('reviews.submitReview')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={declineMutation.isPending}
                      onClick={() => declineMutation.mutate(req.id)}
                    >
                      {t('actions.cancel')}
                    </Button>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={Boolean(submitTarget)} onOpenChange={(open) => !open && setSubmitTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('reviews.submitReview')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">
              {t('oneOnOne.notes')}
              <Input value={submitNotes} onChange={(e) => setSubmitNotes(e.target.value)} />
            </label>
            <Button
              disabled={!submitTarget || submitMutation.isPending}
              onClick={() =>
                submitTarget && submitMutation.mutate({ id: submitTarget.id, notes: submitNotes })
              }
            >
              {t('actions.submit')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ReviewCycleBadge({ status }: { status: ReviewCycleWithStatsResponse['status'] }) {
  const { t } = useTranslation('performance')
  const variant =
    status === 'open' ? 'default' : status === 'closed' ? 'secondary' : 'outline'
  return <Badge variant={variant}>{t(`reviews.cycleStatus.${status}`)}</Badge>
}

function ReviewRequestBadge({ status }: { status: ReviewRequestResponse['status'] }) {
  const { t } = useTranslation('performance')
  const variant =
    status === 'submitted' ? 'default' : status === 'declined' ? 'destructive' : 'secondary'
  return <Badge variant={variant}>{t(`reviews.requestStatus.${status}`)}</Badge>
}

// ─── OKR Tab ─────────────────────────────────────────────────────────────────

function OkrTab() {
  const { api } = useAuth()
  const { t } = useTranslation('performance')
  const queryClient = useQueryClient()

  const [quarter, setQuarter] = useState('')
  const [expandedOkr, setExpandedOkr] = useState<string | null>(null)
  const [updateTarget, setUpdateTarget] = useState<{ okrId: string; krId: string } | null>(null)
  const [newValue, setNewValue] = useState('')

  const query = useQuery({
    queryKey: ['performance', 'okrs', quarter],
    queryFn: () => api.listOkrs(quarter ? { quarter } : undefined),
  })

  const patchKrMutation = useMutation({
    mutationFn: ({ okrId, krId, value }: { okrId: string; krId: string; value: number }) =>
      api.patchOkrKeyResult(okrId, krId, { currentValue: value }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['performance', 'okrs'] })
      setUpdateTarget(null)
      setNewValue('')
      toast.success(t('actions.update'))
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const items = query.data?.items ?? []

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('okr.title')}</h2>
        <label className="flex items-center gap-2 text-sm">
          {t('okr.quarter')}
          <Input
            className="w-32"
            placeholder="2026-Q1"
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
          />
        </label>
      </div>

      {query.isLoading ? (
        <p className="text-muted-foreground">{t('loading')}</p>
      ) : query.isError ? (
        <p className="text-destructive">{t('loadFailed')}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{t('okr.empty')}</p>
      ) : (
        items.map((okr: PerformanceOkrResponse) => (
          <Card key={okr.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => setExpandedOkr(expandedOkr === okr.id ? null : okr.id)}
                >
                  <CardTitle className="text-base">{okr.objective}</CardTitle>
                </button>
                <OkrBadge status={okr.status} />
              </div>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('okr.progress')}:</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${okr.progressPercent}%` }}
                  />
                </div>
                <span>{okr.progressPercent}%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('okr.quarter')}: {okr.quarter}
              </p>

              {expandedOkr === okr.id && okr.keyResults && okr.keyResults.length > 0 && (
                <div className="mt-2 grid gap-2 border-t pt-2">
                  <p className="font-medium">{t('okr.keyResults')}</p>
                  {okr.keyResults.map((kr) => (
                    <div key={kr.id} className="grid gap-1 rounded-md bg-muted/50 p-2">
                      <div className="flex items-center justify-between">
                        <span>{kr.title}</span>
                        <KrBadge status={kr.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('okr.current')}: {kr.currentValue} / {t('okr.target')}: {kr.targetValue}
                        {kr.unit ? ` ${kr.unit}` : ''}
                      </p>
                      <Dialog
                        open={updateTarget?.krId === kr.id}
                        onOpenChange={(open) => {
                          setUpdateTarget(open ? { okrId: okr.id, krId: kr.id } : null)
                          if (!open) setNewValue('')
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline" className="w-fit">
                            {t('okr.updateValue')}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t('okr.updateValue')}</DialogTitle>
                          </DialogHeader>
                          <div className="grid gap-3">
                            <label className="grid gap-1 text-sm">
                              {t('okr.newValue')}
                              <Input
                                type="number"
                                value={newValue}
                                onChange={(e) => setNewValue(e.target.value)}
                              />
                            </label>
                            <Button
                              disabled={!newValue || patchKrMutation.isPending}
                              onClick={() =>
                                patchKrMutation.mutate({
                                  okrId: okr.id,
                                  krId: kr.id,
                                  value: Number(newValue),
                                })
                              }
                            >
                              {t('actions.save')}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

function OkrBadge({ status }: { status: PerformanceOkrResponse['status'] }) {
  const { t } = useTranslation('performance')
  const variant =
    status === 'achieved'
      ? 'default'
      : status === 'missed'
        ? 'destructive'
        : status === 'active'
          ? 'secondary'
          : 'outline'
  return <Badge variant={variant}>{t(`okr.status.${status}`)}</Badge>
}

function KrBadge({ status }: { status: string }) {
  const { t } = useTranslation('performance')
  const variant =
    status === 'achieved'
      ? 'default'
      : status === 'at_risk'
        ? 'destructive'
        : 'secondary'
  return <Badge variant={variant}>{t(`okr.krStatus.${status}`)}</Badge>
}

// ─── IDP Tab ─────────────────────────────────────────────────────────────────

function IdpTab() {
  const { api } = useAuth()
  const { t } = useTranslation('performance')
  const queryClient = useQueryClient()

  const [quarter, setQuarter] = useState('')
  const [expandedIdp, setExpandedIdp] = useState<string | null>(null)
  const [statusTarget, setStatusTarget] = useState<{ idpId: string; itemId: string } | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<string>('planned')

  const query = useQuery({
    queryKey: ['performance', 'idps', quarter],
    queryFn: () => api.listIdps(quarter ? { quarter } : undefined),
  })

  const patchItemMutation = useMutation({
    mutationFn: ({
      idpId,
      itemId,
      status,
    }: {
      idpId: string
      itemId: string
      status: 'planned' | 'in_progress' | 'completed' | 'dropped'
    }) => api.patchIdpItem(idpId, itemId, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['performance', 'idps'] })
      setStatusTarget(null)
      toast.success(t('actions.update'))
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const items = query.data?.items ?? []

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('idp.title')}</h2>
        <label className="flex items-center gap-2 text-sm">
          {t('idp.quarter')}
          <Input
            className="w-32"
            placeholder="2026-Q1"
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
          />
        </label>
      </div>

      {query.isLoading ? (
        <p className="text-muted-foreground">{t('loading')}</p>
      ) : query.isError ? (
        <p className="text-destructive">{t('loadFailed')}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{t('idp.empty')}</p>
      ) : (
        items.map((idp: PerformanceIdpResponse) => (
          <Card key={idp.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => setExpandedIdp(expandedIdp === idp.id ? null : idp.id)}
                >
                  <CardTitle className="text-base">
                    {idp.summary ?? `IDP · ${idp.quarter}`}
                  </CardTitle>
                </button>
                <IdpBadge status={idp.status} />
              </div>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {idp.progress != null && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{t('idp.progress')}:</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${idp.progress}%` }}
                    />
                  </div>
                  <span>{idp.progress}%</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t('idp.quarter')}: {idp.quarter}
              </p>

              {expandedIdp === idp.id && idp.items && idp.items.length > 0 && (
                <div className="mt-2 grid gap-2 border-t pt-2">
                  <p className="font-medium">{t('idp.items')}</p>
                  {idp.items.map((item) => (
                    <div key={item.id} className="grid gap-1 rounded-md bg-muted/50 p-2">
                      <div className="flex items-center justify-between">
                        <span>{item.title}</span>
                        <IdpItemBadge status={item.status} />
                      </div>
                      {item.dueDate && (
                        <p className="text-xs text-muted-foreground">
                          {t('idp.dueDate')}: {item.dueDate}
                        </p>
                      )}
                      <Dialog
                        open={statusTarget?.itemId === item.id}
                        onOpenChange={(open) => {
                          setStatusTarget(open ? { idpId: idp.id, itemId: item.id } : null)
                          if (open) setSelectedStatus(item.status)
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline" className="w-fit">
                            {t('idp.changeStatus')}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t('idp.changeStatus')}</DialogTitle>
                          </DialogHeader>
                          <div className="grid gap-3">
                            <div className="grid gap-2">
                              {(['planned', 'in_progress', 'completed', 'dropped'] as const).map(
                                (s) => (
                                  <label key={s} className="flex items-center gap-2 text-sm">
                                    <input
                                      type="radio"
                                      name="idp-item-status"
                                      value={s}
                                      checked={selectedStatus === s}
                                      onChange={() => setSelectedStatus(s)}
                                    />
                                    {t(`idp.itemStatus.${s}`)}
                                  </label>
                                ),
                              )}
                            </div>
                            <Button
                              disabled={patchItemMutation.isPending}
                              onClick={() =>
                                patchItemMutation.mutate({
                                  idpId: idp.id,
                                  itemId: item.id,
                                  status: selectedStatus as
                                    | 'planned'
                                    | 'in_progress'
                                    | 'completed'
                                    | 'dropped',
                                })
                              }
                            >
                              {t('actions.save')}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

function IdpBadge({ status }: { status: PerformanceIdpResponse['status'] }) {
  const { t } = useTranslation('performance')
  const variant =
    status === 'completed' ? 'default' : status === 'active' ? 'secondary' : 'outline'
  return <Badge variant={variant}>{t(`idp.status.${status}`)}</Badge>
}

function IdpItemBadge({ status }: { status: string }) {
  const { t } = useTranslation('performance')
  const variant =
    status === 'completed'
      ? 'default'
      : status === 'dropped'
        ? 'destructive'
        : status === 'in_progress'
          ? 'secondary'
          : 'outline'
  return <Badge variant={variant}>{t(`idp.itemStatus.${status}`)}</Badge>
}

