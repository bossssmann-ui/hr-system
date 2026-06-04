import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { createInMemoryQueue } from '../../queues'
import { gradeOpenAssessmentAnswers } from './assessments.service'

type GradeOpenAnswersJob = {
  prisma: DbClient
  env: AppEnv
  sessionId: string
}

const gradeQueue = createInMemoryQueue<GradeOpenAnswersJob>('assessment.grade_open_answers')
let registered = false

function ensureRegistered() {
  if (registered) return
  registered = true
  gradeQueue.process(async (job) => {
    await gradeOpenAssessmentAnswers(job)
  })
}

export async function enqueueAssessmentOpenAnswerGrading(input: GradeOpenAnswersJob) {
  ensureRegistered()
  await gradeQueue.enqueue(input)
  return { queued: true as const }
}

ensureRegistered()
