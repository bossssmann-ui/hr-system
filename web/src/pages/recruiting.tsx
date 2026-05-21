/**
 * Phase 1B recruiting pages — real data + forms + kanban.
 */

import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import type { Application, ApplicationStage, OrgUnit, RequisitionStatus, Vacancy } from "@web-app-demo/contracts"
import { useState } from "react"
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
                    return (
                      <div key={app.id} draggable onDragStart={() => setDragging({ id: app.id, from: app.stage })} onDragEnd={() => setDragging(null)}
                        className="cursor-grab rounded-md border bg-background p-3 shadow-sm active:cursor-grabbing"
                        data-testid={"application-card-" + app.id} data-stage={app.stage}>
                        <Typography variant="bodySm" className="font-medium">{app.candidateId.slice(0, 8)}</Typography>
                        {vac && <Typography variant="bodySm" tone="muted">{vac.title}</Typography>}
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
  // TODO(phase-1c): full application detail with stage history and AI scoring
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <Badge variant="outline" className="w-fit">Recruiting · Application</Badge>
      <Typography variant="h1">Application detail</Typography>
      <Typography tone="muted">Deep view with stage history coming in a later phase.</Typography>
      <Button variant="outline" asChild className="w-fit"><Link to="/applications">← Back to kanban</Link></Button>
    </section>
  )
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
