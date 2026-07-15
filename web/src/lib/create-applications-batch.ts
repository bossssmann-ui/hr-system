import { ApiRequestError } from '@/lib/api'

export type CreateApplicationFn = (input: {
  candidateId: string
  vacancyId: string
}) => Promise<unknown>

export type CreateApplicationsBatchResult = {
  created: number
  skipped: number
}

/**
 * Sequentially create applications for many candidates.
 * HTTP 409 (already exists) is treated as skipped, not as failure.
 */
export async function createApplicationsBatch(
  create: CreateApplicationFn,
  vacancyId: string,
  candidateIds: string[],
): Promise<CreateApplicationsBatchResult> {
  let created = 0
  let skipped = 0

  for (const candidateId of candidateIds) {
    try {
      await create({ candidateId, vacancyId })
      created += 1
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        skipped += 1
        continue
      }
      throw error
    }
  }

  return { created, skipped }
}
