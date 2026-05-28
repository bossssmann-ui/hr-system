/**
 * DocuSeal client — Phase 3.
 *
 * Wraps the DocuSeal REST API (https://www.docuseal.com/docs/api) for the
 * Offer signing flow. The client is created from `AppEnv`; when
 * `DOCUSEAL_ENABLED=false` we return a stub that reports `enabled: false`
 * and refuses to call out.
 */

import type { AppEnv } from '../../env'

export type DocusealPrefill = Record<string, string | number | null | undefined>

export type CreateSubmissionInput = {
  templateId: string
  prefilled?: DocusealPrefill
  signerEmail?: string | null
  signerName?: string | null
  sendEmail?: boolean
}

export type CreateSubmissionResult = {
  id: string
  signingUrl: string | null
  documentUrl: string | null
}

export interface DocusealClient {
  enabled: boolean
  templateId: string | null
  createSubmission(input: CreateSubmissionInput): Promise<CreateSubmissionResult>
}

class DisabledDocusealClient implements DocusealClient {
  enabled = false
  templateId = null
  async createSubmission(): Promise<CreateSubmissionResult> {
    throw new Error('DocuSeal integration is disabled (DOCUSEAL_ENABLED=false)')
  }
}

class HttpDocusealClient implements DocusealClient {
  enabled = true
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    public readonly templateId: string,
  ) {}

  async createSubmission(input: CreateSubmissionInput): Promise<CreateSubmissionResult> {
    const templateId = input.templateId || this.templateId
    const submitter: Record<string, unknown> = {
      role: 'candidate',
      send_email: input.sendEmail ?? false,
    }
    if (input.signerEmail) submitter.email = input.signerEmail
    if (input.signerName) submitter.name = input.signerName
    if (input.prefilled && Object.keys(input.prefilled).length > 0) {
      submitter.values = input.prefilled
    }

    const payload = {
      template_id: templateId,
      send_email: input.sendEmail ?? false,
      submitters: [submitter],
    }

    const url = `${this.apiUrl.replace(/\/$/, '')}/submissions`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': this.apiKey,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`DocuSeal createSubmission failed (${res.status}): ${text}`)
    }

    const raw = (await res.json()) as unknown
    // Response is either a submission object or an array of submitters.
    let submissionId: string | number | undefined
    let signingUrl: string | null = null
    let documentUrl: string | null = null

    if (Array.isArray(raw)) {
      const first = raw[0] as Record<string, unknown> | undefined
      if (first) {
        submissionId = (first.submission_id ?? first.id) as string | number | undefined
        signingUrl = (first.embed_src ?? first.url ?? null) as string | null
      }
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      submissionId = (obj.id ?? obj.submission_id) as string | number | undefined
      const submitters = obj.submitters as Array<Record<string, unknown>> | undefined
      const firstSubmitter = submitters?.[0]
      if (firstSubmitter) {
        signingUrl = (firstSubmitter.embed_src ?? firstSubmitter.url ?? null) as string | null
      }
      documentUrl = (obj.audit_log_url ?? null) as string | null
    }

    if (submissionId === undefined || submissionId === null) {
      throw new Error('DocuSeal createSubmission: missing submission id in response')
    }

    return {
      id: String(submissionId),
      signingUrl,
      documentUrl,
    }
  }
}

export function createDocusealClient(env: AppEnv): DocusealClient {
  if (!env.DOCUSEAL_ENABLED) return new DisabledDocusealClient()
  if (!env.DOCUSEAL_API_KEY || !env.DOCUSEAL_TEMPLATE_ID) {
    // Belt-and-suspenders — env validation guarantees this.
    return new DisabledDocusealClient()
  }
  return new HttpDocusealClient(env.DOCUSEAL_API_URL, env.DOCUSEAL_API_KEY, env.DOCUSEAL_TEMPLATE_ID)
}
