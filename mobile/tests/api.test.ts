import { afterEach, expect, test } from 'bun:test';

import { ApiClient } from '../src/lib/api';

const originalFetch = globalThis.fetch;
const refreshToken = 'r'.repeat(32);
const rotatedRefreshToken = 'n'.repeat(32);

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('mobile ApiClient refreshes with the stored refresh token and retries authenticated requests', async () => {
  let accessToken: string | null = 'expired-access-token';
  let storedRefreshToken: string | null = refreshToken;
  const calls: Array<{ path: string; authorization: string | null; body: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, authorization: headers.get('Authorization'), body });

    if (path === '/api/auth/me' && headers.get('Authorization') === 'Bearer fresh-access-token') {
      return json(
        {
          user: {
            id: 'user_1',
            email: 'user@example.com',
            displayName: null,
            createdAt: '2026-05-11T00:00:00.000Z',
          },
        },
        200,
      );
    }

    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401);
    }

    if (path === '/api/auth/refresh') {
      return json({ accessToken: 'fresh-access-token', refreshToken: rotatedRefreshToken }, 200);
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const client = new ApiClient({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken;
    },
    getRefreshToken: async () => storedRefreshToken,
    setRefreshToken: async (nextRefreshToken) => {
      storedRefreshToken = nextRefreshToken;
    },
    clearRefreshToken: async () => {
      storedRefreshToken = null;
    },
  });

  const response = await client.me();

  expect(response.user.email).toBe('user@example.com');
  expect(accessToken).toBe('fresh-access-token');
  expect(storedRefreshToken).toBe(rotatedRefreshToken);
  expect(calls.map((call) => call.path)).toEqual([
    '/api/auth/me',
    '/api/auth/refresh',
    '/api/auth/me',
  ]);
  expect(calls[0]?.authorization).toBe('Bearer expired-access-token');
  expect(calls[1]?.body).toEqual({ refreshToken });
  expect(calls[2]?.authorization).toBe('Bearer fresh-access-token');
});

test('mobile ApiClient shares one refresh request across concurrent 401 responses', async () => {
  let accessToken: string | null = 'expired-access-token';
  let storedRefreshToken: string | null = refreshToken;
  const calls: Array<{ path: string; authorization: string | null }> = [];

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    const authorization = headers.get('Authorization');
    calls.push({ path, authorization });

    if (path === '/api/auth/refresh') {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return json({ accessToken: 'fresh-access-token', refreshToken: rotatedRefreshToken }, 200);
    }

    if (path === '/api/auth/me' && authorization === 'Bearer fresh-access-token') {
      return json(
        {
          user: {
            id: 'user_1',
            email: 'user@example.com',
            displayName: null,
            createdAt: '2026-05-11T00:00:00.000Z',
          },
        },
        200,
      );
    }

    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401);
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const client = new ApiClient({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken;
    },
    getRefreshToken: async () => storedRefreshToken,
    setRefreshToken: async (nextRefreshToken) => {
      storedRefreshToken = nextRefreshToken;
    },
    clearRefreshToken: async () => {
      storedRefreshToken = null;
    },
  });

  const [first, second] = await Promise.all([client.me(), client.me()]);
  const refreshCalls = calls.filter((call) => call.path === '/api/auth/refresh');
  const meCalls = calls.filter((call) => call.path === '/api/auth/me');

  expect(first.user.email).toBe('user@example.com');
  expect(second.user.email).toBe('user@example.com');
  expect(refreshCalls).toHaveLength(1);
  expect(meCalls).toHaveLength(4);
});

test('mobile ApiClient clears token state when refresh fails', async () => {
  let accessToken: string | null = 'expired-access-token';
  let storedRefreshToken: string | null = refreshToken;
  let clearRefreshTokenCalls = 0;
  let authExpiredCalls = 0;

  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;

    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401);
    }

    if (path === '/api/auth/refresh') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' } }, 401);
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const client = new ApiClient({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken;
    },
    getRefreshToken: async () => storedRefreshToken,
    setRefreshToken: async (nextRefreshToken) => {
      storedRefreshToken = nextRefreshToken;
    },
    clearRefreshToken: async () => {
      clearRefreshTokenCalls += 1;
      storedRefreshToken = null;
    },
    onAuthExpired: () => {
      authExpiredCalls += 1;
    },
  });

  await expect(client.me()).rejects.toMatchObject({
    status: 401,
    code: 'UNAUTHORIZED',
  });

  expect(accessToken).toBeNull();
  expect(storedRefreshToken).toBeNull();
  expect(clearRefreshTokenCalls).toBe(1);
  expect(authExpiredCalls).toBe(1);
});

test('mobile ApiClient sends the stored refresh token when logging out', async () => {
  const calls: Array<{ path: string; body: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });

    if (path === '/api/auth/logout') {
      return new Response(null, { status: 204 });
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404);
  };

  const client = new ApiClient({
    getAccessToken: () => null,
    setAccessToken: () => undefined,
    getRefreshToken: async () => refreshToken,
    setRefreshToken: async () => undefined,
    clearRefreshToken: async () => undefined,
  });

  await client.logout();

  expect(calls).toEqual([{ path: '/api/auth/logout', body: { refreshToken } }]);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
