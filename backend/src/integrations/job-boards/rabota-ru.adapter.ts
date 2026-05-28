/**
 * RabotaRuAdapter — Phase 8 stub for the Работа.ру job board.
 */
import { HttpJobBoardAdapter, type HttpJobBoardOptions } from './http-adapter'

export const RABOTA_RU_BASE_URL = 'https://api.rabota.ru/v4'

export class RabotaRuAdapter extends HttpJobBoardAdapter {
  constructor(options: Omit<HttpJobBoardOptions, 'board' | 'baseUrl'>) {
    super({ board: 'rabota_ru', baseUrl: RABOTA_RU_BASE_URL, ...options })
  }
}
