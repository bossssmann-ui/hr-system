/**
 * Phase 0 recruiting routes — skeleton pages.
 *
 * Each page is intentionally a placeholder describing the user journey it
 * will implement. Real data fetching, forms, kanban DnD, and admin tables
 * land alongside the backend routes in Phase 0.x / Phase 1. The routes
 * exist now so contributors can wire feature work without scaffolding
 * navigation in every PR.
 *
 * See `docs/contracts/20-fsm.md` for the requisition + application FSMs that
 * these pages will eventually drive.
 */

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'
import { cn } from '@/lib/utils'

function LoginRequired() {
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-4 px-5 py-16">
      <Badge variant="outline" className="w-fit">
        Login required
      </Badge>
      <Typography variant="h2">Sign in to continue</Typography>
      <Typography tone="muted">This page is part of the recruiter workspace.</Typography>
      <Link to="/" className={cn(buttonVariants({ size: 'lg' }), 'w-fit')}>
        Go to auth
      </Link>
    </section>
  )
}

type Phase0PageProps = {
  badge: string
  title: string
  description: string
  todo: string[]
}

function Phase0Page({ badge, title, description, todo }: Phase0PageProps) {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">
          {badge}
        </Badge>
        <Typography variant="h1">{title}</Typography>
        <Typography className="max-w-3xl" tone="muted">
          {description}
        </Typography>
      </div>
      <Card size="sm" className="max-w-3xl">
        <CardHeader>
          <CardTitle>Phase 0 status</CardTitle>
          <CardDescription>
            This route is the foundation skeleton. Real interactions land with the matching
            backend routes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2">
            {todo.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span aria-hidden className="mt-2 size-1.5 rounded-full bg-muted-foreground/60" />
                <Typography variant="bodySm" tone="muted">
                  {item}
                </Typography>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}

export function RequisitionsPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />

  return <RequisitionsList />
}

function RequisitionsList() {
  const { api } = useAuth()
  const query = useQuery({
    queryKey: ['requisitions', 'list'],
    queryFn: () => api.listRequisitions(),
  })

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">
          Recruiting · Requisitions
        </Badge>
        <Typography variant="h1">Hiring requisitions</Typography>
        <Typography className="max-w-3xl" tone="muted">
          Open hiring requisitions across the org. Phase 0 ships this list as read-only;
          creation and the approval FSM land alongside the matching backend routes.
        </Typography>
      </div>

      {query.isPending ? (
        <Card size="sm" className="max-w-3xl">
          <CardContent className="flex items-center gap-3 py-8">
            <Spinner aria-hidden />
            <Typography tone="muted">Loading requisitions…</Typography>
          </CardContent>
        </Card>
      ) : query.isError ? (
        <Card size="sm" className="max-w-3xl">
          <CardHeader>
            <CardTitle>Could not load requisitions</CardTitle>
            <CardDescription>
              {query.error instanceof ApiRequestError
                ? `${query.error.code}: ${query.error.message}`
                : 'Unexpected error contacting the backend.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : query.data.items.length === 0 ? (
        <Card size="sm" className="max-w-3xl">
          <CardHeader>
            <CardTitle>No requisitions yet</CardTitle>
            <CardDescription>
              You are signed in as the seeded owner. Once the create-requisition form lands
              in Phase 0.x, new requisitions will appear here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="grid gap-3" data-testid="requisitions-list">
          {query.data.items.map((r) => (
            <li key={r.id}>
              <Card size="sm" className="max-w-3xl">
                <CardHeader>
                  <CardTitle>{r.title}</CardTitle>
                  <CardDescription>
                    {r.grade} · {r.salaryMin.toLocaleString()}–{r.salaryMax.toLocaleString()}{' '}
                    {r.currency} · {r.status}
                  </CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function RequisitionsNewPage() {
  return (
    <Phase0Page
      badge="Recruiting · Requisitions"
      title="New hiring requisition"
      description="Capture title, grade, salary range, currency, and justification. Submission moves the requisition into the approval FSM."
      todo={[
        'TanStack Form bound to the shared Zod schema in @web-app-demo/contracts',
        'Salary range invariant: salary_min ≤ salary_max',
        'On submit: POST /api/requisitions then navigate to /requisitions/:id',
      ]}
    />
  )
}

export function RequisitionDetailPage() {
  return (
    <Phase0Page
      badge="Recruiting · Requisitions"
      title="Requisition detail"
      description="Full requisition view with FSM action buttons, gated by the actor's roles."
      todo={[
        'GET /api/requisitions/:id',
        'PATCH /api/requisitions/:id/status — calls canTransition before mutating',
        'Auto-create Vacancy on transition approved → in_recruitment',
      ]}
    />
  )
}

export function VacanciesPage() {
  return (
    <Phase0Page
      badge="Recruiting · Vacancies"
      title="Vacancies"
      description="Read-only list of live vacancies. Vacancies are created automatically when a requisition reaches in_recruitment."
      todo={[
        'GET /api/vacancies',
        'Read-only in Phase 0; publishing controls land in Phase 1',
      ]}
    />
  )
}

export function VacancyDetailPage() {
  return (
    <Phase0Page
      badge="Recruiting · Vacancies"
      title="Vacancy detail"
      description="Vacancy description and the list of applications attached to it."
      todo={[
        'GET /api/vacancies/:id',
        'Link to the Kanban board filtered to this vacancy',
      ]}
    />
  )
}

export function ApplicationsPage() {
  return (
    <Phase0Page
      badge="Recruiting · Kanban"
      title="Applications"
      description="Kanban board over stages: new, screen, tech, final, offer, hired, rejected. Drag-and-drop triggers PATCH /api/applications/:id/stage which calls canTransition."
      todo={[
        'GET /api/applications?vacancy_id=…',
        'Drag-and-drop cards between stage columns',
        'AI scoring panel is deferred to Phase 1',
      ]}
    />
  )
}

export function ApplicationDetailPage() {
  return (
    <Phase0Page
      badge="Recruiting · Kanban"
      title="Application detail"
      description="Candidate profile, resume, stage history (ApplicationStageEvent), and notes."
      todo={[
        'GET /api/applications/:id',
        'Stage event timeline rendered from ApplicationStageEvent',
        'Resume preview + private download via signed URL (Phase 1 storage wiring)',
      ]}
    />
  )
}

export function AdminUsersPage() {
  return (
    <Phase0Page
      badge="Admin"
      title="Users and roles"
      description="List users with their roles. Owner / hr_admin can grant or revoke roles."
      todo={[
        'GET /api/admin/users',
        'POST /api/admin/users/:id/roles — add role',
        'DELETE /api/admin/users/:id/roles/:role — remove role',
      ]}
    />
  )
}

export function AdminAuditLogPage() {
  return (
    <Phase0Page
      badge="Admin"
      title="Audit log"
      description="Paginated view of AuditEvent rows. Filterable by actor, entity_type, and entity_id."
      todo={[
        'GET /api/admin/audit-events with cursor pagination',
        'Filters: actor_user_id, entity_type, entity_id, date range',
        'Redaction is enforced server-side (backend/src/http/audit.ts)',
      ]}
    />
  )
}
