/**
 * Phase 1B recruiting pages — real data + forms + kanban.
 */

import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import type { Application, ApplicationStage, Interview, OrgUnit, RequisitionStatus, Vacancy } from "@web-app-demo/contracts"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Typography } from "@/components/ui/typography"
import { ApiRequestError } from "@/lib/api"
import { useAuth } from "@/lib/use-auth"
import { cn } from "@/lib/utils"

function LoginRequired() {
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-4 px-5 py-16">
      <Badge variant="outline" className="w-fit">Login required</Badge>
      <Typography variant="h2">Sign in to continue</Typography>
      <Typography tone="muted">This page is part of the recruiter workspace.</Typography>
      <Link to="/" className={cn(buttonVariants({ size: "lg" }), "w-fit")}>Go to auth</Link>
    </section>
  )
}

function LoadingCard() {
  return (
    <Card className="w-fit">
      <CardContent className="flex items-center gap-3 py-8">
        <Spinner aria-hidden />
        <Typography tone="muted">Loading...</Typography>
      </CardContent>
    </Card>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="max-w-2xl">
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

const STATUS_LABELS: Record<RequisitionStatus, string> = {
  draft: "Draft", submitted: "Submitted", manager_approved: "Manager Approved",
  hr_approved: "HR Approved", approved: "Approved", in_recruitment: "In Recruitment",
  closed: "Closed", rejected: "Rejected",
}

const STATUS_VARIANT: Record<RequisitionStatus, "default" | "outline" | "secondary"> = {
  draft: "outline", submitted: "outline", manager_approved: "secondary",
  hr_approved: "secondary", approved: "default", in_recruitment: "default",
  closed: "outline", rejected: "outline",
}

const REQUISITION_TRANSITIONS: Array<{ from: RequisitionStatus[]; to: RequisitionStatus; label: string; roles: string[] }> = [
  { from: ["draft"], to: "submitted", label: "Submit", roles: ["recruiter", "hiring_manager", "hr_admin", "owner"] },
  { from: ["submitted"], to: "manager_approved", label: "Approve as Manager", roles: ["hiring_manager", "hr_admin", "owner"] },
  { from: ["submitted", "manager_approved"], to: "rejected", label: "Reject", roles: ["hiring_manager", "hr_admin", "owner"] },
  { from: ["manager_approved"], to: "hr_approved", label: "Approve as HR", roles: ["hr_admin", "owner"] },
  { from: ["hr_approved"], to: "approved", label: "Final Approve", roles: ["hr_admin", "owner"] },
  { from: ["approved"], to: "in_recruitment", label: "Start Recruiting", roles: ["recruiter", "hr_admin", "owner"] },
  { from: ["in_recruitment"], to: "closed", label: "Close", roles: ["recruiter", "hr_admin", "owner"] },
]

// ─── Requisitions List ────────────────────────────────────────────────────────

export function RequisitionsPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <RequisitionsList />
}

function RequisitionsList() {
  const { api, user } = useAuth()
  const [statusFilter, setStatusFilter] = useState<string>("")
  const statuses: RequisitionStatus[] = ["draft", "submitted", "manager_approved", "hr_approved", "approved", "in_recruitment", "closed", "rejected"]

  const query = useQuery({
    queryKey: ["requisitions", "list", statusFilter],
    queryFn: () => api.listRequisitions(statusFilter ? { status: statusFilter } : undefined),
    enabled: Boolean(user),
  })

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-3">
          <Badge variant="outline" className="w-fit">Recruiting · Requisitions</Badge>
          <Typography variant="h1">Hiring requisitions</Typography>
        </div>
        <Button asChild>
          <Link to="/requisitions/new" data-testid="new-requisition-button">New requisition</Link>
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={statusFilter === "" ? "default" : "outline"} onClick={() => setStatusFilter("")}>All</Button>
        {statuses.map((s) => (
          <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>{STATUS_LABELS[s]}</Button>
        ))}
      </div>
      {query.isPending ? <LoadingCard />
        : query.isError ? <ErrorCard message={query.error instanceof ApiRequestError ? query.error.message : "Unexpected error"} />
        : query.data.items.length === 0 ? (
          <Card size="sm" className="max-w-3xl"><CardHeader><CardTitle>No requisitions yet</CardTitle><CardDescription>Create the first one above.</CardDescription></CardHeader></Card>
        ) : (
          <ul className="grid gap-3" data-testid="requisitions-list">
            {query.data.items.map((r) => (
              <li key={r.id}>
                <Link to="/requisitions/$requisitionId" params={{ requisitionId: r.id }}>
                  <Card size="sm" className="max-w-3xl cursor-pointer hover:bg-muted/50">
                    <CardHeader>
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle>{r.title}</CardTitle>
                        <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABELS[r.status]}</Badge>
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
      setFormError(error instanceof ApiRequestError ? error.message : "Failed to create requisition")
    },
  })

  const form = useForm({
    defaultValues: { orgUnitId: "", title: "", grade: "", salaryMin: "", salaryMax: "", currency: "RUB", justification: "", deadlineAt: "" },
    onSubmit: async ({ value }) => {
      setFormError(null)
      const salaryMin = Number(value.salaryMin)
      const salaryMax = Number(value.salaryMax)
      if (Number.isNaN(salaryMin) || salaryMin < 0) { setFormError("Invalid salary min"); return }
      if (Number.isNaN(salaryMax) || salaryMax < 0) { setFormError("Invalid salary max"); return }
      if (salaryMin > salaryMax) { setFormError("Salary min must be ≤ salary max"); return }
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
        <Badge variant="outline" className="w-fit">Recruiting · Requisitions</Badge>
        <Typography variant="h1">New hiring requisition</Typography>
      </div>
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={(e) => { e.preventDefault(); void form.handleSubmit() }} data-testid="requisition-form">
            <FieldGroup className="gap-4">
              <form.Field name="orgUnitId" children={(field) => (
                <Field>
                  <FieldLabel htmlFor="orgUnitId">Org unit</FieldLabel>
                  <select id="orgUnitId" name={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" data-testid="org-unit-select">
                    <option value="">Select org unit...</option>
                    {orgUnits.map((ou) => <option key={ou.id} value={ou.id}>{ou.name}</option>)}
                  </select>
                </Field>
              )} />
              <form.Field name="title" children={(field) => (
                <Field>
                  <FieldLabel htmlFor="title">Title</FieldLabel>
                  <Input id="title" name={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. Senior Backend Engineer" data-testid="title-input" />
                </Field>
              )} />
              <form.Field name="grade" children={(field) => (
                <Field>
                  <FieldLabel htmlFor="grade">Grade</FieldLabel>
                  <Input id="grade" name={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. M3" />
                </Field>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <form.Field name="salaryMin" children={(field) => (
                  <Field>
                    <FieldLabel htmlFor="salaryMin">Salary min</FieldLabel>
                    <Input id="salaryMin" name={field.name} type="number" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} data-testid="salary-min-input" />
                  </Field>
                )} />
                <form.Field name="salaryMax" children={(field) => (
                  <Field>
                    <FieldLabel htmlFor="salaryMax">Salary max</FieldLabel>
                    <Input id="salaryMax" name={field.name} type="number" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} data-testid="salary-max-input" />
                  </Field>
                )} />
              </div>
              <form.Field name="currency" children={(field) => (
                <Field>
                  <FieldLabel htmlFor="currency">Currency</FieldLabel>
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
                  <FieldLabel htmlFor="justification">Justification</FieldLabel>
                  <textarea id="justification" name={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)}
                    rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Business rationale" data-testid="justification-input" />
                </Field>
              )} />
              <form.Field name="deadlineAt" children={(field) => (
                <Field>
                  <FieldLabel htmlFor="deadlineAt">Deadline (optional)</FieldLabel>
                  <Input id="deadlineAt" name={field.name} type="date" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                </Field>
              )} />
              {formError && <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{formError}</AlertDescription></Alert>}
              <div className="flex gap-3">
                <form.Subscribe selector={(s) => s.isSubmitting} children={(isSubmitting) => (
                  <Button type="submit" disabled={isSubmitting || mutation.isPending} data-testid="submit-button">
                    {isSubmitting || mutation.isPending ? "Creating..." : "Create requisition"}
                  </Button>
                )} />
                <Button type="button" variant="outline" asChild><Link to="/requisitions">Cancel</Link></Button>
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
  const { api } = useAuth()
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
      toast.success("Status updated")
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Failed to update status")
    },
  })

  if (query.isPending) return <LoadingCard />
  if (query.isError) return <ErrorCard message="Requisition not found or access denied" />

  const r = query.data
  // Show all valid transitions from the current status.
  // The server is the source of truth for role enforcement;
  // a 422 FSM_TRANSITION_DENIED response is toasted if the user lacks the right role.
  const availableTransitions = REQUISITION_TRANSITIONS.filter((t) => t.from.includes(r.status))

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6 px-5 py-12">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-3">
          <Badge variant="outline" className="w-fit">Recruiting · Requisitions</Badge>
          <Typography variant="h1">{r.title}</Typography>
        </div>
        <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABELS[r.status]}</Badge>
      </div>
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><Typography tone="muted">Grade</Typography><Typography>{r.grade}</Typography></div>
            <div><Typography tone="muted">Salary range</Typography><Typography>{r.salaryMin.toLocaleString()}–{r.salaryMax.toLocaleString()} {r.currency}</Typography></div>
            <div><Typography tone="muted">Created</Typography><Typography>{new Date(r.createdAt).toLocaleDateString()}</Typography></div>
            {r.deadlineAt && <div><Typography tone="muted">Deadline</Typography><Typography>{new Date(r.deadlineAt).toLocaleDateString()}</Typography></div>}
          </div>
          <div className="border-t pt-4">
            <Typography tone="muted" variant="bodySm">Justification</Typography>
            <Typography>{r.justification}</Typography>
          </div>
        </CardContent>
      </Card>
      {availableTransitions.length > 0 && (
        <div className="grid gap-3">
          <Typography variant="h3">Actions</Typography>
          <div className="flex flex-wrap gap-2">
            {availableTransitions.map((t) => (
              <Button key={t.to} variant={t.to === "rejected" ? "outline" : "default"}
                disabled={transitionMutation.isPending} onClick={() => transitionMutation.mutate(t.to)}
                data-testid={"transition-" + t.to}>
                {transitionMutation.isPending ? "Working..." : t.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      <Button variant="outline" asChild className="w-fit"><Link to="/requisitions">← Back to list</Link></Button>
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
  const queryClient = useQueryClient()

  const query = useQuery({ queryKey: ["vacancies"], queryFn: () => api.listVacancies(), enabled: Boolean(user) })

  const publishMutation = useMutation({
    mutationFn: ({ id, isPublished }: { id: string; isPublished: boolean }) => api.publishVacancy(id, { isPublished }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vacancies"] }),
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : "Failed"),
  })

  if (query.isPending) return <LoadingCard />
  if (query.isError) return <ErrorCard message="Could not load vacancies" />

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">Recruiting · Vacancies</Badge>
        <Typography variant="h1">Vacancies</Typography>
      </div>
      {query.data.items.length === 0 ? (
        <Card size="sm" className="max-w-3xl"><CardHeader><CardTitle>No vacancies yet</CardTitle><CardDescription>Vacancies are auto-created when a requisition is approved.</CardDescription></CardHeader></Card>
      ) : (
        <ul className="grid gap-3">
          {query.data.items.map((v: Vacancy) => (
            <li key={v.id}>
              <Card size="sm" className="max-w-3xl">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle><Link to="/vacancies/$vacancyId" params={{ vacancyId: v.id }} className="hover:underline">{v.title}</Link></CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant={v.isPublished ? "default" : "outline"}>{v.isPublished ? "Published" : "Draft"}</Badge>
                      <Button size="sm" variant="outline" disabled={publishMutation.isPending}
                        onClick={() => publishMutation.mutate({ id: v.id, isPublished: !v.isPublished })}
                        data-testid={"publish-toggle-" + v.id}>
                        {v.isPublished ? "Unpublish" : "Publish"}
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
  const params = useParams({ strict: false }) as { vacancyId?: string }
  const vacancyId = params.vacancyId ?? ""

  const query = useQuery({ queryKey: ["vacancies", vacancyId], queryFn: () => api.getVacancy(vacancyId), enabled: Boolean(vacancyId) })

  if (query.isPending) return <LoadingCard />
  if (query.isError) return <ErrorCard message="Vacancy not found" />

  const v = query.data

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6 px-5 py-12">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-3">
          <Badge variant="outline" className="w-fit">Recruiting · Vacancies</Badge>
          <Typography variant="h1">{v.title}</Typography>
        </div>
        <Badge variant={v.isPublished ? "default" : "outline"}>{v.isPublished ? "Published" : "Draft"}</Badge>
      </div>
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <Typography>{v.description}</Typography>
          <div className="border-t pt-4">
            <Typography tone="muted" variant="bodySm">Created {new Date(v.createdAt).toLocaleDateString()}</Typography>
          </div>
        </CardContent>
      </Card>
      <div className="flex gap-3">
        <Button asChild><Link to="/applications">View applications</Link></Button>
        <Button variant="outline" asChild><Link to="/vacancies">← Back</Link></Button>
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
      if (result.deduped) { toast.info("Returning existing candidate (deduped)") } else { toast.success("Candidate created") }
      setShowForm(false); setFormError(null)
    },
    onError: (error: unknown) => setFormError(error instanceof ApiRequestError ? error.message : "Failed to create candidate"),
  })

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-3">
          <Badge variant="outline" className="w-fit">Recruiting · Candidates</Badge>
          <Typography variant="h1">Candidates</Typography>
        </div>
        <Button onClick={() => { setShowForm(!showForm); setFormError(null) }} data-testid="new-candidate-button">
          {showForm ? "Cancel" : "New candidate"}
        </Button>
      </div>
      {showForm && (
        <Card className="max-w-lg">
          <CardHeader><CardTitle>Add candidate</CardTitle></CardHeader>
          <CardContent>
            <NewCandidateForm onSubmit={(data) => createMutation.mutate(data)} isLoading={createMutation.isPending} error={formError} />
          </CardContent>
        </Card>
      )}
      <Input placeholder="Search by name, email, phone..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" data-testid="candidate-search" />
      {query.isPending ? <LoadingCard />
        : query.isError ? <ErrorCard message="Could not load candidates" />
        : query.data.items.length === 0 ? (
          <Card size="sm" className="max-w-3xl"><CardHeader><CardTitle>No candidates found</CardTitle></CardHeader></Card>
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
        <form.Field name="fullName" children={(field) => (<Field><FieldLabel htmlFor="cand-fullName">Full name *</FieldLabel><Input id="cand-fullName" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} data-testid="candidate-fullname" /></Field>)} />
        <form.Field name="email" children={(field) => (<Field><FieldLabel htmlFor="cand-email">Email</FieldLabel><Input id="cand-email" type="email" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} data-testid="candidate-email" /></Field>)} />
        <form.Field name="phone" children={(field) => (<Field><FieldLabel htmlFor="cand-phone">Phone</FieldLabel><Input id="cand-phone" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} /></Field>)} />
        <form.Field name="location" children={(field) => (<Field><FieldLabel htmlFor="cand-location">Location</FieldLabel><Input id="cand-location" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} /></Field>)} />
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" disabled={isLoading} data-testid="create-candidate-submit">{isLoading ? "Creating..." : "Add candidate"}</Button>
      </FieldGroup>
    </form>
  )
}

// ─── Applications Kanban ──────────────────────────────────────────────────────

const KANBAN_STAGES: ApplicationStage[] = ["new", "screen", "tech", "final", "offer", "hired", "rejected"]
const STAGE_LABELS: Record<ApplicationStage, string> = { new: "New", screen: "Screening", tech: "Tech", final: "Final", offer: "Offer", hired: "Hired", rejected: "Rejected" }
const APP_TRANSITIONS: Partial<Record<ApplicationStage, ApplicationStage[]>> = {
  new: ["screen", "rejected"], screen: ["tech", "rejected"], tech: ["final", "rejected"], final: ["offer", "rejected"], offer: ["hired", "rejected"],
}

function aiScoreBadge(scoring: Record<string, unknown> | null | undefined) {
  const status = typeof scoring?.status === "string" ? scoring.status : "pending"
  if (status === "not_configured") {
    return { label: "AI not configured", className: "border-zinc-300 text-zinc-600", summary: "AI scoring not configured" }
  }
  if (status === "failed") {
    const failure = typeof scoring?.failure === "object" && scoring.failure ? scoring.failure as Record<string, unknown> : null
    return { label: "AI failed", className: "border-red-300 text-red-700", summary: typeof failure?.error === "string" ? failure.error : "Scoring failed" }
  }
  if (status === "pending") {
    return { label: "AI scoring…", className: "border-zinc-300 text-zinc-600", summary: "Scoring in progress" }
  }
  if (status === "not_scored") {
    return { label: "Not scored", className: "border-zinc-300 text-zinc-600", summary: "No score yet" }
  }
  const result = typeof scoring?.result === "object" && scoring.result ? scoring.result as Record<string, unknown> : null
  if (!result) return { label: "Not scored", className: "border-zinc-300 text-zinc-600", summary: "Not scored yet" }
  const score = typeof result.relevance_score === "number" ? result.relevance_score : 0
  const className = score >= 75
    ? "border-emerald-300 text-emerald-700"
    : score >= 50
      ? "border-amber-300 text-amber-700"
      : "border-red-300 text-red-700"
  return { label: `AI ${score}`, className, summary: typeof result.summary === "string" ? result.summary : "Scored" }
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
  const candidatesQuery = useQuery({ queryKey: ["candidates", ""], queryFn: () => api.listCandidates(), enabled: showNewAppForm })

  const stageMutation = useMutation({
    mutationFn: ({ id, to }: { id: string; to: ApplicationStage }) => api.moveApplicationStage(id, { to }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["applications"] }),
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Cannot move to that stage")
      void queryClient.invalidateQueries({ queryKey: ["applications"] })
    },
  })

  const createAppMutation = useMutation({
    mutationFn: (data: { candidateId: string; vacancyId: string }) => api.createApplication(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["applications"] })
      toast.success("Application created"); setShowNewAppForm(false); setAppFormError(null)
    },
    onError: (error: unknown) => setAppFormError(error instanceof ApiRequestError ? error.message : "Failed to create application"),
  })

  const applications: Application[] = applicationsQuery.data?.items ?? []
  const vacancies: Vacancy[] = vacanciesQuery.data?.items ?? []

  function byStage(stage: ApplicationStage) { return applications.filter((a) => a.stage === stage) }

  function handleDrop(to: ApplicationStage) {
    if (!dragging) return
    if (dragging.from === to) { setDragging(null); return }
    if (!canMoveStage(dragging.from, to)) {
      toast.error("Cannot move from " + STAGE_LABELS[dragging.from] + " to " + STAGE_LABELS[to])
      setDragging(null); return
    }
    stageMutation.mutate({ id: dragging.id, to }); setDragging(null)
  }

  return (
    <section className="mx-auto grid w-full gap-4 px-5 py-8">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-2">
          <Badge variant="outline" className="w-fit">Recruiting · Kanban</Badge>
          <Typography variant="h1">Applications</Typography>
        </div>
        <Button onClick={() => { setShowNewAppForm(!showNewAppForm); setAppFormError(null) }} data-testid="new-application-button">
          {showNewAppForm ? "Cancel" : "New application"}
        </Button>
      </div>
      {showNewAppForm && (
        <Card className="max-w-md">
          <CardHeader><CardTitle>New application</CardTitle></CardHeader>
          <CardContent>
            <NewApplicationForm vacancies={vacancies} candidates={candidatesQuery.data?.items ?? []}
              onSubmit={(data) => createAppMutation.mutate(data)} isLoading={createAppMutation.isPending} error={appFormError} />
          </CardContent>
        </Card>
      )}
      <div className="flex items-center gap-3">
        <Typography variant="bodySm" tone="muted">Filter by vacancy:</Typography>
        <select value={vacancyFilter} onChange={(e) => setVacancyFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" data-testid="vacancy-filter">
          <option value="">All vacancies</option>
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
                  <Typography variant="bodySm" className="font-semibold">{STAGE_LABELS[stage]}</Typography>
                  <Badge variant="outline" className="text-xs">{byStage(stage).length}</Badge>
                </div>
                <div className="grid gap-2">
                  {byStage(stage).map((app) => {
                    const vac = vacancies.find((v) => v.id === app.vacancyId)
                    const scoreBadge = aiScoreBadge((app.aiScoring ?? null) as Record<string, unknown> | null)
                    return (
                      <div key={app.id} draggable onDragStart={() => setDragging({ id: app.id, from: app.stage })} onDragEnd={() => setDragging(null)}
                        className="cursor-grab rounded-md border bg-background p-3 shadow-sm active:cursor-grabbing"
                        data-testid={"application-card-" + app.id} data-stage={app.stage}>
                        <div className="flex items-start justify-between gap-2">
                          <Typography variant="bodySm" className="font-medium">{app.candidateId.slice(0, 8)}</Typography>
                          <Badge variant="outline" className={cn("text-[11px]", scoreBadge.className)} title={scoreBadge.summary}>{scoreBadge.label}</Badge>
                        </div>
                        {vac && <Typography variant="bodySm" tone="muted">{vac.title}</Typography>}
                        <Link to="/applications/$applicationId" params={{ applicationId: app.id }} className="text-xs text-primary underline-offset-4 hover:underline">
                          Open detail
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
          <Field><FieldLabel htmlFor="app-vacancyId">Vacancy</FieldLabel>
            <select id="app-vacancyId" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" data-testid="app-vacancy-select">
              <option value="">Select vacancy...</option>
              {vacancies.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
            </select>
          </Field>
        )} />
        <form.Field name="candidateId" children={(field) => (
          <Field><FieldLabel htmlFor="app-candidateId">Candidate</FieldLabel>
            <select id="app-candidateId" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" data-testid="app-candidate-select">
              <option value="">Select candidate...</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </select>
          </Field>
        )} />
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" disabled={isLoading} data-testid="create-application-submit">{isLoading ? "Creating..." : "Create application"}</Button>
      </FieldGroup>
    </form>
  )
}

// ─── Application Detail (placeholder) ────────────────────────────────────────

export function ApplicationDetailPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  const { api } = auth
  const params = useParams({ strict: false }) as { applicationId?: string }
  const applicationId = params.applicationId ?? ""
  const queryClient = useQueryClient()
  const [feedbackNote, setFeedbackNote] = useState("")

  const query = useQuery({
    queryKey: ["applications", applicationId, "detail"],
    queryFn: () => api.getApplication(applicationId),
    enabled: Boolean(applicationId),
  })

  const rescoreMutation = useMutation({
    mutationFn: () => api.rescoreApplication(applicationId),
    onSuccess: async (result) => {
      if (!result.queued) {
        toast.info("AI scoring not configured")
      } else {
        toast.success("Re-score queued")
      }
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Failed to queue re-score")
    },
  })

  const feedbackMutation = useMutation({
    mutationFn: (agrees: boolean) =>
      api.submitApplicationScoreFeedback(applicationId, {
        agrees,
        note: feedbackNote.trim() || undefined,
      }),
    onSuccess: async () => {
      toast.success("Feedback saved")
      setFeedbackNote("")
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Failed to save feedback")
    },
  })

  if (query.isPending) return <LoadingCard />
  if (query.isError) return <ErrorCard message="Application not found or access denied" />

  const app = query.data
  const scoring = (app.aiScoring ?? null) as Record<string, unknown> | null
  const scoreBadge = aiScoreBadge(scoring)
  const result = scoring?.status === "scored" && typeof scoring.result === "object" && scoring.result
    ? scoring.result as Record<string, unknown>
    : null
  const failure = scoring?.status === "failed" && typeof scoring.failure === "object" && scoring.failure
    ? scoring.failure as Record<string, unknown>
    : null

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">Recruiting · Application</Badge>
        <div className="flex flex-wrap items-center gap-3">
          <Typography variant="h1">Application detail</Typography>
          <Badge variant="outline" className={cn("text-xs", scoreBadge.className)} title={scoreBadge.summary}>{scoreBadge.label}</Badge>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Candidate + vacancy</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <Typography><span className="font-medium">Candidate:</span> {app.candidate.fullName}</Typography>
          <Typography><span className="font-medium">Vacancy:</span> {app.vacancy.title}</Typography>
          <Typography><span className="font-medium">Stage:</span> {STAGE_LABELS[app.stage]}</Typography>
          <Typography tone="muted">{app.vacancy.description}</Typography>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>AI scoring</CardTitle>
            <CardDescription>{scoreBadge.summary}</CardDescription>
          </div>
          <Button variant="outline" onClick={() => rescoreMutation.mutate()} disabled={rescoreMutation.isPending} data-testid="application-rescore-button">
            {rescoreMutation.isPending ? "Queueing..." : "Re-score"}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {scoring?.status === "not_configured" && <Typography tone="muted">AI scoring not configured.</Typography>}
          {scoring?.status === "not_scored" && <Typography tone="muted">No AI score yet.</Typography>}
          {scoring?.status === "pending" && <Typography tone="muted">Scoring is in progress.</Typography>}
          {failure && (
            <Alert variant="destructive">
              <AlertDescription>{String(failure.error ?? "Scoring failed")}</AlertDescription>
            </Alert>
          )}
          {result && (
            <div className="grid gap-4">
              <div className="grid gap-1">
                <Typography variant="h3">Relevance score: {String(result.relevance_score)}</Typography>
                <Typography>{String(result.summary ?? "")}</Typography>
              </div>
              <ScoringList title="Strengths" items={asStringList(result.strengths)} />
              <ScoringList title="Gaps" items={asStringList(result.gaps)} />
              <ScoringList title="Soft skills signals" items={asStringList(result.soft_skills_signals)} />
              <ScoringList title="Red flags" items={asStringList(result.red_flags)} />
              <ScoringList title="Anti-fraud signals" items={asStringList(result.anti_fraud_signals)} />
              <ScoringList title="Interview focus areas" items={asStringList(result.interview_focus_areas)} />
              <div>
                <Typography variant="bodySm" tone="muted">Values fit hypothesis</Typography>
                <Typography>{String(result.values_fit_hypothesis ?? "—")}</Typography>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Human feedback</CardTitle>
          <CardDescription>Score is advisory. Recruiter decision is final.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <textarea
            value={feedbackNote}
            onChange={(e) => setFeedbackNote(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Optional note about why you agree or disagree"
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => feedbackMutation.mutate(true)} disabled={feedbackMutation.isPending}>Agree</Button>
            <Button variant="outline" onClick={() => feedbackMutation.mutate(false)} disabled={feedbackMutation.isPending}>Disagree</Button>
          </div>
          {app.aiScoreFeedback && (
            <Typography tone="muted" variant="bodySm">
              Last feedback: {app.aiScoreFeedback.agrees ? "Agree" : "Disagree"} · {app.aiScoreFeedback.note ?? "No note"}
            </Typography>
          )}
        </CardContent>
      </Card>
      <InterviewPanel applicationId={applicationId} />
      <Button variant="outline" asChild className="w-fit"><Link to="/applications">← Back to kanban</Link></Button>
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

// ─── Interview Panel ──────────────────────────────────────────────────────────

const INTERVIEW_STATUS_LABELS: Record<Interview["status"], string> = {
  created: "Created",
  transcribing: "Transcribing…",
  transcribed: "Transcribed",
  protocol_ready: "Protocol ready",
  failed: "Failed",
}

const INTERVIEW_STATUS_VARIANT: Record<Interview["status"], "default" | "outline" | "secondary" | "destructive"> = {
  created: "outline",
  transcribing: "secondary",
  transcribed: "secondary",
  protocol_ready: "default",
  failed: "destructive",
}

function InterviewPanel({ applicationId }: { applicationId: string }) {
  const { api } = useAuth()
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
      return status === "transcribing" ? 3000 : false
    },
  })

  const createMutation = useMutation({
    mutationFn: () => api.createInterview({ applicationId }),
    onSuccess: async (interview) => {
      await queryClient.invalidateQueries({ queryKey: ["interviews", applicationId] })
      setSelectedInterviewId(interview.id)
      toast.success("Interview created")
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : "Failed to create interview"),
  })

  const consentMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => api.updateInterviewConsent(id, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["interviews", applicationId] })
      await queryClient.invalidateQueries({ queryKey: ["interviews", "detail", selectedInterviewId] })
      toast.success("Consent updated")
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : "Failed to update consent"),
  })

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => api.uploadInterviewRecording(id, file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["interviews", applicationId] })
      await queryClient.invalidateQueries({ queryKey: ["interviews", "detail", selectedInterviewId] })
      toast.success("Recording uploaded — transcription will start if consent is given")
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : "Upload failed"),
  })

  const transcribeMutation = useMutation({
    mutationFn: (id: string) => api.triggerTranscription(id),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["interviews", "detail", selectedInterviewId] })
      toast.info(result.queued ? "Transcription queued" : "Transcription not configured (set TRANSCRIPTION_ENABLED + ASR_API_KEY)")
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : "Transcription failed"),
  })

  const protocolMutation = useMutation({
    mutationFn: (id: string) => api.triggerBuildProtocol(id),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["interviews", "detail", selectedInterviewId] })
      toast.info(result.queued ? "Protocol build queued" : "LLM not configured")
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : "Protocol build failed"),
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
            <CardTitle>Interviews</CardTitle>
            <CardDescription>Upload a recording to start transcription & protocol generation.</CardDescription>
          </div>
          <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending} data-testid="create-interview-button">
            {createMutation.isPending ? "Creating…" : "New interview"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {interviewsQuery.isPending && <Typography tone="muted">Loading…</Typography>}
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
                <Badge variant={INTERVIEW_STATUS_VARIANT[iv.status]} className="mr-1 text-[10px]">{INTERVIEW_STATUS_LABELS[iv.status]}</Badge>
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
                <Typography variant="bodySm" className="font-medium">Recording consent (152-ФЗ)</Typography>
                <Typography variant="bodySm" tone="muted">
                  Transcription and protocol generation will only start after the candidate consents to recording.
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
                  <Typography variant="bodySm">{interview.consentRecorded ? "Consent recorded" : "Consent not recorded"}</Typography>
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
                  {uploadMutation.isPending ? "Uploading…" : interview.recordingUrl ? "Replace recording" : "Upload recording"}
                </Button>
              </div>
              {interview.recordingUrl && (
                <Typography variant="bodySm" tone="muted" className="text-xs">{interview.recordingUrl}</Typography>
              )}
              {interview.recordingUrl && interview.consentRecorded && interview.status !== "transcribed" && interview.status !== "protocol_ready" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => transcribeMutation.mutate(interview.id)}
                  disabled={transcribeMutation.isPending}
                  data-testid="transcribe-button"
                >
                  {transcribeMutation.isPending ? "Queuing…" : "Transcribe"}
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
                  {protocolMutation.isPending ? "Queuing…" : "Build protocol"}
                </Button>
              )}
            </div>

            {/* ── Status ── */}
            <div className="flex items-center gap-2">
              <Typography variant="bodySm">Status:</Typography>
              <Badge variant={INTERVIEW_STATUS_VARIANT[interview.status]}>{INTERVIEW_STATUS_LABELS[interview.status]}</Badge>
              {interview.status === "failed" && (
                <Typography variant="bodySm" tone="muted">Check backend logs or retry transcription.</Typography>
              )}
              {!interview.consentRecorded && (
                <Typography variant="bodySm" tone="muted">Transcription blocked: consent required.</Typography>
              )}
            </div>

            {/* ── Transcript viewer ── */}
            {transcript && (
              <div className="grid gap-2">
                <Typography variant="h3">Transcript</Typography>
                <Typography variant="bodySm" tone="muted">
                  Provider: {transcript.asr_provider} · Model: {transcript.asr_model} · Language: {transcript.language}
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
                <Typography variant="h3">Interview Protocol</Typography>
                <Typography variant="bodySm" tone="muted">
                  Generated by: {protocol.model} · {new Date(protocol.generated_at).toLocaleString()}
                </Typography>
                <div className="grid gap-1">
                  <Typography variant="bodySm" className="font-medium">Summary</Typography>
                  <Typography variant="bodySm">{protocol.summary}</Typography>
                </div>
                <ScoringList title="Strengths" items={protocol.strengths} />
                <ScoringList title="Concerns" items={protocol.concerns} />
                {protocol.questions_and_answers.length > 0 && (
                  <div className="grid gap-2">
                    <Typography variant="bodySm" tone="muted" className="font-medium">Questions & Answers</Typography>
                    {protocol.questions_and_answers.map((qa, idx) => (
                      <div key={idx} className="rounded-md border bg-muted/20 p-3 grid gap-1">
                        <Typography variant="bodySm" className="font-medium">Q: {qa.question}</Typography>
                        <Typography variant="bodySm">A: {qa.answer}</Typography>
                      </div>
                    ))}
                  </div>
                )}
                {/* Agreed terms with quote-links */}
                <div className="grid gap-2">
                  <Typography variant="bodySm" className="font-medium">Agreed Terms</Typography>
                  <div className="grid gap-2 rounded-md border p-3 bg-muted/20">
                    {protocol.agreed_terms.salary != null && (
                      <AgreedTermRow
                        label="Salary"
                        value={`${protocol.agreed_terms.salary} ${protocol.agreed_terms.currency ?? ""}`}
                        source={protocol.agreed_terms.salary_source ?? null}
                        isOpen={showSourceForTerm === "salary"}
                        onToggle={() => setShowSourceForTerm(showSourceForTerm === "salary" ? null : "salary")}
                        transcript={transcript}
                      />
                    )}
                    {protocol.agreed_terms.start_date && (
                      <AgreedTermRow
                        label="Start date"
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
                        label={`Condition ${idx + 1}`}
                        value={cond}
                        source={protocol.agreed_terms.special_conditions_sources?.[idx] ?? null}
                        isOpen={showSourceForTerm === `cond_${idx}`}
                        onToggle={() => setShowSourceForTerm(showSourceForTerm === `cond_${idx}` ? null : `cond_${idx}`)}
                        transcript={transcript}
                      />
                    ))}
                    {protocol.agreed_terms.salary == null && !protocol.agreed_terms.start_date && protocol.agreed_terms.special_conditions.length === 0 && (
                      <Typography variant="bodySm" tone="muted">No agreed terms found in transcript.</Typography>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Offer Draft panel ── */}
            {offerDraft && (
              <div className="grid gap-3 rounded-md border bg-muted/20 p-4" data-testid="offer-draft-panel">
                <div className="flex items-center gap-2">
                  <Typography variant="h3">Offer Draft</Typography>
                  <Badge variant="outline">draft</Badge>
                  <Typography variant="bodySm" tone="muted" className="text-xs ml-auto">
                    Phase 3 will add full offer + DocuSeal signing
                  </Typography>
                </div>
                <div className="grid gap-2 text-sm">
                  {offerDraft.salary != null && (
                    <div className="flex gap-2">
                      <Typography variant="bodySm" className="font-medium w-28">Salary</Typography>
                      <Typography variant="bodySm">{offerDraft.salary} {offerDraft.currency ?? ""}</Typography>
                    </div>
                  )}
                  {offerDraft.start_date && (
                    <div className="flex gap-2">
                      <Typography variant="bodySm" className="font-medium w-28">Start date</Typography>
                      <Typography variant="bodySm">{offerDraft.start_date}</Typography>
                    </div>
                  )}
                  {offerDraft.conditions.length > 0 && (
                    <div className="flex gap-2">
                      <Typography variant="bodySm" className="font-medium w-28">Conditions</Typography>
                      <ul className="list-disc pl-5">
                        {offerDraft.conditions.map((cond, idx) => (
                          <li key={idx}><Typography variant="bodySm">{cond}</Typography></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {offerDraft.salary == null && !offerDraft.start_date && offerDraft.conditions.length === 0 && (
                    <Typography variant="bodySm" tone="muted">No terms extracted.</Typography>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {interviews.length === 0 && !interviewsQuery.isPending && (
          <Typography tone="muted">No interviews yet. Create one to start the transcription pipeline.</Typography>
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
            {isOpen ? "Hide source" : "Show source"}
          </button>
        )}
      </div>
      {isOpen && source && (
        <div className="rounded-md border bg-background p-3 text-xs ml-28 grid gap-1">
          <Typography variant="bodySm" tone="muted">Quote from segment {source.segment_index}:</Typography>
          <Typography variant="bodySm" className="italic">"{source.quote}"</Typography>
          {segment && (
            <Typography variant="bodySm" tone="muted">
              Speaker: {segment.speaker} · {msToTimestamp(segment.start_ms)}–{msToTimestamp(segment.end_ms)}
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
  const query = useQuery({ queryKey: ["admin", "users"], queryFn: () => api.listAdminUsers(), enabled: Boolean(user) })

  if (query.isPending) return <LoadingCard />
  if (query.isError) return <ErrorCard message={query.error instanceof ApiRequestError && query.error.status === 403 ? "Access denied." : "Could not load users"} />

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3"><Badge variant="outline" className="w-fit">Admin</Badge><Typography variant="h1">Users</Typography></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b"><th className="py-2 text-left font-medium">Name</th><th className="py-2 text-left font-medium">Email</th><th className="py-2 text-left font-medium">Roles</th><th className="py-2 text-left font-medium">Joined</th></tr></thead>
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
        throw new Error(result.reason ?? "HH authorize URL is unavailable")
      }
      window.location.href = result.authorizeUrl
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to prepare HH OAuth")
    },
  })

  const callbackMutation = useMutation({
    mutationFn: ({ code, redirectUri }: { code: string; redirectUri: string }) => api.completeHhOAuth({ code, redirectUri }),
    onSuccess: async () => {
      toast.success("HH connected")
      await queryClient.invalidateQueries({ queryKey: ["admin", "hh", "status"] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Failed to complete HH OAuth")
    },
  })

  const syncMutation = useMutation({
    mutationFn: () => api.syncHhNow(),
    onSuccess: async (result) => {
      setSyncResult(`Imported ${result.summary.importedCandidates} candidates; upserted ${result.summary.upsertedApplications} applications.`)
      toast.success("HH sync completed")
      await queryClient.invalidateQueries({ queryKey: ["admin", "hh", "status"] })
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
      await queryClient.invalidateQueries({ queryKey: ["candidates"] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : "HH sync failed")
    },
  })

  const linkMutation = useMutation({
    mutationFn: ({ vacancyId, hhVacancyId }: { vacancyId: string; hhVacancyId: string | null }) =>
      api.linkVacancyToHh(vacancyId, { hhVacancyId }),
    onSuccess: async () => {
      toast.success("Vacancy mapping updated")
      await queryClient.invalidateQueries({ queryKey: ["vacancies"] })
      await queryClient.invalidateQueries({ queryKey: ["admin", "hh", "status"] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Failed to save vacancy link")
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
    return <ErrorCard message={statusQuery.error instanceof ApiRequestError ? statusQuery.error.message : "Could not load HH integration status"} />
  }
  if (vacanciesQuery.isError) {
    return <ErrorCard message={vacanciesQuery.error instanceof ApiRequestError ? vacanciesQuery.error.message : "Could not load vacancies"} />
  }

  const status = statusQuery.data

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">Admin · Integrations</Badge>
        <Typography variant="h1">HH.ru negotiations sync</Typography>
      </div>

      {!status.enabled && (
        <Alert>
          <AlertTitle>Not configured</AlertTitle>
          <AlertDescription>{status.reason ?? "HH integration is disabled or missing credentials."}</AlertDescription>
        </Alert>
      )}

      {status.enabled && (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <Typography tone="muted">
              {status.connected
                ? `Connected${status.connection?.connectedEmployerId ? ` (employer ${status.connection.connectedEmployerId})` : ""}.`
                : "Not connected yet."}
            </Typography>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
                {connectMutation.isPending ? "Preparing..." : status.connected ? "Reconnect HH" : "Connect HH"}
              </Button>
              <Button variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending || !status.connected}>
                {syncMutation.isPending ? "Syncing..." : "Sync now"}
              </Button>
            </div>
            {syncResult && <Typography variant="bodySm" tone="muted">{syncResult}</Typography>}
            {status.lastSyncAt && (
              <Typography variant="bodySm" tone="muted">Last sync: {new Date(status.lastSyncAt).toLocaleString()}</Typography>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Vacancy mapping</CardTitle>
          <CardDescription>Link each local vacancy with its HH vacancy ID for negotiations polling.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {vacancies.length === 0 ? (
            <Typography tone="muted">No vacancies to map yet.</Typography>
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
                    placeholder="HH vacancy ID"
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
                    Save
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
  const [entityTypeFilter, setEntityTypeFilter] = useState("")
  const [cursor, setCursor] = useState<string | undefined>()
  const entityTypes = ["HiringRequisition", "Vacancy", "Candidate", "Application", "OrgUnit"]

  const query = useQuery({
    queryKey: ["admin", "audit-events", entityTypeFilter, cursor],
    queryFn: () => api.listAuditEvents({ limit: 50, ...(entityTypeFilter ? { entityType: entityTypeFilter } : {}), ...(cursor ? { cursor } : {}) }),
    enabled: Boolean(user),
  })

  if (query.isPending) return <LoadingCard />
  if (query.isError) return <ErrorCard message={query.error instanceof ApiRequestError && query.error.status === 403 ? "Access denied." : "Could not load audit log"} />

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3"><Badge variant="outline" className="w-fit">Admin</Badge><Typography variant="h1">Audit log</Typography></div>
      <div className="flex items-center gap-3">
        <Typography variant="bodySm" tone="muted">Entity type:</Typography>
        <select value={entityTypeFilter} onChange={(e) => { setEntityTypeFilter(e.target.value); setCursor(undefined) }}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
          <option value="">All</option>
          {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b"><th className="py-2 text-left font-medium">Action</th><th className="py-2 text-left font-medium">Entity</th><th className="py-2 text-left font-medium">Actor</th><th className="py-2 text-left font-medium">When</th></tr></thead>
          <tbody>
            {query.data.items.map((e) => (
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
      {query.data.nextCursor && (
        <Button variant="outline" className="w-fit" onClick={() => setCursor(query.data.nextCursor ?? undefined)}>Load more</Button>
      )}
    </section>
  )
}
