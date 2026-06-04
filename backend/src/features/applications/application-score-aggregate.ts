import type { Prisma } from '../../generated/prisma/client'

export type UnifiedScoreStatus = 'preliminary' | 'final'

export type UnifiedScore = {
  value: number | null
  status: UnifiedScoreStatus | null
}

export function computeUnifiedScore(input: {
  finalSelectionScore: Prisma.Decimal | number | null | undefined
  preliminaryAiScore: Prisma.Decimal | number | null | undefined
}): UnifiedScore {
  if (input.finalSelectionScore !== null && input.finalSelectionScore !== undefined) {
    return { value: Number(input.finalSelectionScore), status: 'final' }
  }
  if (input.preliminaryAiScore !== null && input.preliminaryAiScore !== undefined) {
    return { value: Number(input.preliminaryAiScore), status: 'preliminary' }
  }
  return { value: null, status: null }
}
