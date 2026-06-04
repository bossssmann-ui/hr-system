import type { DbClient } from '../db'
import type { AppEnv } from '../env'

export type JobHandler<TPayload> = (payload: TPayload) => Promise<void>

export interface Queue<TPayload> {
  name: string
  enqueue(payload: TPayload, opts?: { delayMs?: number }): Promise<void>
  process(handler: JobHandler<TPayload>): void
}

type Logger = {
  error: (data: Record<string, unknown>, msg: string) => void
}

type QueueRunnerConfig = {
  pollIntervalMs: number
  batchSize: number
  maxRetries: number
  timeoutMs: number
}

type QueueJobRow = {
  id: string
  queue_name: string
  payload: unknown
  attempts: number
  max_retries: number
}

type DrainOptions = {
  prisma: DbClient
  env: AppEnv
  config?: Partial<QueueRunnerConfig>
  queueName?: string
}

const defaultLogger: Logger = {
  error: (data, msg) => console.error(JSON.stringify({ level: 'error', msg, ...data })),
}

const handlers = new Map<string, JobHandler<unknown>>()
const transientPayloads = new Map<string, unknown>()
const activeWorkers = new Set<string>()

function queueConfigFromEnv(env: AppEnv, override?: Partial<QueueRunnerConfig>): QueueRunnerConfig {
  return {
    pollIntervalMs: override?.pollIntervalMs ?? env.QUEUE_POLL_INTERVAL_MS ?? 1000,
    batchSize: override?.batchSize ?? env.QUEUE_BATCH_SIZE ?? 20,
    maxRetries: override?.maxRetries ?? env.QUEUE_MAX_RETRIES ?? 5,
    timeoutMs: override?.timeoutMs ?? env.QUEUE_JOB_TIMEOUT_MS ?? 120000,
  }
}

function sanitizePayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return null
  if (typeof payload !== 'object') return payload
  if (Array.isArray(payload)) return payload.map((item) => sanitizePayload(item))

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'prisma' || key === 'env' || key === 'adapter' || key === 'now') continue
    if (typeof value === 'function') continue
    result[key] = sanitizePayload(value)
  }
  return result
}

function extractRuntime(payload: unknown): { prisma: DbClient; env: AppEnv } | null {
  if (!payload || typeof payload !== 'object') return null
  const maybe = payload as Record<string, unknown>
  if (maybe['prisma'] && maybe['env']) {
    return {
      prisma: maybe['prisma'] as DbClient,
      env: maybe['env'] as AppEnv,
    }
  }
  return null
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Queue job timeout after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return 'Unknown queue job error'
  }
}

function retryDelayMs(config: QueueRunnerConfig, attempts: number): number {
  const base = Math.max(250, Math.min(5_000, config.pollIntervalMs))
  const factor = 2 ** Math.max(0, attempts - 1)
  return Math.min(60_000, base * factor)
}

async function claimJobs(prisma: DbClient, config: QueueRunnerConfig, queueName?: string): Promise<QueueJobRow[]> {
  if (queueName) {
    return prisma.$queryRaw<QueueJobRow[]>`
      WITH picked AS (
        SELECT id
        FROM queue_jobs
        WHERE status = 'pending'
          AND queue_name = ${queueName}
          AND available_at <= now()
        ORDER BY available_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${config.batchSize}
      )
      UPDATE queue_jobs q
      SET status = 'processing',
          started_at = now(),
          updated_at = now()
      FROM picked
      WHERE q.id = picked.id
      RETURNING q.id, q.queue_name, q.payload, q.attempts, q.max_retries
    `
  }

  return prisma.$queryRaw<QueueJobRow[]>`
    WITH picked AS (
      SELECT id
      FROM queue_jobs
      WHERE status = 'pending'
        AND available_at <= now()
      ORDER BY available_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${config.batchSize}
    )
    UPDATE queue_jobs q
    SET status = 'processing',
        started_at = now(),
        updated_at = now()
    FROM picked
    WHERE q.id = picked.id
    RETURNING q.id, q.queue_name, q.payload, q.attempts, q.max_retries
  `
}

async function completeJob(prisma: DbClient, id: string) {
  await prisma.$executeRaw`
    UPDATE queue_jobs
    SET status = 'done',
        finished_at = now(),
        last_error = NULL,
        updated_at = now()
    WHERE id = ${id}
  `
}

async function failOrRetryJob(
  prisma: DbClient,
  id: string,
  attempts: number,
  maxRetries: number,
  err: unknown,
  config: QueueRunnerConfig,
) {
  const nextAttempts = attempts + 1
  const message = normalizeError(err)
  if (nextAttempts >= maxRetries) {
    await prisma.$executeRaw`
      UPDATE queue_jobs
      SET status = 'failed',
          attempts = ${nextAttempts},
          last_error = ${message},
          finished_at = now(),
          updated_at = now()
      WHERE id = ${id}
    `
    return
  }

  const delay = retryDelayMs(config, nextAttempts)
  await prisma.$executeRaw`
    UPDATE queue_jobs
    SET status = 'pending',
        attempts = ${nextAttempts},
        available_at = now() + (${delay} * interval '1 millisecond'),
        last_error = ${message},
        started_at = NULL,
        updated_at = now()
    WHERE id = ${id}
  `
}

export async function drainDurableQueue(options: DrainOptions): Promise<{ claimed: number; processed: number }> {
  const config = queueConfigFromEnv(options.env, options.config)
  const rows = await claimJobs(options.prisma, config, options.queueName)
  let processed = 0

  for (const row of rows) {
    const handler = handlers.get(row.queue_name)
    if (!handler) {
      await options.prisma.$executeRaw`
        UPDATE queue_jobs
        SET status = 'pending',
            available_at = now() + (${Math.max(1000, config.pollIntervalMs)} * interval '1 millisecond'),
            started_at = NULL,
            updated_at = now()
        WHERE id = ${row.id}
      `
      continue
    }

    const transient = transientPayloads.get(row.id)
    transientPayloads.delete(row.id)
    const payloadFromDb = (row.payload ?? {}) as Record<string, unknown>
    const runtimePayload = transient && typeof transient === 'object' ? (transient as Record<string, unknown>) : {}
    const jobPayload = {
      ...payloadFromDb,
      ...runtimePayload,
      prisma: runtimePayload.prisma ?? options.prisma,
      env: runtimePayload.env ?? options.env,
    }

    try {
      await withTimeout(Promise.resolve(handler(jobPayload)), config.timeoutMs)
      await completeJob(options.prisma, row.id)
      processed += 1
    } catch (err) {
      await failOrRetryJob(options.prisma, row.id, row.attempts, row.max_retries, err, config)
    }
  }

  return { claimed: rows.length, processed }
}

async function tryImmediateDrain(payload: unknown, queueName: string) {
  if (!handlers.has(queueName)) return
  const runtime = extractRuntime(payload)
  if (!runtime) return
  void drainDurableQueue({
    prisma: runtime.prisma,
    env: runtime.env,
    config: { batchSize: 1 },
  }).catch((err) => {
    // Best-effort eager execution in API process.
    defaultLogger.error({ queue: queueName, err }, 'queue.eager_drain_failed')
  })
}

export function createInMemoryQueue<TPayload>(name: string, logger: Logger = defaultLogger): Queue<TPayload> {
  return {
    name,
    async enqueue(payload, opts) {
      const runtime = extractRuntime(payload)
      if (!runtime) {
        logger.error({ queue: name }, 'queue.runtime_missing')
        return
      }
      const hasDurableSql =
        typeof (runtime.prisma as unknown as { $executeRaw?: unknown }).$executeRaw === 'function' &&
        typeof (runtime.prisma as unknown as { $queryRaw?: unknown }).$queryRaw === 'function'
      if (!hasDurableSql) {
        const run = () => {
          const handler = handlers.get(name)
          if (!handler) {
            logger.error({ queue: name }, 'queue.no_handler_registered')
            return
          }
          Promise.resolve(handler(payload as unknown)).catch((err) => {
            logger.error({ queue: name, err }, 'queue.job_failed')
          })
        }
        if (opts?.delayMs && opts.delayMs > 0) {
          setTimeout(run, opts.delayMs)
        } else {
          queueMicrotask(run)
        }
        return
      }

      const config = queueConfigFromEnv(runtime.env)
      const jobId = crypto.randomUUID()
      const delayMs = opts?.delayMs && opts.delayMs > 0 ? opts.delayMs : 0
      const safePayload = sanitizePayload(payload)

      await runtime.prisma.$executeRaw`
        INSERT INTO queue_jobs (
          id,
          queue_name,
          payload,
          status,
          attempts,
          max_retries,
          available_at,
          created_at,
          updated_at
        )
        VALUES (
          ${jobId},
          ${name},
          ${safePayload}::jsonb,
          'pending',
          0,
          ${config.maxRetries},
          now() + (${delayMs} * interval '1 millisecond'),
          now(),
          now()
        )
      `
      transientPayloads.set(jobId, payload)
      void tryImmediateDrain(payload, name)
    },
    process(handler) {
      if (activeWorkers.has(name)) return
      handlers.set(name, handler as JobHandler<unknown>)
      activeWorkers.add(name)
    },
  }
}
