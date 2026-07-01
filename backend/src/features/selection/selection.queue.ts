/**
 * Phase 2 — Selection System queue and background worker.
 *
 * Cross-check flag logic and BullMQ-compatible in-process worker
 * that calls the Anthropic AI evaluator after all 4 stages are submitted.
 */

import { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import {
  recomputeCompositeScoreForApplication,
  recordCompositeScoreRecomputeFailure,
} from '../applications/composite-score'
import { callGeminiGenerateContent, GeminiApiError } from '../../integrations/llm/gemini'
import { createInMemoryQueue } from '../../queues'
import { notifyRecruitersAboutSelectionReady } from '../applications/application-notifications'
import { notifyRecipientsForEvent } from '../notifications/recruiter-event-notifications'
import { computeDomesticCrossCheckFlags } from './domestic-cross-check'
import type { DomesticAssessmentProfile } from './domestic-scoring'
import { runAutoAssessmentAfterSelection } from './auto-assessment-after-selection'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrossCheckFlag {
  id: number
  type: 'RED' | 'ORANGE'
  description: string
  triggeredAt: number // stage number
}

interface StageSnapshot {
  stageNumber: number
  answers: Record<string, unknown>
  flags: CrossCheckFlag[]
}

// ─── Cross-check flag computation ─────────────────────────────────────────────

/**
 * Compute cross-check flags for the current stage being submitted.
 * Rules per docs/assessment-system-design.md — Anti-lie mechanisms.
 */
export function computeCrossCheckFlags(
  stageNumber: number,
  answers: Record<string, unknown>,
  role: 'logist' | 'sales_manager' | 'logist_domestic',
  previousStages: StageSnapshot[],
): CrossCheckFlag[] {
  const flags: CrossCheckFlag[] = []

  if (stageNumber === 1) {
    // Stop-criteria on Stage 1.
    // Any "fail" answer to these screening questions is itself a RED flag
    // and triggers auto-rejection without invoking the AI evaluator.
    // The questionnaire UI exposes these as `stop_*` keys.
    const stopChecks: Array<{ key: string; description: string }> = [
      { key: 'stop_experience', description: 'Стоп-критерий: профильный опыт ниже минимального порога' },
    ]
    let nextStopId = 100
    for (const sc of stopChecks) {
      const v = answers[sc.key]
      if (v === true || v === 'fail' || v === 'no' || v === 'reject') {
        flags.push({
          id: nextStopId++,
          type: 'RED',
          description: sc.description,
          triggeredAt: 1,
        })
      }
    }

    // RED-1: Stage-1 expertise trap.
    const trapAnswer1 = answers['trap_answer_1'] ?? answers['trap_answer']
    const trapAnswer1IsHit = (() => {
      if (role === 'logist') {
        return trapAnswer1 === 'Да, перегруза нет' || trapAnswer1 === 'Перегруз нужен только для опасных грузов'
      }
      if (role === 'sales_manager') {
        return trapAnswer1 === 'Да, FOB универсален для контейнеров'
      }
      return false
    })()
    if (trapAnswer1IsHit) {
      flags.push({
        id: 1,
        type: 'RED',
        description:
          role === 'logist'
            ? 'Кандидат ошибся в ловушке про разрыв колеи Китай–Россия (1435/1520)'
            : 'Кандидат ошибся в ловушке по условиям поставки FOB для контейнерных перевозок',
        triggeredAt: 1,
      })
    }
  }

  if (stageNumber === 3) {
    // ORANGE-5: L-scale — 3 or more answers of "5" in psychology test (questions 17–20)
    const lScaleAnswers = [
      answers['q17'], answers['q18'], answers['q19'], answers['q20'],
    ]
    const lScoreFivesCount = lScaleAnswers.filter((a) => a === 5 || a === '5').length
    if (lScoreFivesCount >= 3) {
      flags.push({
        id: 5,
        type: 'ORANGE',
        description: `L-шкала психотеста: ${lScoreFivesCount} ответа «5» из 4 — высокий риск социально-желательных ответов`,
        triggeredAt: 3,
      })
    }
  }

  // domestic role: run additional domestic cross-check flags
  if (role === 'logist_domestic') {
    const profile: DomesticAssessmentProfile = {
      candidateId: '',
      signals: [],
      specializations: [],
      riskFlags: Array.isArray(answers['risk_flags']) ? (answers['risk_flags'] as string[]) : [],
    }
    const domesticFlags = computeDomesticCrossCheckFlags(profile, answers as Record<string, unknown>)
    for (const df of domesticFlags) {
      flags.push({
        id: df.id + 200,
        type: df.type,
        description: df.description,
        triggeredAt: stageNumber,
      })
    }
  }

  return flags
}

/**
 * Stage 1 auto-rejection rule (Phase 14 §6 "anti-lie" / §11 "stop-criteria"):
 * any stop-criterion or 2+ RED flags must reject the candidate immediately,
 * before any further stage is presented and without calling the AI evaluator.
 */
export function shouldAutoRejectAfterStage1(flags: CrossCheckFlag[]): boolean {
  const redCount = flags.filter((f) => f.type === 'RED').length
  // Stop-criteria use id ≥ 100; their presence alone is enough to reject.
  const hasStopCriterion = flags.some((f) => f.type === 'RED' && f.id >= 100)
  return hasStopCriterion || redCount >= 2
}

// ─── AI evaluation prompt ─────────────────────────────────────────────────────

const SELECTION_SYSTEM_PROMPT = `Ты — AI-оценщик системы подбора персонала Onboardix. Твоя задача: принять данные кандидата по всем 4 этапам отбора и выдать ЕДИНЫЙ ВЕРДИКТ по одной из трёх позиций: ДОПУСТИТЬ / ОТКЛОНИТЬ / НА РУЧНУЮ ПРОВЕРКУ HR.

## ВХОДНЫЕ ДАННЫЕ

Ты получаешь структурированный JSON с данными кандидата:
- candidate_id: идентификатор
- role: "logist" | "sales_manager"
- stage_1: данные анкеты (ответы, флаги стоп-критериев, флаги ловушек)
- stage_2: результаты профессионального теста (баллы по вопросам, открытые ответы)
- stage_3: результаты психологического теста (баллы по блокам, L-шкала)
- stage_4: тестовое задание (текст ответа кандидата)
- cross_check_flags: массив флагов несоответствий, выявленных на предыдущих этапах

## ВЕСА ЭТАПОВ

| Этап | Вес в итоговой оценке |
|------|-----------------------|
| Этап 1 (Анкета) | Бинарный фильтр — при стоп-критерии: ОТКЛОНИТЬ без дальнейшего анализа |
| Этап 2 (Профтест) | 40% итоговой оценки |
| Этап 3 (Психотест) | 20% итоговой оценки |
| Этап 4 (Тестовое задание) | 40% итоговой оценки |

Итоговый балл = (Этап2_балл / Этап2_макс) × 40 + (Этап3_балл / Этап3_макс) × 20 + (Этап4_балл / Этап4_макс) × 40

## ПРАВИЛА ВЫНЕСЕНИЯ ВЕРДИКТА

### ОТКЛОНИТЬ — автоматически, если выполняется ХОТЯ БЫ ОДНО:
1. Сработал стоп-критерий на Этапе 1.
2. Кандидат подтвердил знание несуществующего продукта/компании (ловушки анкеты) — КРАСНЫЙ флаг.
3. Итоговый балл Этапа 2 ниже порога (< 22/35 для обеих ролей).
4. Итоговый балл Этапа 4 ниже порога (< 16/25 для логиста, < 15/23 для менеджера продаж).
5. Итоговый взвешенный балл < 50%.
6. Сработало 2 и более КРАСНЫХ флага cross-check.

### ДОПУСТИТЬ — если выполняются ВСЕ условия:
1. Ни одного стоп-критерия на Этапе 1.
2. Ни одного КРАСНОГО флага cross-check.
3. Этап 2 ≥ 22 балла.
4. Этап 4 ≥ порог роли.
5. Итоговый взвешенный балл ≥ 65%.
6. L-шкала: не более 1 ответа «5».

### НА РУЧНУЮ ПРОВЕРКУ HR — во всех остальных случаях.

## ФОРМАТ ВЫВОДА

Верни результат строго в следующем формате JSON (без markdown, без prose вне JSON):

{
  "candidate_id": "...",
  "role": "...",
  "verdict": "ДОПУСТИТЬ" | "ОТКЛОНИТЬ" | "НА РУЧНУЮ ПРОВЕРКУ HR",
  "total_weighted_score": число от 0 до 100,
  "stage_scores": {
    "stage_2_score": X,
    "stage_2_max": 35,
    "stage_3_score": X,
    "stage_3_max": 64,
    "stage_4_score": X,
    "stage_4_max": 25
  },
  "cross_check_flags": [
    {
      "flag_id": 1,
      "type": "RED" | "ORANGE",
      "description": "краткое описание несоответствия",
      "impact": "краткое описание влияния на вердикт"
    }
  ],
  "lie_scale_result": {
    "score_5_count": число,
    "reliability": "RELIABLE" | "MODERATE_RISK" | "UNRELIABLE"
  },
  "verdict_reason": "Краткое обоснование вердикта (3–5 предложений).",
  "hr_notes": "Для HR: что именно проверить/уточнить на живом интервью."
}

## ВАЖНЫЕ ОГРАНИЧЕНИЯ

- Ты НЕ даёшь расплывчатых ответов. Вердикт всегда один из трёх.
- Ты НЕ снижаешь стандарты из соображений «дефицита кандидатов». Планка фиксирована.
- Ты НЕ интерпретируешь флаги лжи «в пользу кандидата». Красный флаг = красный флаг.
- При любом сомнении — НА РУЧНУЮ ПРОВЕРКУ HR, не ДОПУСТИТЬ.`

// ─── Queue & worker ────────────────────────────────────────────────────────────

type EvaluateJob = {
  prisma: DbClient
  env: AppEnv
  sessionId: string
}

const evaluateQueue = createInMemoryQueue<EvaluateJob>('assessment:evaluate')
let registered = false

function ensureRegistered() {
  if (registered) return
  registered = true
  evaluateQueue.process(async (job) => {
    await runEvaluation(job)
  })
}

export async function enqueueSelectionEvaluate(input: EvaluateJob) {
  ensureRegistered()
  await evaluateQueue.enqueue(input)
  return { queued: true as const }
}

ensureRegistered()

async function runEvaluation({ prisma, env, sessionId }: EvaluateJob): Promise<void> {
  // 1. Load full session with all stage results
  const session = await prisma.selectionSession.findUnique({
    where: { id: sessionId },
    include: {
      template: true,
      stageResults: { orderBy: { stageNumber: 'asc' } },
    },
  })
  if (!session) {
    console.error(JSON.stringify({ level: 'error', msg: 'selection.evaluator.session_not_found', sessionId }))
    return
  }

  // 2. Collect all cross-check flags from stage results
  const allFlags: CrossCheckFlag[] = session.stageResults.flatMap(
    (r) => (Array.isArray(r.flags) ? (r.flags as unknown as CrossCheckFlag[]) : []),
  )

  // 3. Build the AI prompt payload
  const stageMap: Record<number, Record<string, unknown>> = {}
  for (const result of session.stageResults) {
    stageMap[result.stageNumber] = result.answers as Record<string, unknown>
  }

  const promptPayload = {
    candidate_id: session.applicationId ?? session.id,
    role: session.template.role,
    stage_1: stageMap[1] ?? {},
    stage_2: stageMap[2] ?? {},
    stage_3: stageMap[3] ?? {},
    stage_4: stageMap[4] ?? {},
    cross_check_flags: allFlags,
  }

  // 4. Call Gemini 2.0 Flash via fetch on generativelanguage.googleapis.com
  if (!env.GEMINI_API_KEY) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'selection.evaluator.no_api_key',
      sessionId,
    }))
    return
  }

  let rawText: string
  try {
    const result = await callGeminiGenerateContent({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
      systemInstruction: SELECTION_SYSTEM_PROMPT,
      userText: `Оцени кандидата. Данные:\n\n${JSON.stringify(promptPayload, null, 2)}\n\nВерни результат строго в формате JSON.`,
    })
    rawText = result.text
  } catch (err) {
    const status = err instanceof GeminiApiError ? err.status : undefined
    console.error(JSON.stringify({
      level: 'error',
      msg: 'selection.evaluator.api_error',
      sessionId,
      status,
      err: String(err),
    }))
    return
  }

  // 5. Parse JSON from response
  let parsed: Record<string, unknown> | null = null
  try {
    // Extract JSON from response (may have prose around it)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    }
  } catch {
    console.error(JSON.stringify({ level: 'error', msg: 'selection.evaluator.parse_error', sessionId, rawText }))
    return
  }

  if (!parsed) return

  // 6. Write verdict to database. For domestic sessions, a deterministic
  // verdict has already been written in `finalizeDomesticStage4` and must NOT
  // be overwritten — we only append the AI's second opinion to the textual
  // notes. For other roles, upsert to keep the worker idempotent on retries.
  try {
    const aiVerdict = String(parsed['verdict'] ?? 'НА РУЧНУЮ ПРОВЕРКУ HR')
    const aiReason = parsed['verdict_reason'] != null ? String(parsed['verdict_reason']) : null
    const aiNotes = parsed['hr_notes'] != null ? String(parsed['hr_notes']) : null

    const isDomestic = session.template.role === 'logist_domestic'
    const existing = isDomestic
      ? await prisma.selectionVerdict.findUnique({ where: { sessionId } })
      : null

    if (isDomestic && existing) {
      // Preserve deterministic numbers/verdict; append AI second opinion to
      // free-text fields only.
      const aiOpinion = `AI второе мнение: ${aiVerdict}` + (aiReason ? `\n${aiReason}` : '')
      await prisma.selectionVerdict.update({
        where: { sessionId },
        data: {
          verdictReason: existing.verdictReason
            ? `${existing.verdictReason}\n\n${aiOpinion}`
            : aiOpinion,
          hrNotes: aiNotes
            ? existing.hrNotes
              ? `${existing.hrNotes}\n\n${aiNotes}`
              : aiNotes
            : existing.hrNotes,
          lieScaleResult: existing.lieScaleResult ??
            ((parsed['lie_scale_result'] ?? null) as Prisma.InputJsonValue),
        },
      })
    } else {
      const baseData = {
        verdict: aiVerdict,
        totalWeightedScore: parsed['total_weighted_score'] != null
          ? new Prisma.Decimal(String(parsed['total_weighted_score']))
          : null,
        stageScores: (parsed['stage_scores'] ?? null) as Prisma.InputJsonValue,
        crossCheckFlags: (parsed['cross_check_flags'] ?? allFlags) as Prisma.InputJsonValue,
        retentionPrediction: (parsed['retention_prediction'] ?? null) as Prisma.InputJsonValue,
        lieScaleResult: (parsed['lie_scale_result'] ?? null) as Prisma.InputJsonValue,
        verdictReason: aiReason,
        hrNotes: aiNotes,
      }
      await prisma.selectionVerdict.upsert({
        where: { sessionId },
        create: { sessionId, ...baseData },
        update: baseData,
      })
    }
    if (session.applicationId) {
      try {
        await recomputeCompositeScoreForApplication({
          prisma,
          env,
          applicationId: session.applicationId,
        })
      } catch (error) {
        await recordCompositeScoreRecomputeFailure({
          prisma,
          applicationId: session.applicationId,
          error,
        })
      }
    }
    const normalizedVerdict = aiVerdict.toUpperCase()
    const totalScoreRaw = parsed['total_weighted_score']
    const totalScore =
      totalScoreRaw !== null && totalScoreRaw !== undefined && !Number.isNaN(Number(totalScoreRaw))
        ? Number(totalScoreRaw)
        : null
    if (
      env.RECRUITER_NOTIFICATIONS_ENABLED &&
      session.applicationId &&
      (normalizedVerdict.includes('ДОПУСТИТЬ') || normalizedVerdict.includes('ОТКЛОНИТЬ'))
    ) {
      await notifyRecipientsForEvent({
        prisma,
        env,
        tenantId: session.tenantId,
        applicationId: session.applicationId,
        template: 'selection.completed',
        eventKey: `selection_session.completed:${session.id}`,
        payload: {
          verdict: aiVerdict,
          totalScore,
        },
      })
    }
    if (!isDomestic && normalizedVerdict.includes('ДОПУСТИТЬ')) {
      void notifyRecruitersAboutSelectionReady({
        prisma,
        env,
        tenantId: session.tenantId,
        applicationId: session.applicationId,
        totalScore,
      })
      void runAutoAssessmentAfterSelection({
        prisma,
        env,
        applicationId: session.applicationId,
      })
    }
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'selection.evaluator.db_error', sessionId, err: String(err) }))
  }
}
