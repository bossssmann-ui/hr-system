import { createBackendRuntime, type BackendRuntime } from './runtime'

export async function runWorker(runtime: BackendRuntime) {
  void runtime
  console.log('Backend worker entrypoint initialized; waiting for background handlers.')

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.off('SIGINT', shutdown)
      process.off('SIGTERM', shutdown)
      resolve()
    }

    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
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
