import { describe, expect, test } from 'bun:test'

import { jobBoardConfigs } from './adapter'
import { HttpJobBoardAdapter, type JobBoardTransport } from './http-adapter'
import { SberPodborAdapter } from './sber-podbor.adapter'
import { AvitoJobsAdapter } from './avito-jobs.adapter'
import { RabotaRuAdapter } from './rabota-ru.adapter'
import { getJobBoardAdapters } from './index'

const baseEnv = {
  SBER_PODBOR_ENABLED: false,
  SBER_PODBOR_API_TOKEN: undefined,
  AVITO_JOBS_ENABLED: false,
  AVITO_JOBS_API_TOKEN: undefined,
  RABOTA_RU_ENABLED: false,
  RABOTA_RU_API_TOKEN: undefined,
} as unknown as Parameters<typeof jobBoardConfigs>[0]

describe('jobBoardConfigs', () => {
  test('reports every board as disabled when its flag is off', () => {
    const configs = jobBoardConfigs(baseEnv)
    expect(configs.map((c) => c.board).sort()).toEqual(['avito_jobs', 'rabota_ru', 'sber_podbor'])
    for (const c of configs) {
      expect(c.enabled).toBe(false)
      expect(c.configured).toBe(false)
    }
  })

  test('reports a board as enabled only when the API token is set', () => {
    const env = { ...baseEnv, SBER_PODBOR_ENABLED: true } as Parameters<typeof jobBoardConfigs>[0]
    const [sber] = jobBoardConfigs(env)
    expect(sber.enabled).toBe(false)
    expect(sber.reason).toMatch(/token/i)

    const env2 = {
      ...baseEnv,
      SBER_PODBOR_ENABLED: true,
      SBER_PODBOR_API_TOKEN: 'abc',
    } as Parameters<typeof jobBoardConfigs>[0]
    const [sber2] = jobBoardConfigs(env2)
    expect(sber2.enabled).toBe(true)
    expect(sber2.configured).toBe(true)
  })
})

describe('getJobBoardAdapters', () => {
  test('returns only enabled adapters', () => {
    const env = {
      ...baseEnv,
      SBER_PODBOR_ENABLED: true,
      SBER_PODBOR_API_TOKEN: 'tok',
      AVITO_JOBS_ENABLED: true,
      AVITO_JOBS_API_TOKEN: 'tok',
    } as Parameters<typeof getJobBoardAdapters>[0]
    const adapters = getJobBoardAdapters(env)
    expect(Object.keys(adapters).sort()).toEqual(['avito_jobs', 'sber_podbor'])
    expect(adapters.sber_podbor).toBeInstanceOf(SberPodborAdapter)
    expect(adapters.avito_jobs).toBeInstanceOf(AvitoJobsAdapter)
    expect(adapters.rabota_ru).toBeUndefined()
  })
})

describe('HttpJobBoardAdapter', () => {
  test('publishVacancy POSTs to /vacancies and returns the external id', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = []
    const transport: JobBoardTransport = async (req) => {
      calls.push({ method: req.method, path: req.path, body: req.body })
      return { id: 'ext-1' }
    }
    const adapter = new HttpJobBoardAdapter({
      board: 'sber_podbor',
      baseUrl: 'https://example.test',
      apiToken: 't',
      transport,
    })
    const externalId = await adapter.publishVacancy({
      id: 'v-1',
      title: 'Engineer',
      description: 'Build things',
    })
    expect(externalId).toBe('ext-1')
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].path).toBe('/vacancies')
  })

  test('pullApplications parses standard items array', async () => {
    const transport: JobBoardTransport = async () => ({
      items: [
        {
          id: 'a-1',
          received_at: '2026-06-01T10:00:00Z',
          candidate: { full_name: 'Иван Иванов', email: 'i@example.com' },
          vacancy_external_id: 'ext-1',
        },
      ],
    })
    const adapter = new SberPodborAdapter({ apiToken: 't', transport })
    const apps = await adapter.pullApplications(new Date('2026-05-01'))
    expect(apps).toHaveLength(1)
    expect(apps[0].externalId).toBe('a-1')
    expect(apps[0].candidate.fullName).toBe('Иван Иванов')
    expect(apps[0].vacancyExternalId).toBe('ext-1')
  })

  test('updateApplicationStatus PUTs to /applications/:id/status', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = []
    const transport: JobBoardTransport = async (req) => {
      calls.push({ method: req.method, path: req.path, body: req.body })
      return null
    }
    const adapter = new RabotaRuAdapter({ apiToken: 't', transport })
    await adapter.updateApplicationStatus('a-1', 'rejected')
    expect(calls).toEqual([
      { method: 'PUT', path: '/applications/a-1/status', body: { status: 'rejected' } },
    ])
  })

  test('publishVacancy throws when response is missing id', async () => {
    const transport: JobBoardTransport = async () => ({})
    const adapter = new AvitoJobsAdapter({ apiToken: 't', transport })
    await expect(
      adapter.publishVacancy({ id: 'v-1', title: 't', description: 'd' }),
    ).rejects.toThrow(/missing id/i)
  })
})
