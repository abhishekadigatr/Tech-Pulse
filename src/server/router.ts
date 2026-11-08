import { z } from 'zod';
import { apiAccessDecision } from '../lib/access.ts';
import { getAuth, type AuthContext } from './auth.ts';
import { ApiException, assertCsrf, assertSameOrigin, body, forbidden, json, notFound, rateLimit, unauthorized } from './http.ts';

export interface Ctx {
  request: Request;
  method: string;
  path: string;
  segments: string[];
  url: URL;
  auth: AuthContext | null;
}

export interface HandlerArgs {
  ctx: Ctx;
  params: Record<string, string>;
  auth: AuthContext;
}

export function ctxFrom(request: Request, segments: string[]): Ctx {
  return {
    request,
    method: request.method.toUpperCase(),
    path: `/${segments.join('/')}`,
    segments,
    url: new URL(request.url),
    auth: getAuth(request),
  };
}

export function enforceApiAccess(ctx: Ctx): void {
  const state = ctx.auth ? { totpEnabled: Boolean(ctx.auth.user.totp_enabled), aal2: Boolean(ctx.auth.session.aal2) } : null;
  const decision = apiAccessDecision(ctx.path, state);
  if (decision === 'login') unauthorized('Please sign in to continue');
  if (decision === 'enroll') throw new ApiException(403, 'Enroll in two-factor authentication in settings', 'MFA_ENROLL_REQUIRED', { redirect: '/settings?enroll=2fa' });
  if (decision === 'step-up') throw new ApiException(403, 'Sign in again with two-factor authentication', 'AAL2_REQUIRED', { redirect: '/login?stepup=1' });
}

export function requireAuth(ctx: Ctx): AuthContext {
  if (!ctx.auth) unauthorized('Please sign in to continue');
  return ctx.auth;
}

/** Every mutating route calls this: same-origin + session-bound CSRF token. */
export function write(ctx: Ctx): AuthContext {
  assertSameOrigin(ctx.request);
  const auth = requireAuth(ctx);
  assertCsrf(ctx.request, auth.csrf);
  return auth;
}

/** Public write endpoints (login/register) still enforce origin + rate limits. */
export function publicWrite(ctx: Ctx): void {
  assertSameOrigin(ctx.request);
}

export async function readBody<S extends z.ZodTypeAny>(ctx: Ctx, schema: S): Promise<z.infer<S>> {
  return body(ctx.request, schema);
}

export const ok = <T,>(data: T, status = 200): Response => json(data, status);

type Handler = (args: HandlerArgs) => Promise<Response> | Response;

/** Tiny path matcher: '/hackathons/:id/bookmark' → { id } */
export class Routes {
  private entries: Array<{ method: string; parts: string[]; handler: Handler }> = [];

  constructor(private ctx: Ctx) {}

  add(method: string, template: string, handler: Handler): this {
    this.entries.push({ method, parts: template.split('/').filter(Boolean), handler });
    return this;
  }

  get(template: string, handler: Handler): this { return this.add('GET', template, handler); }
  post(template: string, handler: Handler): this { return this.add('POST', template, handler); }
  patch(template: string, handler: Handler): this { return this.add('PATCH', template, handler); }
  put(template: string, handler: Handler): this { return this.add('PUT', template, handler); }
  delete(template: string, handler: Handler): this { return this.add('DELETE', template, handler); }

  async run(): Promise<Response | null> {
    for (const entry of this.entries) {
      if (entry.method !== this.ctx.method) continue;
      if (entry.parts.length !== this.ctx.segments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < entry.parts.length; i += 1) {
        const part = entry.parts[i];
        if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(this.ctx.segments[i]);
        else if (part !== this.ctx.segments[i]) { matched = false; break; }
      }
      if (!matched) continue;
      const auth = this.ctx.auth;
      if (!auth && this.ctx.method !== 'GET' && this.ctx.method !== 'HEAD' &&
          !['/auth/login', '/auth/register', '/auth/refresh', '/auth/verify-email', '/auth/resend-verification', '/auth/forgot-password', '/auth/reset-password', '/auth/2fa/verify', '/health'].includes(this.ctx.path)) {
        unauthorized('Please sign in to continue');
      }
      return entry.handler({ ctx: this.ctx, params, auth: auth as AuthContext });
    }
    return null;
  }
}

export function adminOnly(ctx: Ctx): AuthContext {
  const auth = requireAuth(ctx);
  if (auth.user.role !== 'admin' || !auth.session.aal2) {
    forbidden('Admin access requires an MFA-verified administrator session');
  }
  return auth;
}

export function limit(key: string, max: number, windowMs = 60_000): void {
  rateLimit(key, max, windowMs);
}

export function missing(): Response {
  return notFound('Endpoint not found');
}
