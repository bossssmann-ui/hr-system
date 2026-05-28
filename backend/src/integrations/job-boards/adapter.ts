/**
 * IJobBoardAdapter — Phase 8 unified interface for external job-board
 * integrations (HH.ru, СберПодбор, Avito Jobs, Работа.ру).
 *
 * Each board is gated by its own feature flag. Adapters are intentionally
 * thin and side-effect free at construction time so they can be mocked in
 * tests and instantiated lazily by `getJobBoardAdapters(env)`.
 *
 * Concrete adapters live next to this file:
 *   - sber-podbor.adapter.ts  (SBER_PODBOR_ENABLED)
 *   - avito-jobs.adapter.ts   (AVITO_JOBS_ENABLED)
 *   - rabota-ru.adapter.ts    (RABOTA_RU_ENABLED)
 *
 * HH.ru remains in `integrations/hh/` because it predates this interface
 * and needs OAuth + per-tenant token storage; it can be wrapped behind
 * IJobBoardAdapter later if the call sites converge.
 */
import type { AppEnv } from '../../env'

export type JobBoardKey = 'sber_podbor' | 'avito_jobs' | 'rabota_ru'

export type JobBoardVacancyInput = {
  id: string
  title: string
  description: string
  location?: string | null
  salaryFrom?: number | null
  salaryTo?: number | null
  currency?: string | null
  applyUrl?: string | null
}

export type ExternalApplication = {
  externalId: string
  receivedAt: Date
  candidate: {
    fullName: string
    email?: string | null
    phone?: string | null
    resumeUrl?: string | null
  }
  vacancyExternalId?: string | null
  coverLetter?: string | null
}

export interface IJobBoardAdapter {
  readonly board: JobBoardKey

  /** Publish (or update) a vacancy on the board. Returns the external id. */
  publishVacancy(vacancy: JobBoardVacancyInput): Promise<string>

  /** Remove the published vacancy from the board. */
  unpublishVacancy(externalId: string): Promise<void>

  /** Pull applications received since the given timestamp. */
  pullApplications(since: Date): Promise<ExternalApplication[]>

  /** Push a status change for an application back to the board. */
  updateApplicationStatus(externalId: string, status: string): Promise<void>
}

export type JobBoardConfig = {
  board: JobBoardKey
  enabled: boolean
  configured: boolean
  reason: string | null
}

export function jobBoardConfigs(env: AppEnv): JobBoardConfig[] {
  return [
    boardConfig('sber_podbor', env.SBER_PODBOR_ENABLED, env.SBER_PODBOR_API_TOKEN),
    boardConfig('avito_jobs', env.AVITO_JOBS_ENABLED, env.AVITO_JOBS_API_TOKEN),
    boardConfig('rabota_ru', env.RABOTA_RU_ENABLED, env.RABOTA_RU_API_TOKEN),
  ]
}

function boardConfig(board: JobBoardKey, enabled: boolean, token: string | undefined): JobBoardConfig {
  if (!enabled) {
    return { board, enabled: false, configured: false, reason: `${board.toUpperCase()}_ENABLED=false` }
  }
  if (!token) {
    return { board, enabled: false, configured: false, reason: 'API token is missing' }
  }
  return { board, enabled: true, configured: true, reason: null }
}
