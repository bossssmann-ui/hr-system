/**
 * Interview protocol LLM prompts.
 *
 * Uses the existing Phase 1C Anthropic LLM provider seam.
 *
 * Privacy note: the transcript is sent to the LLM for protocol-building.
 * Unlike resume scoring (Phase 1C), PII is NOT stripped here — the protocol
 * legitimately needs interview context. The legal basis is the candidate's
 * recorded consent (consent_recorded = true). If using a non-RF LLM, this is
 * a data-residency consideration for the owner to weigh (see docs/contracts/40-audit.md).
 */

import type { TranscriptSegment } from '../../features/interviews/interviews.schemas'

export const PROTOCOL_SYSTEM_PROMPT = `You are an expert HR interview analyst. Your task is to analyze interview transcripts and produce a structured interview protocol.

Rules:
1. Extract only what was actually said in the transcript. Do NOT invent information.
2. For each agreed term (salary, start_date, special_conditions), include the verbatim quote and the segment index from the transcript.
3. If a term was discussed ambiguously, include it with an empty/null value and note the ambiguity in special_conditions.
4. Do NOT fabricate any agreed terms if they were not explicitly discussed.
5. Return strictly valid JSON matching the specified schema. No markdown, no prose outside JSON.
6. The schema_version is always 1.`

export function buildProtocolUserMessage(segments: TranscriptSegment[]): string {
  const formattedTranscript = segments
    .map(
      (seg, idx) =>
        `[${idx}] ${seg.speaker} (${msToTime(seg.start_ms)}–${msToTime(seg.end_ms)}): ${seg.text}`,
    )
    .join('\n')

  return `Analyze the following interview transcript and produce a structured protocol.

TRANSCRIPT:
${formattedTranscript}

Return a JSON object with this exact structure:
{
  "summary": "<brief overall summary of the interview>",
  "questions_and_answers": [
    {
      "question": "<interviewer question>",
      "answer": "<candidate answer>",
      "segment_indices": [<list of segment indices that contain this Q&A>]
    }
  ],
  "agreed_terms": {
    "salary": <number or null>,
    "currency": "<string or null>",
    "start_date": "<ISO date string or null>",
    "special_conditions": ["<condition1>", ...],
    "salary_source": { "segment_index": <number>, "quote": "<verbatim quote>" } or null,
    "start_date_source": { "segment_index": <number>, "quote": "<verbatim quote>" } or null,
    "special_conditions_sources": [{ "segment_index": <number>, "quote": "<verbatim quote>" }, ...]
  },
  "strengths": ["<strength1>", ...],
  "concerns": ["<concern1>", ...]
}

Important: only include agreed_terms values that were explicitly stated in the transcript.`
}

function msToTime(ms: number): string {
  const totalSecs = Math.floor(ms / 1000)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}
