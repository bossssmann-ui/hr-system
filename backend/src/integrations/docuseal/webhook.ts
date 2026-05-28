/**
 * DocuSeal webhook verification + event parser — Phase 3.
 *
 * Signatures: DocuSeal signs the raw request body with HMAC-SHA256 using the
 * tenant-configured webhook secret. The signature is delivered in a
 * `X-Docuseal-Signature` header as a lowercase hex digest. We verify with a
 * constant-time comparison against the recomputed digest.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  // Normalise header value (DocuSeal documents `sha256=<hex>` and a bare hex form).
  const provided = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader
  const expectedBuf = Buffer.from(expected, 'hex')
  let providedBuf: Buffer
  try {
    providedBuf = Buffer.from(provided, 'hex')
  } catch {
    return false
  }
  if (providedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(expectedBuf, providedBuf)
}

export type DocusealWebhookEvent = {
  event: 'submission.completed' | 'submission.declined'
  submissionId: string
  documentUrl: string | null
}

const COMPLETED_EVENTS = new Set(['submission.completed', 'form.completed'])
const DECLINED_EVENTS = new Set(['submission.declined', 'form.declined'])

export function parseWebhookEvent(payload: unknown): DocusealWebhookEvent | null {
  if (!payload || typeof payload !== 'object') return null
  const obj = payload as Record<string, unknown>
  const eventName = typeof obj.event_type === 'string'
    ? obj.event_type
    : typeof obj.event === 'string'
      ? obj.event
      : null
  if (!eventName) return null

  let resolved: 'submission.completed' | 'submission.declined' | null = null
  if (COMPLETED_EVENTS.has(eventName)) resolved = 'submission.completed'
  else if (DECLINED_EVENTS.has(eventName)) resolved = 'submission.declined'
  if (!resolved) return null

  const data = (obj.data ?? obj) as Record<string, unknown>
  const submissionId =
    (data.submission_id as string | number | undefined) ??
    (data.id as string | number | undefined) ??
    ((data.submission as Record<string, unknown> | undefined)?.id as string | number | undefined)
  if (submissionId === undefined || submissionId === null) return null

  const documentUrl =
    (data.audit_log_url as string | undefined) ??
    (data.documents_url as string | undefined) ??
    null

  return {
    event: resolved,
    submissionId: String(submissionId),
    documentUrl: documentUrl ?? null,
  }
}
