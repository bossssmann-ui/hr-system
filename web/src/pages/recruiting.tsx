/**
 * Phase 1B recruiting pages — real data + forms + kanban.
 */

import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { AlertCircleIcon, DatabaseSyncIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Application, ApplicationStage, AssessmentTemplate, Candidate, Interview, OrgUnit, RequisitionStatus, RoleName, Vacancy } from "@web-app-demo/contracts"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Typography } from "@/components/ui/typography"
import { OfferPanel } from "@/components/OfferPanel"
import { ApiRequestError } from "@/lib/api"
import { APPLICATION_STAGES as KANBAN_STAGES } from "@/lib/funnel-stages"
import { hasAnyRole, isAdmin } from "@/lib/roles"
import { useAuth } from "@/lib/use-auth"
import { cn } from "@/lib/utils"

function LoginRequired() {
  const { t } = useTranslation('recruiting')
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-4 px-5 py-16">
      <Badge variant="outline" className="w-fit">{t('common.loginRequired')}</Badge>
      <Typography variant="h2">{t('common.loginRequired')}</Typography>
      <Typography tone="muted">{t('common.loginRequiredHint')}</Typography>
      <Link to="/" className={cn(buttonVariants({ size: "lg" }), "w-fit")}>{t('common:actions.goToAuth')}</Link>
    </section>
  )
}

function LoadingCard() {
  const { t } = useTranslation('recruiting')
  return (
    <Card className="w-fit">
      <CardContent className="flex items-center gap-3 py-8">
        <Spinner aria-hidden />
        <Typography tone="muted">{t('common.loading')}</Typography>
      </CardContent>
    </Card>
  )
}

function ErrorCard({ message }: { message: string }) {
  const { t } = useTranslation('recruiting')
  return (
    <Alert variant="destructive" className="max-w-2xl">
      <AlertTitle>{t('common.errorTitle')}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

const REQUISITION_STATUSES: RequisitionStatus[] = [
  "draft", "submitted", "manager_approved", "hr_approved", "approved", "in_recruitment", "closed", "rejected",
]

function getStatusLabel(t: TFunction, status: RequisitionStatus): string {
  return t(`recruiting:status.${status}`)
}

const STATUS_VARIANT: Record<RequisitionStatus, "default" | "outline" | "secondary"> = {
  draft: "outline", submitted: "outline", manager_approved: "secondary",
  hr_approved: "secondary", approved: "default", in_recruitment: "default",
  closed: "outline", rejected: "outline",
}

const REQUISITION_TRANSITIONS: Array<{ from: RequisitionStatus[]; to: RequisitionStatus; roles: RoleName[] }> = [
  { from: ["draft"], to: "submitted", roles: ["recruiter", "hiring_manager", "hr_admin", "owner"] },
  { from: ["submitted"], to: "manager_approved", roles: ["hiring_manager", "hr_admin", "owner"] },
  { from: ["submitted", "manager_approved"], to: "rejected", roles: ["hiring_manager", "hr_admin", "owner"] },
  { from: ["manager_approved"], to: "hr_approved", roles: ["hr_admin", "owner"] },
  { from: ["hr_approved"], to: "approved", roles: ["hr_admin", "owner"] },
  { from: ["approved"], to: "in_recruitment", roles: ["recruiter", "hr_admin", "owner"] },
  { from: ["in_recruitment"], to: "closed", roles: ["recruiter", "hr_admin", "owner"] },
]

// ─── Requisitions List ────────────────────────────────────────────────────────

export function RequisitionsPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <RequisitionsList />
}

function RequisitionsList() {
  const { api, user } = useAuth()
  const { t } = useTranslation(['recruiting', 'common'])
  const [statusFilter, setStatusFilter] = useState<string>("")

  const query = useQuery({
    queryKey: ["requisitions", "list", statusFilter],
    queryFn: () => api.listRequisitions(statusFilter ? { status: statusFilter } : undefined),
    enabled: Boolean(user),
  })

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-3">
          <Badge variant="outline" className="w-fit">{t('requisitions.badge')}</Badge>
          <Typography variant="h1">{t('requisitions.title')}</Typography>
        </div>
        <Button asChild>
          <Link to="/requisitions/new" data-testid="new-requisition-button">{t('requisitions.newButton')}</Link>
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={statusFilter === "" ? "default" : "outline"} onClick={() => setStatusFilter("")}>{t('requisitions.all')}</Button>
        {REQUISITION_STATUSES.map((s) => (
          <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>{getStatusLabel(t, s)}</Button>
        ))}
      </div>
      {query.isPending ? <LoadingCard />
        : query.isError ? <ErrorCard message={query.error instanceof ApiRequestError ? query.error.message : t('common.unexpectedError')} />
        : query.data.items.length === 0 ? (
          <Card size="sm" className="max-w-3xl"><CardHeader><CardTitle>{t('requisitions.empty.title')}</CardTitle><CardDescription>{t('requisitions.empty.description')}</CardDescription></CardHeader></Card>
        ) : (
          <ul className="grid gap-3" data-testid="requisitions-list">
            {query.data.items.map((r) => (
              <li key={r.id}>
                <Link to="/requisitions/$requisitionId" params={{ requisitionId: r.id }}>
                  <Card size="sm" className="max-w-3xl cursor-pointer hover:bg-muted/50">
                    <CardHeader>
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle>{r.title}</CardTitle>
                        <Badge variant={STATUS_VARIANT[r.status]}>{getStatusLabel(t, r.status)}</Badge>
                      </div>
                      <CardDescription>{r.grade} · {r.salaryMin.toLocaleString()}–{r.salaryMax.toLocaleString()} {r.currency}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )
      }
    </section>
  )
}

// ─── New Requisition ──────────────────────────────────────────────────────────

export function RequisitionsNewPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <RequisitionCreateForm />
}

function RequisitionCreateForm() {
  const { api } = useAuth()
  const { t } = useTranslation(['recruiting', 'common'])
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [formError, setFormError] = useState<string | null>(null)

  const orgUnitsQuery = useQuery({ queryKey: ["org-units"], queryFn: () => api.listOrgUnits() })

  const mutation = useMutation({
    mutationFn: (data: Parameters<typeof api.createRequisition>[0]) => api.createRequisition(data),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ["requisitions"] })
      await navigate({ to: "/requisitions/$requisitionId", params: { requisitionId: r.id } })
    },
    onError: (error: unknown) => {
      setFormError(error instanceof ApiRequestError ? error.message : t('requisitions.errors.createFailed'))
    },
  })

  const form = useForm({
    defaultValues: { orgUnitId: "", title: "", grade: "", salaryMin: "", salaryMax: "", currency: "RUB", justification: "", deadlineAt: "" },
    onSubmit: async ({ value }) => {
      setFormError(null)
      const salaryMin = Number(value.salaryMin)
      const salaryMax = Number(value.salaryMax)
      if (Number.isNaN(salaryMin) || salaryMin < 0) { setFormError(t('requisitions.errors.invalidSalaryMin')); return }
      if (Number.isNaN(salaryMax) || salaryMax < 0) { setFormError(t('requisitions.errors.invalidSalaryMax')); return }
      if (salaryMin > salaryMax) { setFormError(t('requisitions.errors.salaryOrder')); return }
      mutation.mutate({
        orgUnitId: value.orgUnitId, title: value.title, grade: value.grade,
        salaryMin, salaryMax, currency: value.currency as "RUB" | "USD" | "THB" | "USDT",
        justification: value.justification,
        ...(value.deadlineAt ? { deadlineAt: new Date(value.deadlineAt).toISOString() } : {}),
      })
    },
  })

  if (orgUnitsQuery.isPending) return <LoadingCard />
  const orgUnits: OrgUnit[] = orgUnitsQuery.data?.items ?? []

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">{t('requisitions.badge')}</Badge>
        <Typography variant="h1">{t('requisitions.newTitle')}</Typography>
      </div>
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={(e) => { e.preventDefault(); void form.handleSubmit() }} data-testid="requisition-form">
            <FieldGroup className="gap-4">
              <form.Field name="orgUnitId" children={(field) => (
                <Field>
                  <FieldLabel htmlFor="orgUnitId">{t('requisitions.fields.orgUnit')}</FieldLabel>
                  <select id="orgUnitId" name={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" data-testid="org-unit-select">
                    <option value="">{t('requisitions.fields.orgUnitPlaceholder')}</option>
                    {orgUnits.map((ou) => <option key={ou.id} value={ou.id}>{ou.name}</option>)}
                  </select>
                </Field>
              )} />
              <form.Field name="title" children={(field) => (
                <Field>
                  <FieldLabel htmlFor="title">{t('requisitions.fields.title')}</FieldLabel>
                  <Input id="title" name={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder={t('requisitions.fields.titlePlaceholder')} data-testid="title-input" />
                </Field>
              )} />
              <form.Field name="grade" children={(field) => (
                <Field>
                  <FieldLabel htmlFor="grade">{t('requisitions.fields.grade')}</FieldLabel>
                  <Input id="grade" name={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder={t('requisitions.fields.gradePlaceholder')} />
                </Field>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <form.Field name="salaryMin" children={(field) => (
                  <Field>
                    <FieldLabel htmlFor="salaryMin">{t('requisitions.fields.salaryMin')}</FieldLabel>
                    <Input id="salaryMin" name={field.name} type="number" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} data-testid="salary-min-input" />
                  </Field>
                )} />
                <form.Field name="salaryMax" children={(field) => (
                  <Field>
                    <FieldLabel htmlFor="salaryMax">{t('requisitions.fields.salaryMax')}</FieldLabel>
                    <Input id="salaryMax" name={field.name} type="number" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} data-testid="salary-max-input" />
                  </Field>
                )} />
              </div>
              <form.Field name="currency" children={(field) => (
                <Field>
                  <FieldLabel htmlFor="currency">{t('requisitions.fields.currency')}</FieldLabel>
                  <select id="currency" name={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="RUB">RUB</option>
                    <option value="USD">USD</option>
                    <option value="THB">THB</option>
                    <option value="USDT">USDT</option>
                  </select>
                </Field>
              )} />
              <form.Field name="justification" children={(field) => (
                <Field>
                  <FieldLabel htmlFor="justification">{t('requisitions.fields.justification')}</FieldLabel>
                  <textarea id="justification" name={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)}
                    rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder={t('requisitions.fields.justificationPlaceholder')} data-testid="justification-input" />
                </Field>
              )} />
              <form.Field name="deadlineAt" children={(field) => (
                <Field>
                  <FieldLabel htmlFor="deadlineAt">{t('requisitions.fields.deadline')}</FieldLabel>
                  <Input id="deadlineAt" name={field.name} type="date" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                </Field>
              )} />
              {formError && <Alert variant="destructive"><AlertTitle>{t('common.errorTitle')}</AlertTitle><AlertDescription>{formError}</AlertDescription></Alert>}
              <div className="flex gap-3">
                <form.Subscribe selector={(s) => s.isSubmitting} children={(isSubmitting) => (
                  <Button type="submit" disabled={isSubmitting || mutation.isPending} data-testid="submit-button">
                    {isSubmitting || mutation.isPending ? t('requisitions.submit.creating') : t('requisitions.submit.create')}
                  </Button>
                )} />
                <Button type="button" variant="outline" asChild><Link to="/requisitions">{t('common:actions.cancel')}</Link></Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </section>
  )
}

// ─── Requisition Detail ───────────────────────────────────────────────────────

export function RequisitionDetailPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <RequisitionDetail />
}

function RequisitionDetail() {
  const { api, user } = useAuth()
  const { t } = useTranslation(['recruiting', 'common'])
  const params = useParams({ strict: false }) as { requisitionId?: string }
  const requisitionId = params.requisitionId ?? ""
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ["requisitions", requisitionId],
    queryFn: () => api.getRequisition(requisitionId),
    enabled: Boolean(requisitionId),
  })

  const transitionMutation = useMutation({
    mutationFn: (to: RequisitionStatus) => api.transitionRequisition(requisitionId, { to }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["requisitions"] })
      await queryClient.invalidateQueries({ queryKey: ["vacancies"] })
      toast.success(t('requisitions.toasts.statusUpdated'))
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : t('requisitions.toasts.statusUpdateFailed'))
    },
  })

  if (query.isPending) return <LoadingCard />
  if (query.isError) return <ErrorCard message={t('requisitions.errors.notFound')} />

  const r = query.data
  const availableTransitions = REQUISITION_TRANSITIONS.filter(
    (tr) => tr.from.includes(r.status) && hasAnyRole(user, ...tr.roles),
  )

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6 px-5 py-12">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-3">
          <Badge variant="outline" className="w-fit">{t('requisitions.badge')}</Badge>
          <Typography variant="h1">{r.title}</Typography>
        </div>
        <Badge variant={STATUS_VARIANT[r.status]}>{getStatusLabel(t, r.status)}</Badge>
      </div>
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><Typography tone="muted">{t('requisitions.fields.grade')}</Typography><Typography>{r.grade}</Typography></div>
            <div><Typography tone="muted">{t('requisitions.fields.salaryRange')}</Typography><Typography>{r.salaryMin.toLocaleString()}–{r.salaryMax.toLocaleString()} {r.currency}</Typography></div>
            <div><Typography tone="muted">{t('requisitions.fields.created')}</Typography><Typography>{new Date(r.createdAt).toLocaleDateString()}</Typography></div>
            {r.deadlineAt && <div><Typography tone="muted">{t('requisitions.fields.deadlineShort')}</Typography><Typography>{new Date(r.deadlineAt).toLocaleDateString()}</Typography></div>}
          </div>
          <div className="border-t pt-4">
            <Typography tone="muted" variant="bodySm">{t('requisitions.fields.justification')}</Typography>
            <Typography>{r.justification}</Typography>
          </div>
        </CardContent>
      </Card>
      {availableTransitions.length > 0 && (
        <div className="grid gap-3">
          <Typography variant="h3">{t('requisitions.actions')}</Typography>
          <div className="flex flex-wrap gap-2">
            {availableTransitions.map((tr) => (
              <Button key={tr.to} variant={tr.to === "rejected" ? "outline" : "default"}
                disabled={transitionMutation.isPending} onClick={() => transitionMutation.mutate(tr.to)}
                data-testid={"transition-" + tr.to}>
                {transitionMutation.isPending ? t('common.working') : t(`transitions.${tr.to}`)}
              </Button>
            ))}
          </div>
        </div>
      )}
      <Button variant="outline" asChild className="w-fit"><Link to="/requisitions">{t('requisitions.backToList')}</Link></Button>
    </section>
  )
}

// ─── Vacancies ────────────────────────────────────────────────────────────────

export function VacanciesPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <VacanciesList />
}

function VacanciesList() {
  const { api, user } = useAuth()
  const { t } = useTranslation('recruiting')
  const queryClient = useQueryClient()

  const query = useQuery({ queryKey: ["vacancies"], queryFn: () => api.listVacancies(), enabled: Boolean(user) })

  const publishMutation = useMutation({
    mutationFn: ({ id, isPublished }: { id: string; isPublished: boolean }) => api.publishVacancy(id, { isPublished }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vacancies"] }),
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : t('vacancies.publishFailed')),
  })

  if (query.isPending) return <LoadingCard />
  if (query.isError) return <ErrorCard message={t('vacancies.loadFailed')} />

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">{t('vacancies.badge')}</Badge>
        <Typography variant="h1">{t('vacancies.title')}</Typography>
      </div>
      {query.data.items.length === 0 ? (
        <Card size="sm" className="max-w-3xl"><CardHeader><CardTitle>{t('vacancies.empty.title')}</CardTitle><CardDescription>{t('vacancies.empty.description')}</CardDescription></CardHeader></Card>
      ) : (
        <ul className="grid gap-3">
          {query.data.items.map((v: Vacancy) => (
            <li key={v.id}>
              <Card size="sm" className="max-w-3xl">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle><Link to="/vacancies/$vacancyId" params={{ vacancyId: v.id }} className="hover:underline">{v.title}</Link></CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant={v.isPublished ? "default" : "outline"}>{v.isPublished ? t('vacancies.published') : t('vacancies.draft')}</Badge>
                      <Button size="sm" variant="outline" disabled={publishMutation.isPending}
                        onClick={() => publishMutation.mutate({ id: v.id, isPublished: !v.isPublished })}
                        data-testid={"publish-toggle-" + v.id}>
                        {v.isPublished ? t('vacancies.unpublish') : t('vacancies.publish')}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function VacancyDetailPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <VacancyDetail />
}

function VacancyDetail() {
  const { api } = useAuth()
  const { t } = useTranslation('recruiting')
  const params = useParams({ strict: false }) as { vacancyId?: string }
  const vacancyId = params.vacancyId ?? ""

  const query = useQuery({ queryKey: ["vacancies", vacancyId], queryFn: () => api.getVacancy(vacancyId), enabled: Boolean(vacancyId) })

  if (query.isPending) return <LoadingCard />
  if (query.isError) return <ErrorCard message={t('vacancies.notFound')} />

  const v = query.data

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6 px-5 py-12">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-3">
          <Badge variant="outline" className="w-fit">{t('vacancies.badge')}</Badge>
          <Typography variant="h1">{v.title}</Typography>
        </div>
        <Badge variant={v.isPublished ? "default" : "outline"}>{v.isPublished ? t('vacancies.published') : t('vacancies.draft')}</Badge>
      </div>
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <Typography>{v.description}</Typography>
          <div className="border-t pt-4">
            <Typography tone="muted" variant="bodySm">{t('requisitions.fields.created')} {new Date(v.createdAt).toLocaleDateString()}</Typography>
          </div>
        </CardContent>
      </Card>
      <div className="flex gap-3">
        <Button asChild><Link to="/applications">{t('vacancies.viewApplications')}</Link></Button>
        <Button variant="outline" asChild><Link to="/vacancies">{t('vacancies.back')}</Link></Button>
      </div>
    </section>
  )
}

// ─── Candidates ───────────────────────────────────────────────────────────────

export function CandidatesPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <CandidatesList />
}

function CandidatesList() {
  const { api, user } = useAuth()
  const { t } = useTranslation(['recruiting', 'common'])
  const [search, setSearch] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ["candidates", search],
    queryFn: () => api.listCandidates(search ? { q: search } : undefined),
    enabled: Boolean(user),
  })

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.createCandidate>[0]) => api.createCandidate(data),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["candidates"] })
      if (result.deduped) { toast.info(t('candidates.toasts.deduped')) } else { toast.success(t('candidates.toasts.created')) }
      setShowForm(false); setFormError(null)
    },
    onError: (error: unknown) => setFormError(error instanceof ApiRequestError ? error.message : t('candidates.toasts.createFailed')),
  })

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-3">
          <Badge variant="outline" className="w-fit">{t('candidates.badge')}</Badge>
          <Typography variant="h1">{t('candidates.title')}</Typography>
        </div>
        <Button onClick={() => { setShowForm(!showForm); setFormError(null) }} data-testid="new-candidate-button">
          {showForm ? t('common:actions.cancel') : t('candidates.newButton')}
        </Button>
      </div>
      {showForm && (
        <Card className="max-w-lg">
          <CardHeader><CardTitle>{t('candidates.addCardTitle')}</CardTitle></CardHeader>
          <CardContent>
            <NewCandidateForm onSubmit={(data) => createMutation.mutate(data)} isLoading={createMutation.isPending} error={formError} />
          </CardContent>
        </Card>
      )}
      <Input placeholder={t('candidates.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" data-testid="candidate-search" />
      {query.isPending ? <LoadingCard />
        : query.isError ? <ErrorCard message={t('candidates.loadFailed')} />
        : query.data.items.length === 0 ? (
          <Card size="sm" className="max-w-3xl"><CardHeader><CardTitle>{t('candidates.empty')}</CardTitle></CardHeader></Card>
        ) : (
          <ul className="grid gap-3">
            {query.data.items.map((c) => (
              <li key={c.id}>
                <Card size="sm" className="max-w-3xl">
                  <CardHeader>
                    <CardTitle>{c.fullName}</CardTitle>
                    <CardDescription>{[c.email, c.phone, c.location].filter(Boolean).join(" · ")}</CardDescription>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ul>
        )
      }
    </section>
  )
}

function NewCandidateForm({ onSubmit, isLoading, error }: { onSubmit: (data: { fullName: string; email?: string; phone?: string; location?: string }) => void; isLoading: boolean; error: string | null }) {
  const { t } = useTranslation('recruiting')
  const form = useForm({
    defaultValues: { fullName: "", email: "", phone: "", location: "" },
    onSubmit: ({ value }) => {
      const data: Parameters<typeof onSubmit>[0] = { fullName: value.fullName }
      if (value.email) data.email = value.email
      if (value.phone) data.phone = value.phone
      if (value.location) data.location = value.location
      onSubmit(data)
    },
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); void form.handleSubmit() }}>
      <FieldGroup className="gap-3">
        <form.Field name="fullName" children={(field) => (<Field><FieldLabel htmlFor="cand-fullName">{t('candidates.fields.fullName')}</FieldLabel><Input id="cand-fullName" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} data-testid="candidate-fullname" /></Field>)} />
        <form.Field name="email" children={(field) => (<Field><FieldLabel htmlFor="cand-email">{t('candidates.fields.email')}</FieldLabel><Input id="cand-email" type="email" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} data-testid="candidate-email" /></Field>)} />
        <form.Field name="phone" children={(field) => (<Field><FieldLabel htmlFor="cand-phone">{t('candidates.fields.phone')}</FieldLabel><Input id="cand-phone" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} /></Field>)} />
        <form.Field name="location" children={(field) => (<Field><FieldLabel htmlFor="cand-location">{t('candidates.fields.location')}</FieldLabel><Input id="cand-location" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} /></Field>)} />
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" disabled={isLoading} data-testid="create-candidate-submit">{isLoading ? t('common.creating') : t('candidates.add')}</Button>
      </FieldGroup>
    </form>
  )
}

// ─── Applications Kanban ──────────────────────────────────────────────────────

const APP_TRANSITIONS: Partial<Record<ApplicationStage, ApplicationStage[]>> = {
  new: ["screen", "rejected"],
  screen: ["new", "tech", "rejected"],
  tech: ["new", "screen", "final", "rejected"],
  final: ["new", "screen", "tech", "offer", "rejected"],
  offer: ["new", "screen", "tech", "final", "hired", "rejected"],
}

function aiScoreBadge(t: TFunction, scoring: Record<string, unknown> | null | undefined) {
  const status = typeof scoring?.status === "string" ? scoring.status : "pending"
  if (status === "not_configured") {
    return { label: t('applications.ai.badge.notConfigured'), className: "border-zinc-300 text-zinc-600", summary: t('applications.ai.summary.notConfigured'), attention: false }
  }
  if (status === "failed") {
    const failure = typeof scoring?.failure === "object" && scoring.failure ? scoring.failure as Record<string, unknown> : null
    return { label: t('applications.ai.badge.failed'), className: "border-red-300 text-red-700", summary: typeof failure?.error === "string" ? failure.error : t('applications.ai.summary.failed'), attention: false }
  }
  if (status === "pending") {
    return { label: t('applications.ai.badge.pending'), className: "border-zinc-300 text-zinc-600", summary: t('applications.ai.summary.inProgress'), attention: false }
  }
  if (status === "not_scored") {
    return { label: t('applications.ai.badge.notScored'), className: "border-zinc-300 text-zinc-600", summary: t('applications.ai.summary.noScore'), attention: false }
  }
  const result = typeof scoring?.result === "object" && scoring.result ? scoring.result as Record<string, unknown> : null
  if (!result) return { label: t('applications.ai.badge.notScored'), className: "border-zinc-300 text-zinc-600", summary: t('applications.ai.summary.notScored'), attention: false }
  const score = typeof result.relevance_score === "number" ? result.relevance_score : 0
  const attention = score >= 60 && score <= 69
  const className = score >= 75
    ? "border-emerald-300 text-emerald-700"
    : attention || score >= 50
      ? "border-amber-300 text-amber-700"
      : "border-red-300 text-red-700"
  return { label: t('applications.ai.badge.scored', { score }), className, summary: typeof result.summary === "string" ? result.summary : t('applications.ai.summary.scored'), attention }
}

function canMoveStage(from: ApplicationStage, to: ApplicationStage): boolean {
  return Boolean(APP_TRANSITIONS[from]?.includes(to))
}

export function ApplicationsPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <KanbanBoard />
}

function KanbanBoard() {
  const { api, user } = useAuth()
  const { t } = useTranslation(['recruiting', 'common'])
  const queryClient = useQueryClient()
  const [vacancyFilter, setVacancyFilter] = useState("")
  const [dragging, setDragging] = useState<{ id: string; from: ApplicationStage } | null>(null)
  const [showNewAppForm, setShowNewAppForm] = useState(false)
  const [appFormError, setAppFormError] = useState<string | null>(null)

  const vacanciesQuery = useQuery({ queryKey: ["vacancies"], queryFn: () => api.listVacancies(), enabled: Boolean(user) })
  const applicationsQuery = useQuery({
    queryKey: ["applications", vacancyFilter],
    queryFn: () => api.listApplications(vacancyFilter ? { vacancyId: vacancyFilter } : undefined),
    enabled: Boolean(user),
  })
  const candidatesQuery = useQuery({ queryKey: ["candidates", ""], queryFn: () => api.listCandidates(), enabled: Boolean(user) })

  const stageMutation = useMutation({
    mutationFn: ({ id, to }: { id: string; to: ApplicationStage }) => api.moveApplicationStage(id, { to }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["applications"] }),
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : t('applications.toasts.moveFailed'))
      void queryClient.invalidateQueries({ queryKey: ["applications"] })
    },
  })

  const createAppMutation = useMutation({
    mutationFn: (data: { candidateId: string; vacancyId: string }) => api.createApplication(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["applications"] })
      toast.success(t('applications.toasts.created')); setShowNewAppForm(false); setAppFormError(null)
    },
    onError: (error: unknown) => setAppFormError(error instanceof ApiRequestError ? error.message : t('applications.toasts.createFailed')),
  })

  const hhSyncMutation = useMutation({
    mutationFn: () => api.syncHhNow(),
    onSuccess: async (result) => {
      toast.success(t('applications.hhSync.success', {
        candidates: result.summary.importedCandidates,
        applications: result.summary.upsertedApplications,
        scanned: result.summary.negotiationsScanned,
      }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["applications"] }),
        queryClient.invalidateQueries({ queryKey: ["candidates"] }),
        queryClient.invalidateQueries({ queryKey: ["vacancies"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "hh", "status"] }),
      ])
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : t('applications.hhSync.failed'))
    },
  })

  const rescoreAllMutation = useMutation({
    mutationFn: () => api.rescoreAllApplications(),
    onSuccess: (result) => {
      toast.success(t('applications.ai.rescoreAllSuccess', { count: result.queued }))
      void queryClient.invalidateQueries({ queryKey: ["applications"] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : t('applications.ai.rescoreAllFailed'))
    },
  })

  const applications: Application[] = applicationsQuery.data?.items ?? []
  const vacancies: Vacancy[] = vacanciesQuery.data?.items ?? []
  const candidates: Candidate[] = candidatesQuery.data?.items ?? []

  function byStage(stage: ApplicationStage) { return applications.filter((a) => a.stage === stage) }

  function handleDrop(to: ApplicationStage) {
    if (!dragging) return
    if (dragging.from === to) { setDragging(null); return }
    if (!canMoveStage(dragging.from, to)) {
      toast.error(t('applications.cannotMove', { from: t(`applications.stages.${dragging.from}`), to: t(`applications.stages.${to}`) }))
      setDragging(null); return
    }
    stageMutation.mutate({ id: dragging.id, to }); setDragging(null)
  }

  function handleRescoreAll() {
    if (!window.confirm(t('applications.ai.rescoreAllConfirm'))) return
    rescoreAllMutation.mutate()
  }

  return (
    <section className="mx-auto grid w-full gap-4 px-5 py-8">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-2">
          <Badge variant="outline" className="w-fit">{t('applications.badge')}</Badge>
          <Typography variant="h1">{t('applications.title')}</Typography>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => hhSyncMutation.mutate()}
            disabled={hhSyncMutation.isPending}
            data-testid="hh-sync-applications-button"
          >
            <HugeiconsIcon
              icon={DatabaseSyncIcon}
              strokeWidth={2}
              className={cn("size-4", hhSyncMutation.isPending ? "animate-spin" : "")}
              aria-hidden
            />
            {hhSyncMutation.isPending ? t('common.syncing') : t('applications.hhSync.button')}
          </Button>
          {isAdmin(user) && (
            <Button
              variant="outline"
              onClick={handleRescoreAll}
              disabled={rescoreAllMutation.isPending}
              data-testid="applications.rescore-all"
            >
              {rescoreAllMutation.isPending ? t('common.queueing') : t('applications.ai.rescoreAll')}
            </Button>
          )}
          <Button onClick={() => { setShowNewAppForm(!showNewAppForm); setAppFormError(null) }} data-testid="new-application-button">
            {showNewAppForm ? t('common:actions.cancel') : t('applications.newButton')}
          </Button>
        </div>
      </div>
      {showNewAppForm && (
        <Card className="max-w-md">
          <CardHeader><CardTitle>{t('applications.cardTitle')}</CardTitle></CardHeader>
          <CardContent>
            <NewApplicationForm vacancies={vacancies} candidates={candidatesQuery.data?.items ?? []}
              onSubmit={(data) => createAppMutation.mutate(data)} isLoading={createAppMutation.isPending} error={appFormError} />
          </CardContent>
        </Card>
      )}
      <div className="flex items-center gap-3">
        <Typography variant="bodySm" tone="muted">{t('applications.filterByVacancy')}</Typography>
        <select value={vacancyFilter} onChange={(e) => setVacancyFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" data-testid="vacancy-filter">
          <option value="">{t('applications.allVacancies')}</option>
          {vacancies.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
        </select>
      </div>
      {applicationsQuery.isPending ? <LoadingCard /> : (
        <div className="flex gap-4 overflow-x-auto pb-4" data-testid="kanban-board">
          {KANBAN_STAGES.map((stage) => {
            const isDropTarget = dragging && dragging.from !== stage && canMoveStage(dragging.from, stage)
            return (
              <div key={stage}
                className={cn("flex min-w-[200px] flex-1 flex-col gap-3 rounded-lg border bg-muted/30 p-3", isDropTarget ? "border-primary/50 bg-primary/5" : "")}
                onDragOver={(e) => e.preventDefault()} onDrop={() => handleDrop(stage)}
                data-testid={"kanban-column-" + stage}>
                <div className="flex items-center justify-between">
                  <Typography variant="bodySm" className="font-semibold">{t(`applications.stages.${stage}`)}</Typography>
                  <Badge variant="outline" className="text-xs">{byStage(stage).length}</Badge>
                </div>
                <div className="grid gap-2">
                  {byStage(stage).map((app) => {
                    const vac = vacancies.find((v) => v.id === app.vacancyId)
                    const candidate = candidates.find((item) => item.id === app.candidateId)
                    const scoreBadge = aiScoreBadge(t, (app.aiScoring ?? null) as Record<string, unknown> | null)
                    return (
                      <div key={app.id} draggable onDragStart={() => setDragging({ id: app.id, from: app.stage })} onDragEnd={() => setDragging(null)}
                        className={cn(
                          "cursor-grab rounded-md border bg-background p-3 shadow-sm active:cursor-grabbing",
                          scoreBadge.attention ? "border-amber-300 bg-amber-50/60 shadow-amber-100" : "",
                        )}
                        data-testid={"application-card-" + app.id} data-stage={app.stage}>
                        <div className="flex items-start justify-between gap-2">
                          <Typography variant="bodySm" className="font-medium">{candidate?.fullName ?? app.candidateId.slice(0, 8)}</Typography>
                          <Badge variant="outline" className={cn("gap-1 text-[11px]", scoreBadge.className)} title={scoreBadge.summary}>
                            {scoreBadge.attention && (
                              <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} className="size-3.5 text-amber-600" aria-hidden />
                            )}
                            {scoreBadge.label}
                          </Badge>
                        </div>
                        {vac && <Typography variant="bodySm" tone="muted">{vac.title}</Typography>}
                        <Typography variant="bodySm" className="line-clamp-3">{scoreBadge.summary}</Typography>
                        <Link to="/applications/$applicationId" params={{ applicationId: app.id }} className="text-xs text-primary underline-offset-4 hover:underline">
                          {t('applications.openDetail')}
                        </Link>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function NewApplicationForm({ vacancies, candidates, onSubmit, isLoading, error }: { vacancies: Vacancy[]; candidates: Array<{ id: string; fullName: string }>; onSubmit: (data: { candidateId: string; vacancyId: string }) => void; isLoading: boolean; error: string | null }) {
  const { t } = useTranslation('recruiting')
  const form = useForm({
    defaultValues: { candidateId: "", vacancyId: "" },
    onSubmit: ({ value }) => {
      if (!value.candidateId || !value.vacancyId) return
      onSubmit({ candidateId: value.candidateId, vacancyId: value.vacancyId })
    },
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); void form.handleSubmit() }}>
      <FieldGroup className="gap-3">
        <form.Field name="vacancyId" children={(field) => (
          <Field><FieldLabel htmlFor="app-vacancyId">{t('applications.fields.vacancy')}</FieldLabel>
            <select id="app-vacancyId" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" data-testid="app-vacancy-select">
              <option value="">{t('applications.fields.vacancyPlaceholder')}</option>
              {vacancies.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
            </select>
          </Field>
        )} />
        <form.Field name="candidateId" children={(field) => (
          <Field><FieldLabel htmlFor="app-candidateId">{t('applications.fields.candidate')}</FieldLabel>
            <select id="app-candidateId" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" data-testid="app-candidate-select">
              <option value="">{t('applications.fields.candidatePlaceholder')}</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </select>
          </Field>
        )} />
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" disabled={isLoading} data-testid="create-application-submit">{isLoading ? t('common.creating') : t('applications.create')}</Button>
      </FieldGroup>
    </form>
  )
}

// ─── Application Detail (placeholder) ────────────────────────────────────────

export function ApplicationDetailPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <ApplicationDetail />
}

function ApplicationDetail() {
  const { api } = useAuth()
  const { t } = useTranslation(['recruiting', 'common'])
  const params = useParams({ strict: false }) as { applicationId?: string }
  const applicationId = params.applicationId ?? ""
  const queryClient = useQueryClient()
  const [feedbackNote, setFeedbackNote] = useState("")
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("")
  const [latestInviteLink, setLatestInviteLink] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ["applications", applicationId, "detail"],
    queryFn: () => api.getApplication(applicationId),
    enabled: Boolean(applicationId),
  })

  const templatesQuery = useQuery({
    queryKey: ["assessment-templates"],
    queryFn: () => api.listAssessmentTemplates(),
  })

  const sessionsQuery = useQuery({
    queryKey: ["assessment-sessions", applicationId],
    queryFn: () => api.listAssessmentSessions(applicationId),
    enabled: Boolean(applicationId),
  })

  const rescoreMutation = useMutation({
    mutationFn: () => api.rescoreApplication(applicationId),
    onSuccess: async (result) => {
      if (!result.queued) {
        toast.info(t('applications.ai.summary.notConfigured'))
      } else {
        toast.success(t('applications.ai.rescoreSuccess'))
      }
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : t('applications.ai.rescoreFailed'))
    },
  })

  const feedbackMutation = useMutation({
    mutationFn: (agrees: boolean) =>
      api.submitApplicationScoreFeedback(applicationId, {
        agrees,
        note: feedbackNote.trim() || undefined,
      }),
    onSuccess: async () => {
      toast.success(t('applications.feedback.saved'))
      setFeedbackNote("")
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : t('applications.feedback.saveFailed'))
    },
  })

  const generateQuestionsMutation = useMutation({
    mutationFn: () => api.generateInterviewQuestions(applicationId),
    onSuccess: async () => {
      toast.success(t('applications.questions.success'))
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
      await queryClient.invalidateQueries({ queryKey: ["applications", applicationId, "detail"] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : t('applications.questions.failed'))
    },
  })

  const sendQuestionnaireMutation = useMutation({
    mutationFn: () => api.sendCandidateQuestionnaire(applicationId),
    onSuccess: async (result) => {
      if (result.sent) {
        toast.success(t('applications.questionnaire.sent'))
      } else {
        toast.error(t('applications.questionnaire.failed'))
      }
      await queryClient.invalidateQueries({ queryKey: ["applications", applicationId, "detail"] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : t('applications.questionnaire.failed'))
    },
  })

  const inviteAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!selectedTemplateId) throw new Error("template_required")
      return api.inviteAssessment(selectedTemplateId, { applicationId })
    },
    onSuccess: async (result) => {
      setLatestInviteLink(result.link)
      toast.success(t('applications.assessments.inviteCreated'))
      await queryClient.invalidateQueries({ queryKey: ["assessment-sessions", applicationId] })
    },
    onError: (error: unknown) => {
      if (error instanceof Error && error.message === "template_required") {
        toast.error(t('applications.assessments.selectTemplateFirst'))
        return
      }
      toast.error(error instanceof ApiRequestError ? error.message : t('applications.assessments.inviteFailed'))
    },
  })

  if (query.isPending) return <LoadingCard />
  if (query.isError) return <ErrorCard message={t('applications.notFound')} />

  const app = query.data
  const scoring = (app.aiScoring ?? null) as Record<string, unknown> | null
  const scoreBadge = aiScoreBadge(t, scoring)
  const failure = scoring?.status === "failed" && typeof scoring.failure === "object" && scoring.failure
    ? scoring.failure as Record<string, unknown>
    : null
  const previousScoring = typeof scoring?.previous_scoring === "object" && scoring.previous_scoring
    ? scoring.previous_scoring as Record<string, unknown>
    : null
  const currentResult = scoring?.status === "scored" && typeof scoring.result === "object" && scoring.result
    ? scoring.result as Record<string, unknown>
    : null
  const previousResult = failure && typeof previousScoring?.result === "object" && previousScoring.result
    ? previousScoring.result as Record<string, unknown>
    : null
  const result = currentResult ?? previousResult
  const templates = templatesQuery.data?.items ?? []
  const assessmentSessions = sessionsQuery.data?.items ?? []
  const aiInterviewQuestions = Array.isArray(app.aiInterviewQuestions) ? app.aiInterviewQuestions : []
  const competencies = result ? asCompetencies(result.competencies) : []
  const suggestedSalary = result ? asNumber(result.suggested_salary) : null
  const suggestedGrade = typeof result?.suggested_grade === "string" ? result.suggested_grade : null
  const scoringModel = typeof result?.model === "string" ? result.model : null
  const scoredAt = typeof result?.scored_at === "string" ? result.scored_at : null
  const scoringHistory = asScoringHistory(scoring?.history ?? previousScoring?.history)

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">{t('applications.detailBadge')}</Badge>
        <div className="flex flex-wrap items-center gap-3">
          <Typography variant="h1">{t('applications.detailTitle')}</Typography>
          <Badge variant="outline" className={cn("text-xs", scoreBadge.className)} title={scoreBadge.summary}>{scoreBadge.label}</Badge>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('applications.candidateAndVacancy')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <Typography><span className="font-medium">{t('applications.candidateLabel')}</span> {app.candidate.fullName}</Typography>
          <Typography><span className="font-medium">{t('applications.vacancyLabel')}</span> {app.vacancy.title}</Typography>
          <Typography><span className="font-medium">{t('applications.stageLabel')}</span> {t(`applications.stages.${app.stage}`)}</Typography>
          <Typography tone="muted">{app.vacancy.description}</Typography>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>{t('applications.ai.title')}</CardTitle>
            <CardDescription>{scoreBadge.summary}</CardDescription>
          </div>
          <Button variant="outline" onClick={() => rescoreMutation.mutate()} disabled={rescoreMutation.isPending} data-testid="application-rescore-button">
            {rescoreMutation.isPending ? t('common.queueing') : t('applications.ai.rescore')}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {scoring?.status === "not_configured" && <Typography tone="muted">{t('applications.ai.notConfigured')}</Typography>}
          {scoring?.status === "not_scored" && <Typography tone="muted">{t('applications.ai.noScore')}</Typography>}
          {scoring?.status === "pending" && <Typography tone="muted">{t('applications.ai.inProgress')}</Typography>}
          {failure && (
            <Alert variant="destructive">
              <AlertDescription>{String(failure.error ?? t('applications.ai.summary.failed'))}</AlertDescription>
            </Alert>
          )}
          {result && (
            <div className="grid gap-4">
              <div className="grid gap-1">
                <Typography variant="h3">{t('applications.ai.relevanceScore', { score: String(result.relevance_score) })}</Typography>
                <Typography>{String(result.summary ?? "")}</Typography>
              </div>
              <ScoringList title={t('applications.ai.strengths')} items={asStringList(result.strengths)} />
              <ScoringList title={t('applications.ai.gaps')} items={asStringList(result.gaps)} />
              <ScoringList title={t('applications.ai.softSkillsSignals')} items={asStringList(result.soft_skills_signals)} />
              <ScoringList title={t('applications.ai.redFlags')} items={asStringList(result.red_flags)} />
              <ScoringList title={t('applications.ai.antiFraudSignals')} items={asStringList(result.anti_fraud_signals)} />
              <ScoringList title={t('applications.ai.interviewFocusAreas')} items={asStringList(result.interview_focus_areas)} />
              <div>
                <Typography variant="bodySm" tone="muted">{t('applications.ai.valuesFitHypothesis')}</Typography>
                <Typography>{String(result.values_fit_hypothesis ?? "—")}</Typography>
              </div>
              {(suggestedGrade || suggestedSalary !== null) && (
                <div className="grid gap-1">
                  <Typography variant="bodySm" tone="muted">{t('applications.ai.recommendations')}</Typography>
                  {suggestedGrade && <Typography>{t('applications.ai.suggestedGrade', { grade: suggestedGrade })}</Typography>}
                  {suggestedSalary !== null && <Typography>{t('applications.ai.suggestedSalary', { salary: String(suggestedSalary) })}</Typography>}
                </div>
              )}
              {competencies.length > 0 && (
                <div className="grid gap-2">
                  <Typography variant="bodySm" tone="muted">{t('applications.ai.competencies')}</Typography>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {competencies.map((item) => (
                      <div key={item.name} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Typography variant="bodySm" className="font-medium">{item.name}</Typography>
                          <Badge variant="outline">{item.score}/10</Badge>
                        </div>
                        <Typography variant="bodySm" tone="muted">{item.reasoning}</Typography>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-3">
                <ScoringList title={t('applications.ai.interviewQuestions')} items={asStringList(result.interview_questions)} />
                {asStringList(result.interview_questions).length > 0 && (
                  <Button
                    variant="outline"
                    className="w-fit"
                    onClick={() => sendQuestionnaireMutation.mutate()}
                    disabled={sendQuestionnaireMutation.isPending}
                  >
                    {sendQuestionnaireMutation.isPending ? t('common.queueing') : t('applications.questionnaire.send')}
                  </Button>
                )}
              </div>
              {(scoringModel || scoredAt) && (
                <Typography variant="bodySm" tone="muted">
                  {t('applications.ai.modelInfo', {
                    model: scoringModel ?? "—",
                    date: scoredAt ? new Date(scoredAt).toLocaleString() : "—",
                  })}
                </Typography>
              )}
              {scoringHistory.length > 0 && (
                <div className="grid gap-2">
                  <Typography variant="bodySm" tone="muted">{t('applications.ai.historyTitle')}</Typography>
                  <div className="grid gap-2">
                    {scoringHistory.map((item) => (
                      <div key={`${item.scoredAt}-${item.model}-${item.score}`} className="flex flex-wrap items-center gap-2 rounded-md border p-3">
                        <Badge variant="outline">{item.score}</Badge>
                        <Typography variant="bodySm">
                          {t('applications.ai.historyItem', {
                            model: item.model,
                            date: new Date(item.scoredAt).toLocaleString(),
                          })}
                        </Typography>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('applications.feedback.title')}</CardTitle>
          <CardDescription>{t('applications.feedback.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <textarea
            value={feedbackNote}
            onChange={(e) => setFeedbackNote(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder={t('applications.feedback.notePlaceholder')}
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => feedbackMutation.mutate(true)} disabled={feedbackMutation.isPending}>{t('applications.feedback.agree')}</Button>
            <Button variant="outline" onClick={() => feedbackMutation.mutate(false)} disabled={feedbackMutation.isPending}>{t('applications.feedback.disagree')}</Button>
          </div>
          {app.aiScoreFeedback && (
            <Typography tone="muted" variant="bodySm">
              {t('applications.feedback.last', {
                verdict: app.aiScoreFeedback.agrees ? t('applications.feedback.agree') : t('applications.feedback.disagree'),
                note: app.aiScoreFeedback.note ?? t('applications.feedback.noNote'),
              })}
            </Typography>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>{t('applications.questions.title')}</CardTitle>
            <CardDescription>{t('applications.questions.description')}</CardDescription>
          </div>
          <Button variant="outline" onClick={() => generateQuestionsMutation.mutate()} disabled={generateQuestionsMutation.isPending} data-testid="generate-questions-button">
            {generateQuestionsMutation.isPending ? t('common.generating') : t('applications.questions.generate')}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          {aiInterviewQuestions.length === 0 ? (
            <Typography tone="muted">{t('applications.questions.empty')}</Typography>
          ) : (
            <ul className="grid gap-3">
              {aiInterviewQuestions.map((item, idx) => {
                const question = item as Record<string, unknown>
                return (
                  <li key={idx} className="rounded-md border p-3">
                    <Typography className="font-medium">{String(question.question ?? "—")}</Typography>
                    <Typography variant="bodySm" tone="muted">{String(question.competency ?? "—")}</Typography>
                    <Typography variant="bodySm">{String(question.rationale ?? "—")}</Typography>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('applications.assessments.title')}</CardTitle>
          <CardDescription>{t('applications.assessments.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="min-w-[240px] rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              data-testid="assessment-template-select"
            >
              <option value="">{t('applications.assessments.selectTemplate')}</option>
              {templates.map((template: AssessmentTemplate) => (
                <option key={template.id} value={template.id}>{template.title}</option>
              ))}
            </select>
            <Button
              variant="outline"
              onClick={() => inviteAssessmentMutation.mutate()}
              disabled={!selectedTemplateId || inviteAssessmentMutation.isPending}
              data-testid="assessment-invite-button"
            >
              {inviteAssessmentMutation.isPending ? t('applications.assessments.inviting') : t('applications.assessments.inviteCandidate')}
            </Button>
          </div>
          {latestInviteLink && (
            <Typography variant="bodySm" data-testid="assessment-invite-link">
              {t('applications.assessments.candidateLink')} <a className="underline" href={latestInviteLink}>{latestInviteLink}</a>
            </Typography>
          )}
          {assessmentSessions.length === 0 ? (
            <Typography tone="muted">{t('applications.assessments.empty')}</Typography>
          ) : (
            <ul className="grid gap-2">
              {assessmentSessions.map((session) => {
                const trustSignals = (session.trustSignals ?? {}) as Record<string, unknown>
                const paste = (trustSignals.paste_events ?? {}) as Record<string, unknown>
                const focus = (trustSignals.focus_loss_events ?? {}) as Record<string, unknown>
                const keys = (trustSignals.keystroke_timing ?? {}) as Record<string, unknown>
                return (
                  <li key={session.id} className="rounded-md border p-3" data-testid={"assessment-session-" + session.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={session.trustScore !== null && session.trustScore < 60 ? "destructive" : "outline"}>
                        {t('applications.assessments.trustScore')} {session.trustScore ?? "—"}
                      </Badge>
                      <Badge variant="secondary">{session.status}</Badge>
                    </div>
                    <Typography variant="bodySm" tone="muted">
                      {t('applications.assessments.signals', {
                        paste: String(paste.count ?? 0),
                        focus: String(focus.count ?? 0),
                        keystroke: String(Number(keys.anomaly_flags ?? 0) + Number(keys.burst_events ?? 0)),
                      })}
                    </Typography>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <InterviewPanel applicationId={applicationId} />
      <OfferPanel applicationId={applicationId} />
      <Button variant="outline" asChild className="w-fit"><Link to="/applications">{t('applications.backToKanban')}</Link></Button>
    </section>
  )
}

function ScoringList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="grid gap-1">
      <Typography variant="bodySm" tone="muted">{title}</Typography>
      {items.length === 0 ? <Typography tone="muted">—</Typography> : (
        <ul className="list-disc pl-5 text-sm">
          {items.map((item, idx) => <li key={idx}>{item}</li>)}
        </ul>
      )}
    </div>
  )
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function asCompetencies(value: unknown): Array<{ name: string; score: number; reasoning: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).flatMap(([name, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
    const record = raw as Record<string, unknown>
    const score = asNumber(record.score)
    const reasoning = typeof record.reasoning === "string" ? record.reasoning : ""
    if (score === null || !reasoning) return []
    return [{ name, score, reasoning }]
  })
}

function asScoringHistory(value: unknown): Array<{ score: number; model: string; scoredAt: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
    const entry = raw as Record<string, unknown>
    const result = entry.result && typeof entry.result === "object" && !Array.isArray(entry.result)
      ? entry.result as Record<string, unknown>
      : null
    const score = asNumber(result?.relevance_score)
    const model = typeof result?.model === "string" ? result.model : null
    const scoredAt = typeof result?.scored_at === "string" ? result.scored_at : null
    if (score === null || !model || !scoredAt) return []
    return [{ score, model, scoredAt }]
  }).reverse()
}

// ─── Interview Panel ──────────────────────────────────────────────────────────

const INTERVIEW_STATUS_VARIANT: Record<Interview["status"], "default" | "outline" | "secondary" | "destructive"> = {
  created: "outline",
  transcribing: "secondary",
  transcribed: "secondary",
  protocol_ready: "default",
  failed: "destructive",
}

const TRANSCRIPTION_POLLING_INTERVAL_MS = 3000 // Poll every 3s while transcription is in progress

function InterviewPanel({ applicationId }: { applicationId: string }) {
  const { api } = useAuth()
  const { t } = useTranslation('recruiting')
  const queryClient = useQueryClient()
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null)
  const [showSourceForTerm, setShowSourceForTerm] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const interviewsQuery = useQuery({
    queryKey: ["interviews", applicationId],
    queryFn: () => api.listInterviews(applicationId),
    enabled: Boolean(applicationId),
  })

  const selectedInterviewQuery = useQuery({
    queryKey: ["interviews", "detail", selectedInterviewId],
    queryFn: () => api.getInterview(selectedInterviewId!),
    enabled: Boolean(selectedInterviewId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "transcribing" ? TRANSCRIPTION_POLLING_INTERVAL_MS : false
    },
  })

  const createMutation = useMutation({
    mutationFn: () => api.createInterview({ applicationId }),
    onSuccess: async (interview) => {
      await queryClient.invalidateQueries({ queryKey: ["interviews", applicationId] })
      setSelectedInterviewId(interview.id)
      toast.success(t('interviews.toasts.created'))
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : t('interviews.toasts.createFailed')),
  })

  const consentMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => api.updateInterviewConsent(id, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["interviews", applicationId] })
      await queryClient.invalidateQueries({ queryKey: ["interviews", "detail", selectedInterviewId] })
      toast.success(t('interviews.toasts.consentUpdated'))
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : t('interviews.toasts.consentFailed')),
  })

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => api.uploadInterviewRecording(id, file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["interviews", applicationId] })
      await queryClient.invalidateQueries({ queryKey: ["interviews", "detail", selectedInterviewId] })
      toast.success(t('interviews.toasts.uploaded'))
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : t('interviews.toasts.uploadFailed')),
  })

  const transcribeMutation = useMutation({
    mutationFn: (id: string) => api.triggerTranscription(id),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["interviews", "detail", selectedInterviewId] })
      toast.info(result.queued ? t('interviews.toasts.transcribeQueued') : t('interviews.toasts.transcribeNotConfigured'))
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : t('interviews.toasts.transcribeFailed')),
  })

  const protocolMutation = useMutation({
    mutationFn: (id: string) => api.triggerBuildProtocol(id),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["interviews", "detail", selectedInterviewId] })
      toast.info(result.queued ? t('interviews.toasts.protocolQueued') : t('interviews.toasts.protocolNotConfigured'))
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : t('interviews.toasts.protocolFailed')),
  })

  const interviews = interviewsQuery.data?.items ?? []
  const interview = selectedInterviewQuery.data ?? null

  const transcript = interview?.transcript ?? null
  const protocol = interview?.protocol ?? null
  const offerDraft = interview?.offerDraft ?? null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>{t('interviews.title')}</CardTitle>
            <CardDescription>{t('interviews.description')}</CardDescription>
          </div>
          <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending} data-testid="create-interview-button">
            {createMutation.isPending ? t('common.creating') : t('interviews.new')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {interviewsQuery.isPending && <Typography tone="muted">{t('common.loading')}</Typography>}
        {interviews.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {interviews.map((iv) => (
              <button
                key={iv.id}
                onClick={() => setSelectedInterviewId(iv.id)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm transition-colors",
                  iv.id === selectedInterviewId ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-accent",
                )}
                data-testid={"interview-tab-" + iv.id}
              >
                <Badge variant={INTERVIEW_STATUS_VARIANT[iv.status]} className="mr-1 text-[10px]">{t(`interviews.status.${iv.status}`)}</Badge>
                {new Date(iv.createdAt).toLocaleDateString()}
              </button>
            ))}
          </div>
        )}

        {interview && (
          <div className="grid gap-4">
            {/* ── Consent + upload ── */}
            <div className="flex flex-wrap items-center gap-4 rounded-md border bg-muted/30 p-4">
              <div className="grid gap-1">
                <Typography variant="bodySm" className="font-medium">{t('interviews.consent.title')}</Typography>
                <Typography variant="bodySm" tone="muted">
                  {t('interviews.consent.description')}
                </Typography>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={interview.consentRecorded}
                    onChange={(e) => consentMutation.mutate({ id: interview.id, value: e.target.checked })}
                    disabled={consentMutation.isPending}
                    data-testid="consent-toggle"
                    className="h-4 w-4"
                  />
                  <Typography variant="bodySm">{interview.consentRecorded ? t('interviews.consent.recorded') : t('interviews.consent.notRecorded')}</Typography>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,video/mp4,.mp3,.mp4,.m4a,.wav"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) uploadMutation.mutate({ id: interview.id, file })
                  }}
                  data-testid="recording-file-input"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadMutation.isPending}
                  data-testid="upload-recording-button"
                >
                  {uploadMutation.isPending ? t('common.uploading') : interview.recordingUrl ? t('interviews.upload.replace') : t('interviews.upload.upload')}
                </Button>
              </div>
              {interview.recordingUrl && (
                <Typography variant="bodySm" tone="muted" className="text-xs">{interview.recordingUrl}</Typography>
              )}
              {interview.recordingUrl && interview.consentRecorded && !["transcribed", "protocol_ready"].includes(interview.status) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => transcribeMutation.mutate(interview.id)}
                  disabled={transcribeMutation.isPending}
                  data-testid="transcribe-button"
                >
                  {transcribeMutation.isPending ? t('common.queueing') : t('interviews.transcribe.action')}
                </Button>
              )}
              {interview.status === "transcribed" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => protocolMutation.mutate(interview.id)}
                  disabled={protocolMutation.isPending}
                  data-testid="build-protocol-button"
                >
                  {protocolMutation.isPending ? t('common.queueing') : t('interviews.protocol.build')}
                </Button>
              )}
            </div>

            {/* ── Status ── */}
            <div className="flex items-center gap-2">
              <Typography variant="bodySm">{t('interviews.statusLabel')}</Typography>
              <Badge variant={INTERVIEW_STATUS_VARIANT[interview.status]}>{t(`interviews.status.${interview.status}`)}</Badge>
              {interview.status === "failed" && (
                <Typography variant="bodySm" tone="muted">{t('interviews.failedHint')}</Typography>
              )}
              {!interview.consentRecorded && (
                <Typography variant="bodySm" tone="muted">{t('interviews.consent.blocked')}</Typography>
              )}
            </div>

            {/* ── Transcript viewer ── */}
            {transcript && (
              <div className="grid gap-2">
                <Typography variant="h3">{t('interviews.transcript.title')}</Typography>
                <Typography variant="bodySm" tone="muted">
                  {t('interviews.transcript.providerLine', { provider: transcript.asr_provider, model: transcript.asr_model, language: transcript.language })}
                </Typography>
                <div
                  className="max-h-72 overflow-y-auto rounded-md border bg-muted/20 p-3 space-y-2"
                  data-testid="transcript-viewer"
                >
                  {transcript.segments.map((seg, idx) => (
                    <div key={idx} className="grid gap-0.5">
                      <Typography variant="bodySm" className="font-semibold">
                        {seg.speaker}{" "}
                        <span className="font-normal text-muted-foreground text-xs">
                          ({msToTimestamp(seg.start_ms)}–{msToTimestamp(seg.end_ms)})
                        </span>
                      </Typography>
                      <Typography variant="bodySm">{seg.text}</Typography>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Protocol panel ── */}
            {protocol && (
              <div className="grid gap-3" data-testid="protocol-panel">
                <Typography variant="h3">{t('interviews.protocol.title')}</Typography>
                <Typography variant="bodySm" tone="muted">
                  {t('interviews.protocol.generatedBy', { model: protocol.model, date: new Date(protocol.generated_at).toLocaleString() })}
                </Typography>
                <div className="grid gap-1">
                  <Typography variant="bodySm" className="font-medium">{t('interviews.protocol.summary')}</Typography>
                  <Typography variant="bodySm">{protocol.summary}</Typography>
                </div>
                <ScoringList title={t('interviews.protocol.strengths')} items={protocol.strengths} />
                <ScoringList title={t('interviews.protocol.concerns')} items={protocol.concerns} />
                {protocol.questions_and_answers.length > 0 && (
                  <div className="grid gap-2">
                    <Typography variant="bodySm" tone="muted" className="font-medium">{t('interviews.protocol.qa')}</Typography>
                    {protocol.questions_and_answers.map((qa, idx) => (
                      <div key={idx} className="rounded-md border bg-muted/20 p-3 grid gap-1">
                        <Typography variant="bodySm" className="font-medium">{t('interviews.protocol.qPrefix')} {qa.question}</Typography>
                        <Typography variant="bodySm">{t('interviews.protocol.aPrefix')} {qa.answer}</Typography>
                      </div>
                    ))}
                  </div>
                )}
                {/* Agreed terms with quote-links */}
                <div className="grid gap-2">
                  <Typography variant="bodySm" className="font-medium">{t('interviews.agreedTerm.title')}</Typography>
                  <div className="grid gap-2 rounded-md border p-3 bg-muted/20">
                    {protocol.agreed_terms.salary != null && (
                      <AgreedTermRow
                        label={t('interviews.agreedTerm.salary')}
                        value={`${protocol.agreed_terms.salary} ${protocol.agreed_terms.currency ?? ""}`}
                        source={protocol.agreed_terms.salary_source ?? null}
                        isOpen={showSourceForTerm === "salary"}
                        onToggle={() => setShowSourceForTerm(showSourceForTerm === "salary" ? null : "salary")}
                        transcript={transcript}
                      />
                    )}
                    {protocol.agreed_terms.start_date && (
                      <AgreedTermRow
                        label={t('interviews.agreedTerm.startDate')}
                        value={protocol.agreed_terms.start_date}
                        source={protocol.agreed_terms.start_date_source ?? null}
                        isOpen={showSourceForTerm === "start_date"}
                        onToggle={() => setShowSourceForTerm(showSourceForTerm === "start_date" ? null : "start_date")}
                        transcript={transcript}
                      />
                    )}
                    {protocol.agreed_terms.special_conditions.map((cond, idx) => (
                      <AgreedTermRow
                        key={idx}
                        label={t('interviews.agreedTerm.condition', { n: idx + 1 })}
                        value={cond}
                        source={protocol.agreed_terms.special_conditions_sources?.[idx] ?? null}
                        isOpen={showSourceForTerm === `cond_${idx}`}
                        onToggle={() => setShowSourceForTerm(showSourceForTerm === `cond_${idx}` ? null : `cond_${idx}`)}
                        transcript={transcript}
                      />
                    ))}
                    {protocol.agreed_terms.salary == null && !protocol.agreed_terms.start_date && protocol.agreed_terms.special_conditions.length === 0 && (
                      <Typography variant="bodySm" tone="muted">{t('interviews.agreedTerm.empty')}</Typography>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Offer Draft panel ── */}
            {offerDraft && (
              <div className="grid gap-3 rounded-md border bg-muted/20 p-4" data-testid="offer-draft-panel">
                <div className="flex items-center gap-2">
                  <Typography variant="h3">{t('interviews.offerDraft.title')}</Typography>
                  <Badge variant="outline">{t('interviews.offerDraft.draft')}</Badge>
                  <Typography variant="bodySm" tone="muted" className="text-xs ml-auto">
                    {t('interviews.offerDraft.phaseHint')}
                  </Typography>
                </div>
                <div className="grid gap-2 text-sm">
                  {offerDraft.salary != null && (
                    <div className="flex gap-2">
                      <Typography variant="bodySm" className="font-medium w-28">{t('interviews.agreedTerm.salary')}</Typography>
                      <Typography variant="bodySm">{offerDraft.salary} {offerDraft.currency ?? ""}</Typography>
                    </div>
                  )}
                  {offerDraft.start_date && (
                    <div className="flex gap-2">
                      <Typography variant="bodySm" className="font-medium w-28">{t('interviews.agreedTerm.startDate')}</Typography>
                      <Typography variant="bodySm">{offerDraft.start_date}</Typography>
                    </div>
                  )}
                  {offerDraft.conditions.length > 0 && (
                    <div className="flex gap-2">
                      <Typography variant="bodySm" className="font-medium w-28">{t('interviews.offerDraft.conditions')}</Typography>
                      <ul className="list-disc pl-5">
                        {offerDraft.conditions.map((cond, idx) => (
                          <li key={idx}><Typography variant="bodySm">{cond}</Typography></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {offerDraft.salary == null && !offerDraft.start_date && offerDraft.conditions.length === 0 && (
                    <Typography variant="bodySm" tone="muted">{t('interviews.offerDraft.empty')}</Typography>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {interviews.length === 0 && !interviewsQuery.isPending && (
          <Typography tone="muted">{t('interviews.empty')}</Typography>
        )}
      </CardContent>
    </Card>
  )
}

type TermSource = { segment_index: number; quote: string } | null

function AgreedTermRow({
  label,
  value,
  source,
  isOpen,
  onToggle,
  transcript,
}: {
  label: string
  value: string
  source: TermSource
  isOpen: boolean
  onToggle: () => void
  transcript: Interview["transcript"]
}) {
  const { t } = useTranslation('recruiting')
  const segment = transcript?.segments?.[source?.segment_index ?? -1] ?? null

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <Typography variant="bodySm" className="font-medium w-28">{label}</Typography>
        <Typography variant="bodySm">{value}</Typography>
        {source && (
          <button
            onClick={onToggle}
            className="ml-auto text-xs text-primary underline-offset-4 hover:underline"
            data-testid={"source-link-" + label.replace(/\s+/g, "-").toLowerCase()}
          >
            {isOpen ? t('interviews.agreedTerm.hideSource') : t('interviews.agreedTerm.showSource')}
          </button>
        )}
      </div>
      {isOpen && source && (
        <div className="rounded-md border bg-background p-3 text-xs ml-28 grid gap-1">
          <Typography variant="bodySm" tone="muted">{t('interviews.agreedTerm.quoteFromSegment', { idx: source.segment_index })}</Typography>
          <Typography variant="bodySm" className="italic">"{source.quote}"</Typography>
          {segment && (
            <Typography variant="bodySm" tone="muted">
              {t('interviews.agreedTerm.speakerLine', { speaker: segment.speaker, start: msToTimestamp(segment.start_ms), end: msToTimestamp(segment.end_ms) })}
            </Typography>
          )}
        </div>
      )}
    </div>
  )
}

function msToTimestamp(ms: number): string {
  const totalSecs = Math.floor(ms / 1000)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

// ─── Admin Users ──────────────────────────────────────────────────────────────

export function AdminUsersPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <AdminUsersList />
}

function AdminUsersList() {
  const { api, user } = useAuth()
  const { t } = useTranslation('recruiting')
  const query = useQuery({ queryKey: ["admin", "users"], queryFn: () => api.listAdminUsers(), enabled: Boolean(user) })

  if (query.isPending) return <LoadingCard />
  if (query.isError) return <ErrorCard message={query.error instanceof ApiRequestError && query.error.status === 403 ? t('common.accessDenied') : t('admin.users.loadFailed')} />

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3"><Badge variant="outline" className="w-fit">{t('admin.badge')}</Badge><Typography variant="h1">{t('admin.users.title')}</Typography></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b"><th className="py-2 text-left font-medium">{t('admin.users.fields.name')}</th><th className="py-2 text-left font-medium">{t('admin.users.fields.email')}</th><th className="py-2 text-left font-medium">{t('admin.users.fields.roles')}</th><th className="py-2 text-left font-medium">{t('admin.users.fields.joined')}</th></tr></thead>
          <tbody>
            {query.data.items.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="py-2">{u.displayName ?? "—"}</td>
                <td className="py-2">{u.email}</td>
                <td className="py-2"><div className="flex flex-wrap gap-1">{u.roles.map((role) => <Badge key={role} variant="outline" className="text-xs">{role}</Badge>)}</div></td>
                <td className="py-2">{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ─── Admin Audit Log ──────────────────────────────────────────────────────────

export function AdminAuditLogPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <AdminAuditLog />
}

// ─── Admin HH Integration ──────────────────────────────────────────────────────

export function AdminHhIntegrationPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <AdminHhIntegration />
}

function AdminHhIntegration() {
  const { api, user } = useAuth()
  const { t } = useTranslation('recruiting')
  const queryClient = useQueryClient()
  const [hhVacancyInputs, setHhVacancyInputs] = useState<Record<string, string>>({})
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const oauthCodeHandledRef = useRef<string | null>(null)

  const statusQuery = useQuery({
    queryKey: ["admin", "hh", "status"],
    queryFn: () => api.getHhIntegrationStatus(),
    enabled: Boolean(user),
  })

  const vacanciesQuery = useQuery({
    queryKey: ["vacancies"],
    queryFn: () => api.listVacancies(),
    enabled: Boolean(user),
  })

  const connectMutation = useMutation({
    mutationFn: async () => {
      const redirectUri = `${window.location.origin}/admin/integrations/hh`
      const result = await api.getHhAuthorizeUrl({ redirectUri })
      if (!result.authorizeUrl) {
        throw new Error(result.reason ?? t('admin.hh.toasts.authorizeUnavailable'))
      }
      window.location.href = result.authorizeUrl
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t('admin.hh.toasts.prepareFailed'))
    },
  })

  const callbackMutation = useMutation({
    mutationFn: ({ code, redirectUri }: { code: string; redirectUri: string }) => api.completeHhOAuth({ code, redirectUri }),
    onSuccess: async () => {
      toast.success(t('admin.hh.toasts.connected'))
      await queryClient.invalidateQueries({ queryKey: ["admin", "hh", "status"] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : t('admin.hh.toasts.completeFailed'))
    },
  })

  const syncMutation = useMutation({
    mutationFn: () => api.syncHhNow(),
    onSuccess: async (result) => {
      setSyncResult(t('admin.hh.toasts.syncResult', {
        candidates: result.summary.importedCandidates,
        applications: result.summary.upsertedApplications,
        scanned: result.summary.negotiationsScanned,
      }))
      toast.success(t('admin.hh.toasts.syncCompleted'))
      await queryClient.invalidateQueries({ queryKey: ["admin", "hh", "status"] })
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
      await queryClient.invalidateQueries({ queryKey: ["candidates"] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : t('admin.hh.toasts.syncFailed'))
    },
  })

  const linkMutation = useMutation({
    mutationFn: ({ vacancyId, hhVacancyId }: { vacancyId: string; hhVacancyId: string | null }) =>
      api.linkVacancyToHh(vacancyId, { hhVacancyId }),
    onSuccess: async () => {
      toast.success(t('admin.hh.toasts.mappingUpdated'))
      await queryClient.invalidateQueries({ queryKey: ["vacancies"] })
      await queryClient.invalidateQueries({ queryKey: ["admin", "hh", "status"] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : t('admin.hh.toasts.mappingFailed'))
    },
  })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get("code")
    if (!code) return
    if (oauthCodeHandledRef.current === code || callbackMutation.isPending) return
    oauthCodeHandledRef.current = code
    const redirectUri = `${window.location.origin}/admin/integrations/hh`
    callbackMutation.mutate({ code, redirectUri })
    params.delete("code")
    params.delete("state")
    const next = params.toString()
    const cleanUrl = next.length > 0 ? `${window.location.pathname}?${next}` : window.location.pathname
    window.history.replaceState({}, "", cleanUrl)
  }, [])

  const vacancies = vacanciesQuery.data?.items ?? []

  const vacancyInputValues = useMemo(() => {
    const initial: Record<string, string> = {}
    for (const vacancy of vacancies) {
      initial[vacancy.id] = hhVacancyInputs[vacancy.id] ?? vacancy.hhVacancyId ?? ""
    }
    return initial
  }, [vacancies, hhVacancyInputs])

  if (statusQuery.isPending || vacanciesQuery.isPending) return <LoadingCard />
  if (statusQuery.isError) {
    return <ErrorCard message={statusQuery.error instanceof ApiRequestError ? statusQuery.error.message : t('admin.hh.toasts.statusLoadFailed')} />
  }
  if (vacanciesQuery.isError) {
    return <ErrorCard message={vacanciesQuery.error instanceof ApiRequestError ? vacanciesQuery.error.message : t('admin.hh.toasts.vacanciesLoadFailed')} />
  }

  const status = statusQuery.data

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">{t('admin.hh.badge')}</Badge>
        <Typography variant="h1">{t('admin.hh.title')}</Typography>
      </div>

      {!status.enabled && (
        <Alert>
          <AlertTitle>{t('admin.hh.notConfiguredTitle')}</AlertTitle>
          <AlertDescription>{status.reason ?? t('admin.hh.notConfiguredReason')}</AlertDescription>
        </Alert>
      )}

      {status.enabled && (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <Typography tone="muted">
              {status.connected
                ? t('admin.hh.connected', { suffix: status.connection?.connectedEmployerId ? t('admin.hh.employerSuffix', { id: status.connection.connectedEmployerId }) : "" })
                : t('admin.hh.notConnected')}
            </Typography>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
                {connectMutation.isPending ? t('common.preparing') : status.connected ? t('admin.hh.reconnect') : t('admin.hh.connect')}
              </Button>
              <Button variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending || !status.connected}>
                {syncMutation.isPending ? t('common.syncing') : t('admin.hh.syncNow')}
              </Button>
            </div>
            {syncResult && <Typography variant="bodySm" tone="muted">{syncResult}</Typography>}
            {status.lastSyncAt && (
              <Typography variant="bodySm" tone="muted">{t('admin.hh.lastSync', { date: new Date(status.lastSyncAt).toLocaleString() })}</Typography>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.hh.mapping.title')}</CardTitle>
          <CardDescription>{t('admin.hh.mapping.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {vacancies.length === 0 ? (
            <Typography tone="muted">{t('admin.hh.mapping.empty')}</Typography>
          ) : (
            <ul className="grid gap-2">
              {vacancies.map((vacancy) => (
                <li key={vacancy.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3">
                  <Typography className="min-w-52 flex-1">{vacancy.title}</Typography>
                  <Input
                    value={vacancyInputValues[vacancy.id] ?? ""}
                    onChange={(event) =>
                      setHhVacancyInputs((prev) => ({
                        ...prev,
                        [vacancy.id]: event.target.value,
                      }))
                    }
                    placeholder={t('admin.hh.mapping.idPlaceholder')}
                    className="w-52"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      linkMutation.mutate({
                        vacancyId: vacancy.id,
                        hhVacancyId: (vacancyInputValues[vacancy.id] ?? "").trim() || null,
                      })
                    }
                    disabled={linkMutation.isPending}
                  >
                    {t('admin.hh.mapping.save')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function AdminAuditLog() {
  const { api, user } = useAuth()
  const { t } = useTranslation('recruiting')
  const [entityTypeFilter, setEntityTypeFilter] = useState("")
  const [cursor, setCursor] = useState<string | undefined>()
  const [accumulated, setAccumulated] = useState<Array<{
    id: string
    action: string
    entityType: string
    entityId: string
    actorUserId: string | null
    createdAt: string
  }>>([])
  const entityTypes = ["HiringRequisition", "Vacancy", "Candidate", "Application", "OrgUnit"]

  const query = useQuery({
    queryKey: ["admin", "audit-events", entityTypeFilter, cursor],
    queryFn: () => api.listAuditEvents({ limit: 50, ...(entityTypeFilter ? { entityType: entityTypeFilter } : {}), ...(cursor ? { cursor } : {}) }),
    enabled: Boolean(user),
  })

  useEffect(() => {
    setAccumulated([])
    setCursor(undefined)
  }, [entityTypeFilter])

  useEffect(() => {
    if (!query.data) return
    setAccumulated((prev) => {
      if (!cursor) return query.data.items
      const seen = new Set(prev.map((item) => item.id))
      const next = query.data.items.filter((item) => !seen.has(item.id))
      return next.length === 0 ? prev : [...prev, ...next]
    })
  }, [query.data, cursor])

  if (query.isPending && accumulated.length === 0) return <LoadingCard />
  if (query.isError) return <ErrorCard message={query.error instanceof ApiRequestError && query.error.status === 403 ? t('common.accessDenied') : t('admin.audit.loadFailed')} />

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3"><Badge variant="outline" className="w-fit">{t('admin.badge')}</Badge><Typography variant="h1">{t('admin.audit.title')}</Typography></div>
      <div className="flex items-center gap-3">
        <Typography variant="bodySm" tone="muted">{t('admin.audit.entityTypeLabel')}</Typography>
        <select value={entityTypeFilter} onChange={(e) => { setEntityTypeFilter(e.target.value); setCursor(undefined) }}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
          <option value="">{t('admin.audit.all')}</option>
          {entityTypes.map((et) => <option key={et} value={et}>{et}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b"><th className="py-2 text-left font-medium">{t('admin.audit.fields.action')}</th><th className="py-2 text-left font-medium">{t('admin.audit.fields.entity')}</th><th className="py-2 text-left font-medium">{t('admin.audit.fields.actor')}</th><th className="py-2 text-left font-medium">{t('admin.audit.fields.when')}</th></tr></thead>
          <tbody>
            {accumulated.map((e) => (
              <tr key={e.id} className="border-b">
                <td className="py-2 font-mono text-xs">{e.action}</td>
                <td className="py-2"><span className="text-xs text-muted-foreground">{e.entityType}</span><br /><span className="font-mono text-xs">{e.entityId.slice(0, 8)}…</span></td>
                <td className="py-2 font-mono text-xs">{e.actorUserId?.slice(0, 8) ?? "system"}</td>
                <td className="py-2">{new Date(e.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.data?.nextCursor && (
        <Button variant="outline" className="w-fit" disabled={query.isFetching} onClick={() => setCursor(query.data.nextCursor ?? undefined)}>{t('admin.audit.loadMore')}</Button>
      )}
    </section>
  )
}
