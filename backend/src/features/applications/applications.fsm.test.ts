import { describe, expect, test } from 'bun:test'

import { ROLES, type Role } from '../requisitions/requisitions.fsm'
import {
  APPLICATION_STAGES,
  APPLICATION_TRANSITIONS,
  allowedNextStages,
  canTransition,
  isTerminalStage,
  type ApplicationStage,
} from './applications.fsm'

describe('applications FSM', () => {
  test('every declared transition is allowed for at least one of its roles', () => {
    for (const t of APPLICATION_TRANSITIONS) {
      for (const role of t.allowedRoles) {
        expect(canTransition(t.from, t.to, [role])).toBe(true)
      }
    }
  })

  test('every declared transition is forbidden for roles outside the allow-list', () => {
    for (const t of APPLICATION_TRANSITIONS) {
      const forbidden = ROLES.filter((r) => !t.allowedRoles.includes(r))
      for (const role of forbidden) {
        expect(canTransition(t.from, t.to, [role])).toBe(false)
      }
    }
  })

  test('transitions not in the table are rejected for every role', () => {
    const declared = new Set(APPLICATION_TRANSITIONS.map((t) => `${t.from}->${t.to}`))
    for (const from of APPLICATION_STAGES) {
      for (const to of APPLICATION_STAGES) {
        if (from === to) continue
        if (declared.has(`${from}->${to}`)) continue
        for (const role of ROLES) {
          expect(canTransition(from, to, [role])).toBe(false)
        }
      }
    }
  })

  test('hired and rejected are terminal — no outbound transitions', () => {
    const terminal: ApplicationStage[] = ['hired', 'rejected']
    for (const from of terminal) {
      expect(isTerminalStage(from)).toBe(true)
      for (const to of APPLICATION_STAGES) {
        for (const role of ROLES) {
          expect(canTransition(from, to, [role])).toBe(false)
        }
      }
    }
  })

  test('recruiter can advance the funnel forward but cannot move backwards', () => {
    expect(canTransition('new', 'screen', ['recruiter'])).toBe(true)
    expect(canTransition('screen', 'tech', ['recruiter'])).toBe(true)
    expect(canTransition('tech', 'final', ['recruiter'])).toBe(true)
    expect(canTransition('final', 'offer', ['recruiter'])).toBe(true)
    expect(canTransition('offer', 'hired', ['recruiter'])).toBe(true)

    expect(canTransition('screen', 'new', ['recruiter'])).toBe(false)
    expect(canTransition('tech', 'screen', ['recruiter'])).toBe(false)
    expect(canTransition('offer', 'final', ['recruiter'])).toBe(false)
  })

  test('hr_admin and owner can move backwards as a correction path', () => {
    for (const role of ['hr_admin', 'owner'] as Role[]) {
      expect(canTransition('screen', 'new', [role])).toBe(true)
      expect(canTransition('tech', 'screen', [role])).toBe(true)
      expect(canTransition('final', 'tech', [role])).toBe(true)
      expect(canTransition('offer', 'final', [role])).toBe(true)
    }
  })

  test('recruiter / hr_admin / owner can reject from any non-terminal stage', () => {
    for (const from of ['new', 'screen', 'tech', 'final', 'offer'] as ApplicationStage[]) {
      for (const role of ['recruiter', 'hr_admin', 'owner'] as Role[]) {
        expect(canTransition(from, 'rejected', [role])).toBe(true)
      }
    }
  })

  test('hiring_manager can only advance tech → final', () => {
    expect(canTransition('tech', 'final', ['hiring_manager'])).toBe(true)
    expect(canTransition('new', 'screen', ['hiring_manager'])).toBe(false)
    expect(canTransition('offer', 'hired', ['hiring_manager'])).toBe(false)
    expect(canTransition('screen', 'rejected', ['hiring_manager'])).toBe(false)
  })

  test('employee and candidate cannot move any application', () => {
    for (const t of APPLICATION_TRANSITIONS) {
      for (const role of ['employee', 'candidate'] as Role[]) {
        expect(canTransition(t.from, t.to, [role])).toBe(false)
      }
    }
  })

  test('allowedNextStages returns the union of role permissions', () => {
    expect(allowedNextStages('new', ['recruiter']).sort()).toEqual(['rejected', 'screen'])
    expect(allowedNextStages('new', ['employee'])).toEqual([])
    // hr_admin from 'tech' can go forward, backward, or reject.
    const adminFromTech = allowedNextStages('tech', ['hr_admin']).sort()
    expect(adminFromTech).toContain('final')
    expect(adminFromTech).toContain('screen')
    expect(adminFromTech).toContain('new')
    expect(adminFromTech).toContain('rejected')
  })
})
