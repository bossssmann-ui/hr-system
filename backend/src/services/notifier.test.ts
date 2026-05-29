/**
 * Notifier push-channel unit tests.
 *
 * Stubs the Prisma `deviceToken` model and the Expo push client so the
 * tests run without a database or network. Verifies:
 *   - Push is a no-op when MOBILE_PUSH_ENABLED is false.
 *   - Push fans out to every active device token of the recipient.
 *   - Invalid (DeviceNotRegistered) tokens get soft-deactivated.
 *   - Transport failures are swallowed (never throw into the caller).
 */
import { describe, expect, test } from 'bun:test'

import type { DbClient } from '../db'
import type { AppEnv } from '../env'
import type { ExpoPushClient, ExpoPushMessage } from '../integrations/expo/push-client'
import { createNotifier } from './notifier'

type DeviceRow = { token: string }

function makePrismaStub(devices: DeviceRow[]) {
  const updateManyCalls: Array<{ where: unknown; data: unknown }> = []
  const stub = {
    deviceToken: {
      findMany: async () => devices,
      updateMany: async (args: { where: unknown; data: unknown }) => {
        updateManyCalls.push(args)
        return { count: 0 }
      },
    },
  }
  return { prisma: stub as unknown as DbClient, updateManyCalls }
}

function makeEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    MOBILE_PUSH_ENABLED: true,
    EXPO_PUSH_API_URL: 'https://exp.host/--/api/v2/push/send',
  BILLING_ENABLED: false,
  SUBDOMAIN_ROUTING_ENABLED: false,
  TENANT_REGISTRATION_ENABLED: true,
    ...overrides,
  } as unknown as AppEnv
}

function silentLogger() {
  return {
    warn: () => undefined,
    error: () => undefined,
  }
}

describe('notifier.push', () => {
  test('skips delivery when MOBILE_PUSH_ENABLED is false', async () => {
    const { prisma } = makePrismaStub([{ token: 'ExponentPushToken[a]' }])
    let sendCalled = false
    const pushClient: ExpoPushClient = {
      async send() {
        sendCalled = true
        return { ok: true, invalidTokens: [] }
      },
    }
    const notifier = createNotifier(prisma, silentLogger(), {
      env: makeEnv({ MOBILE_PUSH_ENABLED: false }),
      pushClient,
    })

    await notifier.notify({
      channel: 'push',
      recipient: { userId: 'u1', tenantId: 't1' },
      template: 'offer.created',
    })

    expect(sendCalled).toBe(false)
  })

  test('sends one Expo message per active device token', async () => {
    const { prisma } = makePrismaStub([
      { token: 'ExponentPushToken[a]' },
      { token: 'ExponentPushToken[b]' },
    ])
    const sent: ExpoPushMessage[][] = []
    const pushClient: ExpoPushClient = {
      async send(messages) {
        sent.push(messages)
        return { ok: true, invalidTokens: [] }
      },
    }
    const notifier = createNotifier(prisma, silentLogger(), { env: makeEnv(), pushClient })

    await notifier.notify({
      channel: 'push',
      recipient: { userId: 'u1', tenantId: 't1' },
      template: 'offer.created',
      payload: { title: 'New offer', body: 'Open Acme offer for review' } as never,
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toHaveLength(2)
    expect(sent[0]![0]!.to).toBe('ExponentPushToken[a]')
    expect(sent[0]![0]!.title).toBe('New offer')
    expect(sent[0]![0]!.body).toBe('Open Acme offer for review')
    expect(sent[0]![0]!.data).toEqual({
      template: 'offer.created',
      title: 'New offer',
      body: 'Open Acme offer for review',
    })
  })

  test('falls back to a prettified title when none is supplied', async () => {
    const { prisma } = makePrismaStub([{ token: 'ExponentPushToken[a]' }])
    const sent: ExpoPushMessage[][] = []
    const pushClient: ExpoPushClient = {
      async send(messages) {
        sent.push(messages)
        return { ok: true, invalidTokens: [] }
      },
    }
    const notifier = createNotifier(prisma, silentLogger(), { env: makeEnv(), pushClient })

    await notifier.notify({
      channel: 'push',
      recipient: { userId: 'u1', tenantId: 't1' },
      template: 'offer.signed',
    })

    expect(sent[0]![0]!.title).toBe('Offer Signed')
    expect(sent[0]![0]!.body).toBe('Open the app for details.')
  })

  test('deactivates DeviceNotRegistered tokens', async () => {
    const { prisma, updateManyCalls } = makePrismaStub([
      { token: 'ExponentPushToken[a]' },
      { token: 'ExponentPushToken[b]' },
    ])
    const pushClient: ExpoPushClient = {
      async send() {
        return { ok: false, invalidTokens: ['ExponentPushToken[b]'] }
      },
    }
    const notifier = createNotifier(prisma, silentLogger(), { env: makeEnv(), pushClient })

    await notifier.notify({
      channel: 'push',
      recipient: { userId: 'u1', tenantId: 't1' },
      template: 'offer.created',
    })

    expect(updateManyCalls).toHaveLength(1)
    expect(updateManyCalls[0]!.data).toEqual({ isActive: false })
    expect(updateManyCalls[0]!.where).toMatchObject({
      tenantId: 't1',
      userId: 'u1',
      token: { in: ['ExponentPushToken[b]'] },
    })
  })

  test('swallows transport errors instead of throwing', async () => {
    const { prisma } = makePrismaStub([{ token: 'ExponentPushToken[a]' }])
    const pushClient: ExpoPushClient = {
      async send() {
        throw new Error('boom')
      },
    }
    const notifier = createNotifier(prisma, silentLogger(), { env: makeEnv(), pushClient })

    await expect(
      notifier.notify({
        channel: 'push',
        recipient: { userId: 'u1', tenantId: 't1' },
        template: 'offer.created',
      }),
    ).resolves.toBeUndefined()
  })

  test('does nothing when the user has no active devices', async () => {
    const { prisma } = makePrismaStub([])
    let sendCalled = false
    const pushClient: ExpoPushClient = {
      async send() {
        sendCalled = true
        return { ok: true, invalidTokens: [] }
      },
    }
    const notifier = createNotifier(prisma, silentLogger(), { env: makeEnv(), pushClient })

    await notifier.notify({
      channel: 'push',
      recipient: { userId: 'u1', tenantId: 't1' },
      template: 'offer.created',
    })

    expect(sendCalled).toBe(false)
  })
})
