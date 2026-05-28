/**
 * AvitoJobsAdapter — Phase 8 stub for the Avito Jobs board.
 */
import { HttpJobBoardAdapter, type HttpJobBoardOptions } from './http-adapter'

export const AVITO_JOBS_BASE_URL = 'https://api.avito.ru/job/v2'

export class AvitoJobsAdapter extends HttpJobBoardAdapter {
  constructor(options: Omit<HttpJobBoardOptions, 'board' | 'baseUrl'>) {
    super({ board: 'avito_jobs', baseUrl: AVITO_JOBS_BASE_URL, ...options })
  }
}
