import { constantTimeEqual, randomToken, sha256, signPayload, verifyPayload } from './crypto.ts';
import { all, db, get, run, uid } from './db.ts';
import { clientIp, cookieHeader, forbidden, parseCookies, unauthorized } from './http.ts';

export const SESSION_MAX_AGE = 15 * 60;          // short-lived access session
export const REFRESH_MAX_AGE = 30 * 24 * 60 * 60; // rotating refresh token
export const SESSION_COOKIE = 'tp_session';
export const REFRESH_COOKIE = 'tp_refresh';
export const CSRF_COOKIE = 'tp_csrf';

export interface UserRow {
  id: string; email: string; name: string; password_hash: string;
  email_verified: number; verification_hash: string | null; verification_expires: number | null;
  reset_hash: string | null; reset_expires: number | null;
  totp_secret: string | null; totp_enabled: number; recovery_hashes: string;
  role: 'user' | 'admin'; avatar_hue: number; college: string; city: string;
  skills: string; bio: string; created_at: number; deleted_at: number | null;
}

export interface SessionRow {
  id: string; user_id: string; csrf_token: string; aal2: number;
  expires_at: number; revoked_at: number | null; created_at: number;
}

export interface AuthContext {
  session: SessionRow;
  user: UserRow;
  csrf: string;
}

export function userByEmail(email: string): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', email.toLowerCase().trim());
}

export function userById(id: string): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', id);
}

export function getAuth(request: Request): AuthContext | null {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = get<SessionRow>(
    'SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?',
    sha256(token), Date.now(),
  );
  if (!session) return null;
  const user = userById(session.user_id);
  if (!user) return null;
  return { session, user, csrf: session.csrf_token };
}

export function requireAuth(request: Request): AuthContext {
  const ctx = getAuth(request);
  if (!ctx) unauthorized('Please sign in to continue');
  return ctx;
}

/** Admin pages require a database admin role AND an MFA-authenticated session. */
export function requireAdmin(request: Request): AuthContext {
  const ctx = requireAuth(request);
  if (ctx.user.role !== 'admin' || !ctx.session.aal2) {
    forbidden('Admin access requires an MFA-verified administrator session');
  }
  return ctx;
}

export function audit(userId: string | null, action: string, request?: Request, detail = ''): void {
  run('INSERT INTO audit_log (id,user_id,action,ip_hash,detail,created_at) VALUES (?,?,?,?,?,?)',
    uid('aud'), userId, action, request ? clientIp(request) : 'system', detail.slice(0, 500), Date.now());
}

export interface AuthCookies {
  cookies: string[];
  csrf: string;
}

function sessionCookies(userId: string, request: Request, aal2: boolean): AuthCookies {
  const sessionToken = randomToken();
  const refreshToken = randomToken();
  const csrf = randomToken(24);
  const now = Date.now();
  const secure = process.env.NODE_ENV === 'production';
  run(`INSERT INTO sessions (id,user_id,token_hash,csrf_token,aal2,ip_hash,user_agent,expires_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    uid('ses'), userId, sha256(sessionToken), csrf, aal2 ? 1 : 0, clientIp(request),
    (request.headers.get('user-agent') ?? '').slice(0, 200), now + SESSION_MAX_AGE * 1000, now);
  run(`INSERT INTO refresh_tokens (id,user_id,token_hash,aal2,expires_at,created_at) VALUES (?,?,?,?,?,?)`,
    uid('ref'), userId, sha256(refreshToken), aal2 ? 1 : 0, now + REFRESH_MAX_AGE * 1000, now);
  return {
    csrf,
    cookies: [
      cookieHeader(SESSION_COOKIE, sessionToken, { maxAge: SESSION_MAX_AGE, httpOnly: true, sameSite: 'Lax', secure }),
      cookieHeader(REFRESH_COOKIE, refreshToken, { maxAge: REFRESH_MAX_AGE, httpOnly: true, sameSite: 'Lax', secure }),
      cookieHeader(CSRF_COOKIE, csrf, { maxAge: SESSION_MAX_AGE, httpOnly: false, sameSite: 'Lax', secure }),
    ],
  };
}

export function createAuthCookies(userId: string, request: Request, aal2 = false): AuthCookies {
  return sessionCookies(userId, request, aal2);
}

/** Rotation: the old refresh token is revoked and can never be replayed. */
export function rotateAuth(request: Request): (AuthCookies & { userId: string; aal2: boolean }) | null {
  const token = parseCookies(request)[REFRESH_COOKIE];
  if (!token) return null;
  const row = get<{ id: string; user_id: string; aal2: number; revoked_at: number | null; expires_at: number }>(
    'SELECT * FROM refresh_tokens WHERE token_hash = ?', sha256(token),
  );
  if (!row || row.revoked_at || row.expires_at < Date.now()) return null;
  const user = userById(row.user_id);
  if (!user) return null;
  run('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?', Date.now(), row.id);
  run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', Date.now(), row.user_id);
  return { ...sessionCookies(row.user_id, request, Boolean(row.aal2)), userId: row.user_id, aal2: Boolean(row.aal2) };
}

export function revokeAuth(request: Request): string[] {
  const cookies = parseCookies(request);
  if (cookies[SESSION_COOKIE]) {
    run('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', Date.now(), sha256(cookies[SESSION_COOKIE]));
  }
  if (cookies[REFRESH_COOKIE]) {
    run('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?', Date.now(), sha256(cookies[REFRESH_COOKIE]));
  }
  const expired = { maxAge: 0, sameSite: 'Lax' as const, secure: process.env.NODE_ENV === 'production' };
  return [
    cookieHeader(SESSION_COOKIE, '', expired),
    cookieHeader(REFRESH_COOKIE, '', { ...expired, httpOnly: true }),
    cookieHeader(CSRF_COOKIE, '', { ...expired, httpOnly: false }),
  ];
}

/** Revoke both access and refresh credentials atomically, including outstanding tickets. */
export function revokeAllSessions(userId: string): void {
  db().exec('BEGIN IMMEDIATE');
  try {
    const now = Date.now();
    run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', now, userId);
    run('UPDATE refresh_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', now, userId);
    run('DELETE FROM ws_tickets WHERE user_id=?', userId);
    db().exec('COMMIT');
  } catch (error) { db().exec('ROLLBACK'); throw error; }
}

export function sessionsFor(userId: string): Array<{ id: string; createdAt: number; expiresAt: number; userAgent: string; current: boolean }> {
  return all<{ id: string; created_at: number; expires_at: number; user_agent: string }>(
    'SELECT id,created_at,expires_at,user_agent FROM sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC',
    userId, Date.now(),
  ).map((s) => ({ id: s.id, createdAt: s.created_at, expiresAt: s.expires_at, userAgent: s.user_agent, current: false }));
}

export function revokeSession(userId: string, sessionId: string): boolean {
  const result = db().prepare('UPDATE sessions SET revoked_at=? WHERE id=? AND user_id=?')
    .run(Date.now(), sessionId, userId);
  return Number(result.changes) > 0;
}

/* ── WebSocket tickets: short-lived, one-time, never a session cookie in a URL ── */
export function issueWsTicket(userId: string): string {
  const ticket = randomToken(24);
  run('INSERT INTO ws_tickets (ticket_hash,user_id,expires_at,used_at) VALUES (?,?,?,NULL)',
    sha256(ticket), userId, Date.now() + 30_000);
  // keep the table small
  run('DELETE FROM ws_tickets WHERE expires_at < ?', Date.now() - 60_000);
  return ticket;
}

export function consumeWsTicket(ticket: string): string | null {
  if (!ticket || ticket.length > 200) return null;
  const result = db().prepare('UPDATE ws_tickets SET used_at=? WHERE ticket_hash=? AND used_at IS NULL AND expires_at>?')
    .run(Date.now(), sha256(ticket), Date.now());
  if (Number(result.changes) < 1) return null;
  return get<{ user_id: string }>('SELECT user_id FROM ws_tickets WHERE ticket_hash=?', sha256(ticket))?.user_id ?? null;
}

/* ── MFA challenge tokens ────────────────────────────────────────────────── */
export function mfaChallenge(userId: string, purpose: string): string {
  return signPayload({ uid: userId, purpose, nonce: randomToken(8) }, 300);
}

export function readMfaChallenge(token: string, purpose: string): string | null {
  const payload = verifyPayload<{ uid: string; purpose: string }>(token);
  if (!payload || payload.purpose !== purpose || typeof payload.uid !== 'string') return null;
  return payload.uid;
}

export function verifyRecoveryCode(user: UserRow, code: string): boolean {
  const normalized = code.trim().toUpperCase();
  const hashes: string[] = JSON.parse(user.recovery_hashes || '[]');
  return hashes.some((h) => constantTimeEqual(h, sha256(normalized)));
}

export function consumeRecoveryCode(user: UserRow, code: string): boolean {
  const normalized = code.trim().toUpperCase();
  const hashes: string[] = JSON.parse(user.recovery_hashes || '[]');
  const idx = hashes.findIndex((h) => constantTimeEqual(h, sha256(normalized)));
  if (idx < 0) return false;
  hashes.splice(idx, 1);
  run('UPDATE users SET recovery_hashes=? WHERE id=?', JSON.stringify(hashes), user.id);
  return true;
}
