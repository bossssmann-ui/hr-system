/**
 * Finite state machine for `Application.stage` — the Kanban funnel.
 *
 * The state diagram and the per-role transition table live in
 * `docs/contracts/20-fsm.md`. This file is the executable encoding of that
 * table. Routes MUST call `canTransition(from, to, actorRoles)` before
 * mutating `Application.stage` and respond with HTTP 422
 * `fsm.forbidden_transition` on failure.
 *
 * Pure module — no I/O, no Prisma.
 */

import type { Role } from '../requisitions/requisitions.fsm'

export const APPLICATION_STAGES = [
  'new',
  'screen',
  'tech',
  'final',
  'offer',
  'hired',
  'rejected',
] as const

export type ApplicationStage = (typeof APPLICATION_STAGES)[number]

type Transition = {
  from: ApplicationStage
  to: ApplicationStage
  allowedRoles: ReadonlyArray<Role>
}

const FORWARD: ReadonlyArray<Transition> = [
  { from: 'new', to: 'screen', allowedRoles: ['recruiter', 'hr_admin', 'owner'] },
  { from: 'screen', to: 'tech', allowedRoles: ['recruiter', 'hr_admin', 'owner'] },
  { from: 'tech', to: 'final', allowedRoles: ['recruiter', 'hiring_manager', 'hr_admin', 'owner'] },
  { from: 'final', to: 'offer', allowedRoles: ['recruiter', 'hr_admin', 'owner'] },
  { from: 'offer', to: 'hired', allowedRoles: ['recruiter', 'hr_admin', 'owner'] },
]

const NON_TERMINAL: ReadonlyArray<ApplicationStage> = ['new', 'screen', 'tech', 'final', 'offer']

const REJECTIONS: ReadonlyArray<Transition> = NON_TERMINAL.map((from) => ({
  from,
  to: 'rejected' as const,
  allowedRoles: ['recruiter', 'hr_admin', 'owner'] as const,
}))

const FORWARD_ORDERED: ApplicationStage[] = ['new', 'screen', 'tech', 'final', 'offer', 'hired']

// Admin correction path: any backward forward-stage transition is allowed for
// hr_admin / owner only. `hired` is terminal so it is excluded as a source.
const BACKWARDS: Transition[] = []
for (let i = 0; i < FORWARD_ORDERED.length; i++) {
  const from = FORWARD_ORDERED[i]!
  if (from === 'hired') continue
  for (let j = 0; j < i; j++) {
    BACKWARDS.push({
      from,
      to: FORWARD_ORDERED[j]!,
      allowedRoles: ['hr_admin', 'owner'],
    })
  }
}

export const APPLICATION_TRANSITIONS: ReadonlyArray<Transition> = [
  ...FORWARD,
  ...REJECTIONS,
  ...BACKWARDS,
]

const TERMINAL_STAGES = new Set<ApplicationStage>(['hired', 'rejected'])

export function isTerminalStage(stage: ApplicationStage): boolean {
  return TERMINAL_STAGES.has(stage)
}

export function canTransition(
  from: ApplicationStage,
  to: ApplicationStage,
  actorRoles: ReadonlyArray<Role>,
): boolean {
  if (from === to) return false
  const transition = APPLICATION_TRANSITIONS.find((t) => t.from === from && t.to === to)
  if (!transition) return false
  return actorRoles.some((role) => transition.allowedRoles.includes(role))
}

export function allowedNextStages(
  from: ApplicationStage,
  actorRoles: ReadonlyArray<Role>,
): ApplicationStage[] {
  return APPLICATION_TRANSITIONS
    .filter((t) => t.from === from && actorRoles.some((role) => t.allowedRoles.includes(role)))
    .map((t) => t.to)
}
