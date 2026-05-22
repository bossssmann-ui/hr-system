/**
 * InAppChannel — writes/reads our own DB.
 *
 * For in-app channel, sending a message just stores it directly in the DB.
 * The "destination" field is unused (conversations carry the candidate_id).
 * Status transitions to `sent` immediately.
 *
 * Always available; no feature flag.
 */
import type { MessageChannelAdapter, SendInput, SendResult } from './channel'

export class InAppChannel implements MessageChannelAdapter {
  readonly channelName = 'in_app'

  async send(_input: SendInput): Promise<SendResult> {
    // In-app messages are stored directly in the DB by the messaging service.
    // This send() is a no-op — the service layer already wrote the row before
    // enqueueing, and the status is set directly to `sent`.
    return { externalId: null, status: 'sent' }
  }
}
