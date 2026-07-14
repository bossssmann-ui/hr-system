/**
 * Phase 15a — Capacity Guard for AI Interviews
 *
 * In-memory implementation sufficient for Phase 15a.
 * For production, replace with a durable store.
 */

export interface CapacityGuard {
  canStart(): boolean
  register(sessionId: string): void
  release(sessionId: string): void
  getActiveCount(): number
  /** Returns estimated wait time in minutes if capacity is full */
  getNextSlotMinutes(): number
}

export interface CapacityGuardConfig {
  maxActive?: number
  slotDurationMin?: number
  bufferMin?: number
}

export function createCapacityGuard(config?: CapacityGuardConfig): CapacityGuard {
  // Read from env if not provided in config
  const envMax = process.env['MAX_ACTIVE_AI_INTERVIEWS']
  const maxActive = config?.maxActive ?? (envMax ? parseInt(envMax, 10) : 3)
  const slotDurationMin = config?.slotDurationMin ?? 30
  const bufferMin = config?.bufferMin ?? 5

  const activeSessions = new Set<string>()

  return {
    canStart(): boolean {
      return activeSessions.size < maxActive
    },

    register(sessionId: string): void {
      activeSessions.add(sessionId)
    },

    release(sessionId: string): void {
      activeSessions.delete(sessionId)
    },

    getActiveCount(): number {
      return activeSessions.size
    },

    getNextSlotMinutes(): number {
      return slotDurationMin + bufferMin
    },
  }
}

let sharedCapacityGuard: CapacityGuard | null = null

export function getSharedCapacityGuard(): CapacityGuard {
  if (!sharedCapacityGuard) {
    sharedCapacityGuard = createCapacityGuard()
  }
  return sharedCapacityGuard
}

export function resetSharedCapacityGuardForTests(): void {
  sharedCapacityGuard = null
}
