import { createBackendRuntime, type BackendRuntime } from './runtime'
import { drainDurableQueue } from './queues'
import './features/assessments/assessments.queue'
import './features/interviews/interviews.queue'
import './features/messaging/messaging.queue'
import './features/scoring/scoring.queue'
import './features/selection/selection.queue'
import './features/selection/selection-application-bridge'

export async function runWorker(runtime: BackendRuntime) {
  console.log('Backend worker started. Polling durable queue...')
  while (true) {
    const result = await drainDurableQueue({
      prisma: runtime.prisma,
      env: runtime.env,
    })
    if (result.claimed > 0) {
      console.log(`Worker queue tick: claimed=${result.claimed} processed=${result.processed}`)
    }
    await new Promise((resolve) => setTimeout(resolve, runtime.env.QUEUE_POLL_INTERVAL_MS ?? 1000))
  }
}

export async function main() {
  const runtime = createBackendRuntime()

  try {
    await runWorker(runtime)
  } finally {
    await runtime.close()
  }
}

if (import.meta.main) {
  await main()
}
