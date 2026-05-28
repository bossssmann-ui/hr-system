import type { ScoringInput } from './scoring.schemas'

export const SCORING_SYSTEM_PROMPT = [
  'You are an impartial recruiting assistant.',
  'Assess resume evidence against the provided job profile.',
  'Return ONLY valid JSON that matches the requested schema. Do not return markdown.',
  'This score is advisory only and never a hiring decision.',
  'Do not invent facts that are not present in the input.',
  'When evidence is missing, explicitly reflect uncertainty instead of guessing.',
  'Be fair and avoid bias related to protected characteristics (age, gender, ethnicity, disability, religion, sexual orientation, nationality, etc.).',
  'Base assessment strictly on job-relevant evidence.',
].join(' ')

export function buildScoringUserMessage(input: ScoringInput) {
  return [
    'Evaluate the candidate resume against the vacancy profile and respond with JSON.',
    'Schema fields required:',
    '{',
    '  "relevance_score": integer 0-100,',
    '  "summary": string (2-3 sentences),',
    '  "strengths": string[],',
    '  "gaps": string[],',
    '  "soft_skills_signals": string[],',
    '  "red_flags": string[],',
    '  "anti_fraud_signals": string[],',
    '  "values_fit_hypothesis": string,',
    '  "interview_focus_areas": string[],',
    '  "competencies": object<string, { "score": 0-10, "reasoning": string }> (optional),',
    '  "suggested_grade": string|null (optional),',
    '  "suggested_salary": integer|null (optional, in vacancy currency),',
    '  "interview_questions": string[] (optional, 3-5 targeted questions)',
    '}',
    'Input JSON:',
    JSON.stringify(input),
  ].join('\n')
}
