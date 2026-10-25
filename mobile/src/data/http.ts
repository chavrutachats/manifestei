import { config } from '../config';
import type { AuthTokens } from '../domain/types';
import { secureStorage } from './secureStorage';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Sessão: access token (15 min) só em memória; refresh token rotativo no Keychain/Keystore.
 * Um único refresh por vez — duas telas pedindo ao mesmo tempo não queimam o token
 * (a API invalida o refresh token a cada uso).
 */
let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let signedOutListener: (() => void) | null = null;

export const session = {
  async start(tokens: AuthTokens): Promise<void> {
    accessToken = tokens.accessToken;
    await secureStorage.setRefreshToken(tokens.refreshToken);
  },
  async end(): Promise<void> {
    accessToken = null;
    await secureStorage.clearSession();
  },
  onSignedOut(fn: () => void): () => void {
    signedOutListener = fn;
    return () => {
      if (signedOutListener === fn) signedOutListener = null;
    };
  },
  /**
   * Reabre a sessão salva. Sem rede, mantém a pessoa logada (o refresh token
   * continua guardado e é usado na próxima requisição); só um 401 do servidor desloga.
   */
  async restore(): Promise<boolean> {
    if (await refresh()) return true;
    return (await secureStorage.getRefreshToken()) !== null;
  },
};

const TIMEOUT_MS = 20_000;

async function rawFetch(method: string, path: string, body: unknown, token: string | null): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor. Verifique a internet e tente de novo.');
  } finally {
    clearTimeout(timer);
  }
}

function refresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const refreshToken = await secureStorage.getRefreshToken();
    if (!refreshToken) return false;
    let res: Response;
    try {
      res = await rawFetch('POST', '/v1/auth/refresh', { refreshToken }, null);
    } catch {
      return false; // sem rede: mantém o refresh token para tentar depois
    }
    if (!res.ok) {
      if (res.status === 401) {
        await session.end();
        signedOutListener?.();
      }
      return false;
    }
    const tokens = (await res.json()) as AuthTokens;
    await session.start(tokens);
    return true;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function request<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { auth?: boolean } = {},
): Promise<T> {
  const auth = opts.auth ?? true;
  if (auth && !accessToken) await refresh();

  let res = await rawFetch(method, path, body, auth ? accessToken : null);
  if (res.status === 401 && auth && (await refresh())) {
    res = await rawFetch(method, path, body, accessToken);
  }
  if (res.status === 204) return undefined as T;

  const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `HTTP_${res.status}`, data?.message ?? 'O servidor não respondeu como esperado.');
  }
  return data as T;
}
