import {
  apiErrorSchema,
  authResponseSchema,
  loginRequestSchema,
  logoutRequestSchema,
  meResponseSchema,
  refreshRequestSchema,
  refreshResponseSchema,
  registerDeviceRequestSchema,
  registerDeviceResponseSchema,
  registerRequestSchema,
  type AuthResponse,
  type LoginRequest,
  type LogoutRequest,
  type MeResponse,
  type RefreshResponse,
  type RegisterDeviceRequest,
  type RegisterDeviceResponse,
  type RegisterRequest,
} from '@web-app-demo/contracts';
import type { z } from 'zod';

const apiBaseUrl = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

type ApiClientOptions = {
  getAccessToken: () => string | null;
  setAccessToken: (accessToken: string | null) => void;
  getRefreshToken: () => Promise<string | null>;
  setRefreshToken: (refreshToken: string) => Promise<void>;
  clearRefreshToken: () => Promise<void>;
  onAuthExpired?: () => void | Promise<void>;
};

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  auth?: boolean;
  retryOnUnauthorized?: boolean;
};

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class ApiClient {
  private refreshPromise: Promise<RefreshResponse> | null = null;

  constructor(private readonly options: ApiClientOptions) {}

  register(input: RegisterRequest): Promise<AuthResponse> {
    const payload = registerRequestSchema.parse(input);
    return this.request('/api/auth/register', authResponseSchema, {
      method: 'POST',
      body: payload,
      auth: false,
    });
  }

  login(input: LoginRequest): Promise<AuthResponse> {
    const payload = loginRequestSchema.parse(input);
    return this.request('/api/auth/login', authResponseSchema, {
      method: 'POST',
      body: payload,
      auth: false,
    });
  }

  async refresh(): Promise<RefreshResponse> {
    const refreshToken = await this.options.getRefreshToken();
    const payload = refreshRequestSchema.parse({ refreshToken: refreshToken ?? undefined });
    return this.request('/api/auth/refresh', refreshResponseSchema, {
      method: 'POST',
      body: payload,
      auth: false,
      retryOnUnauthorized: false,
    });
  }

  me(): Promise<MeResponse> {
    return this.request('/api/auth/me', meResponseSchema, {
      auth: true,
    });
  }

  async logout(input: LogoutRequest = {}) {
    const storedRefreshToken = await this.options.getRefreshToken();
    const payload = logoutRequestSchema.parse({
      refreshToken: input.refreshToken ?? storedRefreshToken ?? undefined,
    });

    await this.rawRequest('/api/auth/logout', {
      method: 'POST',
      body: payload,
      auth: false,
      retryOnUnauthorized: false,
    });
  }

  // Phase 11 — register the device's Expo push token with the backend.
  // Safe to call on every cold-start: the backend upsert is idempotent.
  registerDevice(input: RegisterDeviceRequest): Promise<RegisterDeviceResponse> {
    const payload = registerDeviceRequestSchema.parse(input);
    return this.request('/api/devices', registerDeviceResponseSchema, {
      method: 'POST',
      body: payload,
      auth: true,
    });
  }

  private async request<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    options: RequestOptions,
  ): Promise<z.infer<TSchema>> {
    const response = await this.rawRequest(path, options);
    const data = await response.json();
    return schema.parse(data);
  }

  private async rawRequest(path: string, options: RequestOptions): Promise<Response> {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: this.headers(options),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (response.status === 401 && options.auth && options.retryOnUnauthorized !== false) {
      const refreshed = await this.refreshOnce().catch(async (error: unknown) => {
        await this.expireSession();
        throw error;
      });
      this.options.setAccessToken(refreshed.accessToken);

      if (refreshed.refreshToken) {
        await this.options.setRefreshToken(refreshed.refreshToken);
      }

      return this.rawRequest(path, {
        ...options,
        retryOnUnauthorized: false,
      });
    }

    if (!response.ok) {
      throw await toApiError(response);
    }

    return response;
  }

  private refreshOnce() {
    this.refreshPromise ??= this.refresh().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async expireSession() {
    this.options.setAccessToken(null);
    await this.options.clearRefreshToken();
    await this.options.onAuthExpired?.();
  }

  private headers(options: RequestOptions) {
    const headers = new Headers({
      'X-Client-Platform': 'mobile',
    });

    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    if (options.auth) {
      const accessToken = this.options.getAccessToken();
      if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`);
      }
    }

    return headers;
  }
}

async function toApiError(response: Response) {
  const fallbackMessage = `Request failed with status ${response.status}`;

  try {
    const parsed = apiErrorSchema.parse(await response.json());
    return new ApiRequestError(response.status, parsed.error.code, parsed.error.message);
  } catch {
    return new ApiRequestError(response.status, 'INTERNAL_ERROR', fallbackMessage);
  }
}
