import type { z } from 'zod';
import { constantTimeEqual, sha256 } from './crypto.ts';

export class ApiException extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

export function badRequest(message = 'Invalid request', details?: unknown): never {
  throw new ApiException(400, message, 'BAD_REQUEST', details);
}
export function unauthorized(message = 'Authentication required'): never {
  throw new ApiException(401, message, 'UNAUTHORIZED');
}
export function forbidden(message = 'Not allowed'): never {
  throw new ApiException(403, message, 'FORBIDDEN');
}
export function notFound(message = 'Not found'): never {
  throw new ApiException(404, message, 'NOT_FOUND');
}
export function conflict(message = 'Already exists'): never {
  throw new ApiException(409, message, 'CONFLICT');
}
export function tooMany(message = 'Too many requests. Please slow down.'): never {
  throw new ApiException(429, message, 'RATE_LIMITED');
}

export function json<T>(data: T, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiException) {
    return json({ error: error.message, code: error.code, details: error.details }, error.status,
      error.status === 429 ? { 'retry-after': '60' } : undefined);
  }
  if (error instanceof SyntaxError) return json({ error: 'Malformed JSON', code: 'BAD_JSON' }, 400);
  console.error('[api]', error);
  return json({ error: 'Something went wrong. Please try again.', code: 'INTERNAL' }, 500);
}

/** Wrap a route handler so no exception can leak a stack trace or crash the process. */
export function route<T extends Request[]>(handler: (...args: T) => Promise<Response> | Response) {
  return async (...args: T): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

const MAX_BODY = 32 * 1024;

/** Size-capped JSON body + Zod validation. Unknown keys are stripped. */
export async function body<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.infer<S>> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY) throw new ApiException(413, 'Payload too large', 'PAYLOAD_TOO_LARGE');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new ApiException(413, 'Payload too large', 'PAYLOAD_TOO_LARGE');
  let raw: unknown;
  try {
    raw = JSON.parse(text || '{}');
  } catch {
    throw new ApiException(400, 'Malformed JSON', 'BAD_JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiException(400, 'Validation failed', 'VALIDATION', result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const raw = forwarded || request.headers.get('x-real-ip') || 'local';
  return sha256(raw).slice(0, 24);
}

/** Same-origin check for every state-changing request (CSRF defence #1). */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return; // non-browser clients rely on the CSRF token below
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    forbidden('Invalid origin');
  }
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  if (originHost !== host) forbidden('Cross-origin request rejected');
}

/** CSRF defence #2: double-submit token bound to the server-side session. */
export function assertCsrf(request: Request, csrfToken: string): void {
  const header = request.headers.get('x-csrf-token') ?? '';
  if (!header || !csrfToken || !constantTimeEqual(header, csrfToken)) forbidden('Invalid CSRF token');
}

export function assertWriteSafety(request: Request, csrfToken: string): void {
  assertSameOrigin(request);
  assertCsrf(request, csrfToken);
}

/* Small in-process sliding-window limiter. Production should swap this for
 * Redis/Upstash; the interface is a single call so that is a one-file change. */
const buckets = new Map<string, { hits: number[] }>();
export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => t > now - windowMs);
  if (bucket.hits.length >= limit) tooMany();
  bucket.hits.push(now);
  buckets.set(key, bucket);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.hits.every((t) => t < now - windowMs)) buckets.delete(k);
  }
}

export function parseCookies(request: Request): Record<string, string> {
  const raw = request.headers.get('cookie') ?? '';
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

interface CookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  path?: string;
}

export function cookieHeader(name: string, value: string, opts: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`, `Expires=${new Date(Date.now() + opts.maxAge * 1000).toUTCString()}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure ?? process.env.NODE_ENV === 'production') parts.push('Secure');
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

export function withCookies(response: Response, cookies: string[]): Response {
  for (const c of cookies) response.headers.append('set-cookie', c);
  return response;
}

/** Only https: absolute URLs on a small set of expected shapes leave the app. */
export function safeExternalUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};
