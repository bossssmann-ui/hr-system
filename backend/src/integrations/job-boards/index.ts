/**
 * Job-board adapter registry — instantiates only the adapters whose feature
 * flag and API token are present.
 */
import type { AppEnv } from '../../env'
import type { IJobBoardAdapter, JobBoardKey } from './adapter'
import { AvitoJobsAdapter } from './avito-jobs.adapter'
import { RabotaRuAdapter } from './rabota-ru.adapter'
import { SberPodborAdapter } from './sber-podbor.adapter'

export function getJobBoardAdapters(env: AppEnv): Partial<Record<JobBoardKey, IJobBoardAdapter>> {
  const adapters: Partial<Record<JobBoardKey, IJobBoardAdapter>> = {}
  if (env.SBER_PODBOR_ENABLED && env.SBER_PODBOR_API_TOKEN) {
    adapters.sber_podbor = new SberPodborAdapter({ apiToken: env.SBER_PODBOR_API_TOKEN })
  }
  if (env.AVITO_JOBS_ENABLED && env.AVITO_JOBS_API_TOKEN) {
    adapters.avito_jobs = new AvitoJobsAdapter({ apiToken: env.AVITO_JOBS_API_TOKEN })
  }
  if (env.RABOTA_RU_ENABLED && env.RABOTA_RU_API_TOKEN) {
    adapters.rabota_ru = new RabotaRuAdapter({ apiToken: env.RABOTA_RU_API_TOKEN })
  }
  return adapters
}

export type { IJobBoardAdapter, JobBoardKey } from './adapter'
export type {
  ExternalApplication,
  JobBoardConfig,
  JobBoardVacancyInput,
} from './adapter'
export { jobBoardConfigs } from './adapter'
export { HttpJobBoardAdapter } from './http-adapter'
export { SberPodborAdapter } from './sber-podbor.adapter'
export { AvitoJobsAdapter } from './avito-jobs.adapter'
export { RabotaRuAdapter } from './rabota-ru.adapter'
