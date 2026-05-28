/**
 * SberPodborAdapter — Phase 8 stub for the СберПодбор job board.
 *
 * Endpoint shapes match the contract defined in `IJobBoardAdapter`; the
 * exact request/response wire format will be confirmed once the partner
 * sandbox is reachable from CI. The transport is injectable so tests can
 * run without live network access.
 */
import { HttpJobBoardAdapter, type HttpJobBoardOptions } from './http-adapter'

export const SBER_PODBOR_BASE_URL = 'https://api.sberpodbor.ru/v1'

export class SberPodborAdapter extends HttpJobBoardAdapter {
  constructor(options: Omit<HttpJobBoardOptions, 'board' | 'baseUrl'>) {
    super({ board: 'sber_podbor', baseUrl: SBER_PODBOR_BASE_URL, ...options })
  }
}
