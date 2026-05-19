/**
 * Minimal queue interface.
 *
 * Phase 0 uses an in-process `setTimeout`-based runner. The producer/consumer
 * shape matches what BullMQ + Valkey will expose, so the swap can be made
 * without touching call sites. See docs/contracts/00-overview.md.
 *
 * Forbidden:
 *   - Long-running CPU-bound work in handlers (block the event loop in Phase 0).
 *   - Cross-job ordering assumptions (the in-process runner is FIFO but later
 *     queues are not guaranteed to be).
 */

export type JobHandler<TPayload> = (payload: TPayload) => Promise<void>

export interface Queue<TPayload> {
  name: string
  enqueue(payload: TPayload, opts?: { delayMs?: number }): Promise<void>
  process(handler: JobHandler<TPayload>): void
}

type Logger = {
  error: (data: Record<string, unknown>, msg: string) => void
}

const defaultLogger: Logger = {
  error: (data, msg) => console.error(JSON.stringify({ level: 'error', msg, ...data })),
}

/**
 * In-process queue: enqueue schedules a microtask (optionally after `delayMs`)
 * that invokes the registered handler. Errors are logged and swallowed so a
 * failing job does not kill the process; this matches the "best-effort"
 * Phase 0 contract for notifications and audit follow-ups.
 *
 * TODO(phase-N): replace with BullMQ + Valkey when the real-time layer lands.
 */
export function createInMemoryQueue<TPayload>(name: string, logger: Logger = defaultLogger): Queue<TPayload> {
  let handler: JobHandler<TPayload> | null = null

  return {
    name,
    async enqueue(payload, opts) {
      const run = () => {
        if (!handler) {
          logger.error({ queue: name }, 'queue.no_handler_registered')
          return
        }
        handler(payload).catch((err) => {
          logger.error({ err, queue: name }, 'queue.job_failed')
        })
      }
      if (opts?.delayMs && opts.delayMs > 0) {
        setTimeout(run, opts.delayMs)
      } else {
        queueMicrotask(run)
      }
    },
    process(h) {
      handler = h
    },
  }
}
