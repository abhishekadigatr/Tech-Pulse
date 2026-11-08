'use client';

import { useEffect, useCallback, useState } from 'react';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: unknown) {
    super(message);
  }
}

const BASE = '/api/v1';
let csrfMemory = '';

export function csrfToken(): string {
  if (csrfMemory) return csrfMemory;
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)tp_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export function setCsrfToken(token: string): void {
  csrfMemory = token;
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}, retried = false): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (response.status === 401 && !retried && path !== '/auth/refresh' && path !== '/auth/login') {
    try {
      const refreshed = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' });
      if (refreshed.ok) {
        const payload = (await refreshed.json()) as { csrfToken?: string };
        if (payload.csrfToken) setCsrfToken(payload.csrfToken);
        return api<T>(path, options, true);
      }
    } catch { /* fall through to the original 401 */ }
  }

  let data: unknown = null;
  try { data = await response.json(); } catch { /* non-json response */ }
  if (!response.ok) {
    const err = (data ?? {}) as { error?: string; code?: string; details?: unknown };
    throw new ApiError(err.error ?? `Request failed (${response.status})`, response.status, err.code, err.details);
  }
  const payload = data as { csrfToken?: string } | null;
  if (payload?.csrfToken) setCsrfToken(payload.csrfToken);
  return data as T;
}

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (value: T | null) => void;
}

/** Minimal data hook: keeps loading/empty/error states consistent everywhere. */
export function useApi<T>(path: string | null, deps: unknown[] = []): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!path) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api<T>(path, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load data');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, nonce, ...deps]);

  return { data, loading, error, reload, setData };
}
