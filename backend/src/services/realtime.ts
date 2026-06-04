/**
 * Realtime event bus — Phase 10.
 *
 * In-process pub/sub used by the SSE endpoint (`/api/realtime/events`) to push
 * live events to connected clients. Decoupled from the transport so producers
 * (notifier, services, route handlers) call `getRealtimeBus().publish*()`
 * without needing to know whether the consumer is SSE today or WebSockets
 * tomorrow.
 *
 * Phase 0 of the Notifier reserved the slot "add Valkey Pub/Sub later without
 * changing call sites" — this module is the realisation of that promise. When
 * `VALKEY_URL` is configured we can swap the in-process EventEmitter for a
 * Valkey-backed implementation behind the same interface; producers and the
 * SSE handler stay untouched.
 *
 * Events are addressed by `(tenantId, userId)` for per-user delivery, or by
 * `(tenantId, null)` for tenant-wide broadcast (e.g. Kanban updates that
 * every recruiter on the tenant cares about). Each subscriber chooses what to
 * receive via the `tenantId` + optional `userId` filter on `subscribe()`.
 */
import { EventEmitter } from 'node:events'

export type RealtimeEventType =
  | 'notification.new'
  | 'application.created'
  | 'application.stage_changed'
  | 'offer.status_changed'
  | 'checklist.task_updated'
  | 'review.request_submitted'

export type RealtimeEvent = {
  type: RealtimeEventType
  /** JSON-serialisable payload — kept open so producers don't have to update a giant union. */
  payload: Record<string, unknown>
}

type DeliveryEnvelope = {
  tenantId: string
  /** Null means "broadcast to every user on the tenant". */
  userId: string | null
  event: RealtimeEvent
}

export type RealtimeSubscriber = (event: RealtimeEvent) => void

const CHANNEL = 'realtime'

export interface RealtimeBus {
  publishToUser(tenantId: string, userId: string, event: RealtimeEvent): void
  publishToTenant(tenantId: string, event: RealtimeEvent): void
  /** Returns an unsubscribe function. Subscribers receive both per-user and per-tenant events. */
  subscribe(tenantId: string, userId: string, handler: RealtimeSubscriber): () => void
  /** Internal subscribers for cross-feature domain bridges. */
  subscribeAll(handler: (envelope: DeliveryEnvelope) => void): () => void
}

class InProcessRealtimeBus implements RealtimeBus {
  private readonly emitter = new EventEmitter()

  constructor() {
    // SSE clients are long-lived; raising the cap keeps us quiet under load.
    this.emitter.setMaxListeners(0)
  }

  publishToUser(tenantId: string, userId: string, event: RealtimeEvent): void {
    const envelope: DeliveryEnvelope = { tenantId, userId, event }
    this.emitter.emit(CHANNEL, envelope)
  }

  publishToTenant(tenantId: string, event: RealtimeEvent): void {
    const envelope: DeliveryEnvelope = { tenantId, userId: null, event }
    this.emitter.emit(CHANNEL, envelope)
  }

  subscribe(tenantId: string, userId: string, handler: RealtimeSubscriber): () => void {
    const listener = (envelope: DeliveryEnvelope) => {
      if (envelope.tenantId !== tenantId) return
      if (envelope.userId !== null && envelope.userId !== userId) return
      try {
        handler(envelope.event)
      } catch {
        // Subscriber errors must not break the bus for other subscribers.
      }
    }
    this.emitter.on(CHANNEL, listener)
    return () => {
      this.emitter.off(CHANNEL, listener)
    }
  }

  subscribeAll(handler: (envelope: DeliveryEnvelope) => void): () => void {
    this.emitter.on(CHANNEL, handler)
    return () => {
      this.emitter.off(CHANNEL, handler)
    }
  }
}

let singleton: RealtimeBus | null = null

export function getRealtimeBus(): RealtimeBus {
  if (!singleton) {
    singleton = new InProcessRealtimeBus()
  }
  return singleton
}

/** Test helper — replaces the singleton (or resets to a fresh in-process bus). */
export function __setRealtimeBusForTesting(bus: RealtimeBus | null): void {
  singleton = bus
}
