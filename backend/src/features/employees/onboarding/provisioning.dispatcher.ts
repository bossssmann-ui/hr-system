import { createHmac } from 'node:crypto'

export type CompanyProvisioningConfig = {
  webhookUrl: string
  secret: string
  isEnabled: boolean
}

export type ProvisioningDispatchResult = 'done' | 'failed' | 'pending'

export type ProvisioningDispatchInput = {
  tenantId: string
  employeeId: string
  taskId: string
  taskKey: string
  employeeSnapshot: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface ItProvisioningDispatcher {
  dispatch(input: ProvisioningDispatchInput): Promise<ProvisioningDispatchResult>
}

type ProvisioningTransport = (input: {
  url: string
  body: string
  signature: string
}) => Promise<{ status: number }>

type ProvisioningConfigResolver = (tenantId: string) => Promise<CompanyProvisioningConfig | null>

type WebhookProvisioningDispatcherOptions = {
  resolveCompanyConfig: ProvisioningConfigResolver
  transport?: ProvisioningTransport
}

function defaultTransport(input: { url: string; body: string; signature: string }) {
  return fetch(input.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hr-System-Signature': input.signature,
    },
    body: input.body,
  }).then((response) => ({ status: response.status }))
}

function createSignature(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

export function createWebhookProvisioningDispatcher(
  options: WebhookProvisioningDispatcherOptions,
): ItProvisioningDispatcher {
  const transport = options.transport ?? defaultTransport

  return {
    async dispatch(input) {
      const config = await options.resolveCompanyConfig(input.tenantId)
      if (!config || !config.isEnabled) return 'pending'

      const body = JSON.stringify({
        tenant_id: input.tenantId,
        employee_id: input.employeeId,
        task_id: input.taskId,
        task_key: input.taskKey,
        employee: input.employeeSnapshot,
        metadata: input.metadata ?? null,
      })
      const signature = createSignature(config.secret, body)

      try {
        const response = await transport({
          url: config.webhookUrl,
          body,
          signature,
        })
        return response.status >= 200 && response.status < 300 ? 'done' : 'failed'
      } catch {
        return 'failed'
      }
    },
  }
}
