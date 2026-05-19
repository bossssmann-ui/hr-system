# 20 — Finite State Machines

Two FSMs are enforced at the service layer in Phase 0. Both follow the same shape:

```ts
canTransition(from: Stage, to: Stage, actorRoles: Role[]): boolean
```

Pure functions, no I/O, fully unit-tested. Routes call `canTransition` before any update; on a forbidden transition the route returns **HTTP 422** with a structured error code (`fsm.forbidden_transition`).

> RLS is the second line of defence. Do not skip `canTransition` because RLS "would have caught it".

## HiringRequisition

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> submitted: recruiter / hiring_manager submits
    submitted --> manager_approved: hiring_manager approves
    submitted --> rejected: hiring_manager or hr_admin rejects
    manager_approved --> hr_approved: hr_admin approves
    manager_approved --> rejected: hr_admin rejects
    hr_approved --> approved: owner finalises (auto in Phase 0)
    approved --> in_recruitment: recruiter starts sourcing
    in_recruitment --> closed: recruiter closes (filled / cancelled)
    rejected --> [*]
    closed --> [*]
```

Status enum: `draft`, `submitted`, `manager_approved`, `hr_approved`, `approved`, `in_recruitment`, `closed`, `rejected`.

### Allowed transitions by role

| From → To | Allowed roles |
| --- | --- |
| `draft → submitted` | `recruiter`, `hiring_manager`, `hr_admin`, `owner` |
| `submitted → manager_approved` | `hiring_manager`, `hr_admin`, `owner` |
| `submitted → rejected` | `hiring_manager`, `hr_admin`, `owner` |
| `manager_approved → hr_approved` | `hr_admin`, `owner` |
| `manager_approved → rejected` | `hr_admin`, `owner` |
| `hr_approved → approved` | `hr_admin`, `owner` (auto in Phase 0) |
| `approved → in_recruitment` | `recruiter`, `hr_admin`, `owner` |
| `in_recruitment → closed` | `recruiter`, `hr_admin`, `owner` |

All other transitions are rejected by `canTransition`. `owner` is always allowed any legal transition (super-user inside its tenant).

### Side-effects

- On `approved → in_recruitment`, a `Vacancy` row is created or unhidden.
- Every transition writes an `AuditEvent` (`requisition.submit`, `requisition.manager_approve`, etc.).

## Application (Kanban funnel)

```mermaid
stateDiagram-v2
    [*] --> new
    new --> screen: recruiter advances
    new --> rejected: recruiter rejects
    screen --> tech: recruiter advances
    screen --> rejected: recruiter rejects
    tech --> final: recruiter advances
    tech --> rejected: recruiter rejects
    final --> offer: recruiter advances
    final --> rejected: recruiter rejects
    offer --> hired: recruiter records acceptance
    offer --> rejected: recruiter records decline
    hired --> [*]
    rejected --> [*]
```

Stage enum: `new`, `screen`, `tech`, `final`, `offer`, `hired`, `rejected`.

### Allowed transitions by role

| From → To | Allowed roles |
| --- | --- |
| `new → screen` | `recruiter`, `hr_admin`, `owner` |
| `screen → tech` | `recruiter`, `hr_admin`, `owner` |
| `tech → final` | `recruiter`, `hiring_manager`, `hr_admin`, `owner` |
| `final → offer` | `recruiter`, `hr_admin`, `owner` |
| `offer → hired` | `recruiter`, `hr_admin`, `owner` |
| `* → rejected` (any non-terminal stage) | `recruiter`, `hr_admin`, `owner` |
| Backward transitions (`screen → new`, etc.) | `hr_admin`, `owner` only (correction path) |

`hired` and `rejected` are terminal. Backward transitions exist to correct mistakes and are deliberately restricted to admin roles.

### Side-effects

- Every transition writes an `ApplicationStageEvent` row with `from_stage`, `to_stage`, `actor_user_id`, and optional `comment`.
- Every transition writes an `AuditEvent` row (`application.move_stage`).
- The Notifier emits `application.stage_changed` to the recruiter assigned to the application (in_app channel today).

## Test coverage requirement

- Each FSM module has a unit test that **enumerates every (from, to, role) triple** and asserts the legal/illegal verdict matches the tables above.
- The legal-transition matrix in tests is generated from a single source-of-truth constant, so adding a transition is one diff: schema + FSM constant + this doc.
