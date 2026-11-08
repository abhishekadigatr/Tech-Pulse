import { z } from 'zod';
import QRCode from 'qrcode';
import {
  audit, consumeRecoveryCode, createAuthCookies, issueWsTicket, mfaChallenge,
  readMfaChallenge, revokeAllSessions, revokeAuth, revokeSession, rotateAuth, sessionsFor, userByEmail,
  userById, verifyRecoveryCode, type AuthCookies, type UserRow,
} from '../auth.ts';
import { get, run, uid } from '../db.ts';
import {
  hashPassword, newTotpSecret, openSystem, otpauthUrl, randomToken,
  recoveryCodes, sealSystem, sha256, verifyPassword, verifyTotp,
} from '../crypto.ts';
import { clientIp, conflict, json, notFound, withCookies } from '../http.ts';
import { enforceApiAccess, limit, ok, publicWrite, readBody, requireAuth, Routes, write, type Ctx } from '../router.ts';
import { toMe } from '../repo.ts';
import { consumeEmailCode, issueEmailCode } from '../email-codes.ts';
import { getHub } from '../ws-hub.ts';
import {
  confirm2faSchema, disable2faSchema, email, emailCodeSchema, loginSchema, mfaSchema,
  registerSchema, resetSchema,
} from '../schemas.ts';

const dev = (): boolean => process.env.NODE_ENV !== 'production';
const emailOnlySchema = z.object({ email });

let dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  dummyHash ??= await hashPassword(`dummy-${randomToken(12)}`);
  return dummyHash;
}

function loggedIn(user: UserRow, aal2: boolean, issued: AuthCookies): Response {
  return withCookies(ok({ me: toMe(user, aal2), csrfToken: issued.csrf }), issued.cookies);
}

export async function handleAuth(ctx: Ctx): Promise<Response | null> {
  const r = new Routes(ctx);

  r.get('/auth/me', ({ ctx: c }) => {
    if (!c.auth) return ok({ me: null, csrfToken: null });
    return ok({ me: toMe(c.auth.user, Boolean(c.auth.session.aal2)), csrfToken: c.auth.csrf });
  });

  r.get('/auth/dev-hint', () => {
    if (!dev() || process.env.SEED_DEMO !== '1') return notFound();
    const { DEMO_EMAIL, DEMO_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
    if (!DEMO_EMAIL || !DEMO_PASSWORD || !ADMIN_EMAIL || !ADMIN_PASSWORD) return notFound();
    return ok({ demo: { email: DEMO_EMAIL, password: DEMO_PASSWORD }, admin: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  });

  r.get('/health', () => ok({ status: 'ok', time: Date.now(), version: '1.0.0' }));

  r.post('/auth/register', async ({ ctx: c }) => {
    publicWrite(c);
    const input = await readBody(c, registerSchema);
    limit(`register:${clientIp(c.request)}:${input.email}`, 5, 15 * 60_000);
    if (userByEmail(input.email)) conflict('An account with this email already exists');
    const hash = await hashPassword(input.password);
    const id = uid('usr');
    run(`INSERT INTO users (id,email,name,password_hash,email_verified,avatar_hue,college,city,skills,bio,created_at)
         VALUES (?,?,?,?,0,?,?,?,?,?,?)`,
      id, input.email, input.name, hash,
      Math.floor(Math.random() * 360), input.college, input.city, JSON.stringify(input.skills), '', Date.now());
    run('INSERT INTO user_settings (user_id) VALUES (?)', id);
    audit(id, 'auth.register', c.request);
    let code: string | null;
    try { code = await issueEmailCode(id, input.email, 'verify'); }
    catch { return json({ error: 'Account created, but email delivery failed. Use resend verification.', code: 'MAIL_UNAVAILABLE' }, 503); }
    return json({ ok: true, email: input.email, ...(dev() && code ? { devCode: code } : {}),
      message: dev() ? 'Account created. Use the code below to verify your email.' : 'Check your email for a verification code.' }, 201);
  });

  r.post('/auth/login', async ({ ctx: c }) => {
    publicWrite(c);
    const input = await readBody(c, loginSchema);
    limit(`login:${clientIp(c.request)}:${input.email}`, 8, 15 * 60_000);
    const user = userByEmail(input.email);
    const valid = await verifyPassword(input.password, user?.password_hash ?? await getDummyHash());
    if (!user || !valid) {
      audit(null, 'auth.login_failed', c.request, input.email);
      return json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' }, 401);
    }
    if (!user.email_verified) {
      return json({ error: 'Please verify your email first', code: 'EMAIL_UNVERIFIED', email: input.email }, 403);
    }
    if (user.totp_enabled) {
      audit(user.id, 'auth.mfa_challenge', c.request);
      return ok({ mfaRequired: true, challengeToken: mfaChallenge(user.id, 'login'),
        message: 'Enter your 6-digit authenticator code (or a recovery code).' });
    }
    audit(user.id, 'auth.login', c.request);
    return loggedIn(user, false, createAuthCookies(user.id, c.request, false));
  });

  r.post('/auth/2fa/verify', async ({ ctx: c }) => {
    publicWrite(c);
    const input = await readBody(c, mfaSchema);
    limit(`mfa:${clientIp(c.request)}`, 10, 15 * 60_000);
    const userId = readMfaChallenge(input.challengeToken, 'login');
    if (!userId) return json({ error: 'This sign-in challenge expired. Please log in again.', code: 'CHALLENGE_EXPIRED' }, 401);
    const user = userById(userId);
    if (!user || !user.totp_enabled || !user.totp_secret) return json({ error: 'Invalid challenge', code: 'INVALID_CHALLENGE' }, 401);
    const secret = openSystem(user.totp_secret);
    const okCode = verifyTotp(secret, input.code) || (verifyRecoveryCode(user, input.code) && consumeRecoveryCode(user, input.code));
    if (!okCode) { audit(user.id, 'auth.mfa_failed', c.request); return json({ error: 'Invalid code', code: 'INVALID_CODE' }, 401); }
    audit(user.id, 'auth.login_mfa', c.request);
    return loggedIn(user, true, createAuthCookies(user.id, c.request, true));
  });

  r.post('/auth/refresh', ({ ctx: c }) => {
    publicWrite(c);
    const rotated = rotateAuth(c.request);
    if (!rotated) return json({ error: 'Session expired', code: 'SESSION_EXPIRED' }, 401);
    const user = userById(rotated.userId)!;
    return withCookies(ok({ me: toMe(user, rotated.aal2), csrfToken: rotated.csrf }), rotated.cookies);
  });

  r.post('/auth/logout', ({ ctx: c }) => {
    publicWrite(c);
    if (c.auth) audit(c.auth.user.id, 'auth.logout', c.request);
    return withCookies(ok({ ok: true }), revokeAuth(c.request));
  });

  r.post('/auth/logout-everywhere', ({ ctx: c }) => {
    const auth = write(c);
    revokeAllSessions(auth.user.id);
    getHub()?.disconnectUser(auth.user.id);
    audit(auth.user.id, 'auth.logout_everywhere', c.request);
    return withCookies(ok({ ok: true }), revokeAuth(c.request));
  });

  r.post('/auth/verify-email', async ({ ctx: c }) => {
    publicWrite(c);
    const input = await readBody(c, emailCodeSchema);
    limit(`verify:${clientIp(c.request)}`, 12, 15 * 60_000);
    const user = userByEmail(input.email);
    if (!user || user.email_verified || !consumeEmailCode(user.id, 'verify', input.code)) {
      return json({ error: 'Invalid or expired verification code', code: 'INVALID_CODE' }, 400);
    }
    run('UPDATE users SET email_verified=1, verification_hash=NULL, verification_expires=NULL WHERE id=?', user.id);
    audit(user.id, 'auth.email_verified', c.request);
    return ok({ ok: true });
  });

  r.post('/auth/resend-verification', async ({ ctx: c }) => {
    publicWrite(c);
    const input = await readBody(c, emailOnlySchema);
    limit(`resend:${clientIp(c.request)}`, 5, 15 * 60_000);
    const user = userByEmail(input.email);
    let code: string | null = null;
    if (user && !user.email_verified) {
      try { code = await issueEmailCode(user.id, input.email, 'verify'); }
      catch { console.error('[mail] Verification delivery failed'); }
    }
    return ok({ ok: true, ...(dev() && code ? { devCode: code } : {}), message: 'If verification is needed, a code will be sent. Please wait a minute between requests.' });
  });

  r.post('/auth/forgot-password', async ({ ctx: c }) => {
    publicWrite(c);
    const input = await readBody(c, emailOnlySchema);
    limit(`forgot:${clientIp(c.request)}`, 5, 15 * 60_000);
    const user = userByEmail(input.email);
    let code: string | null = null;
    if (user) {
      try { code = await issueEmailCode(user.id, input.email, 'reset'); }
      catch { console.error('[mail] Password reset delivery failed'); }
    }
    return ok({ ok: true, ...(dev() && code ? { devCode: code } : {}), message: 'If that account exists, a reset code has been sent.' });
  });

  r.post('/auth/reset-password', async ({ ctx: c }) => {
    publicWrite(c);
    const input = await readBody(c, resetSchema);
    const user = userByEmail(input.email);
    if (!user || !consumeEmailCode(user.id, 'reset', input.code)) {
      return json({ error: 'Invalid or expired reset code', code: 'INVALID_CODE' }, 400);
    }
    run('UPDATE users SET password_hash=?, reset_hash=NULL, reset_expires=NULL WHERE id=?', await hashPassword(input.password), user.id);
    run('UPDATE sessions SET revoked_at=? WHERE user_id=?', Date.now(), user.id);
    run('UPDATE refresh_tokens SET revoked_at=? WHERE user_id=?', Date.now(), user.id);
    audit(user.id, 'auth.password_reset', c.request);
    return ok({ ok: true });
  });

  r.post('/auth/2fa/setup', async ({ ctx: c }) => {
    const auth = write(c);
    if (auth.user.totp_enabled) conflict('Two-factor authentication is already enabled');
    const secret = newTotpSecret();
    const codes = recoveryCodes();
    run('UPDATE users SET totp_secret=?, recovery_hashes=? WHERE id=?',
      sealSystem(secret), JSON.stringify(codes.map((x) => sha256(x))), auth.user.id);
    const url = otpauthUrl(secret, auth.user.email);
    const qr = await QRCode.toDataURL(url, { width: 220, margin: 1, errorCorrectionLevel: 'M' });
    audit(auth.user.id, 'auth.2fa_setup', c.request);
    return ok({ secret, otpauthUrl: url, qr, recoveryCodes: codes });
  });

  r.post('/auth/2fa/confirm', async ({ ctx: c }) => {
    const auth = write(c);
    if (auth.user.totp_enabled) conflict('Already enabled');
    const { code } = await readBody(c, confirm2faSchema);
    const fresh = userById(auth.user.id)!;
    if (!fresh.totp_secret || !verifyTotp(openSystem(fresh.totp_secret), code)) {
      return json({ error: 'Invalid authenticator code', code: 'INVALID_CODE' }, 400);
    }
    run('UPDATE users SET totp_enabled=1 WHERE id=?', fresh.id);
    run('UPDATE sessions SET aal2=1 WHERE id=?', auth.session.id);
    audit(fresh.id, 'auth.2fa_enabled', c.request);
    return ok({ ok: true, me: toMe(userById(fresh.id)!, true) });
  });

  r.post('/auth/2fa/disable', async ({ ctx: c }) => {
    const auth = write(c);
    const input = await readBody(c, disable2faSchema);
    const passwordOk = await verifyPassword(input.password, auth.user.password_hash);
    const secret = auth.user.totp_secret ? openSystem(auth.user.totp_secret) : '';
    if (!passwordOk || (!verifyTotp(secret, input.code) && !(verifyRecoveryCode(auth.user, input.code) && consumeRecoveryCode(auth.user, input.code)))) {
      return json({ error: 'Invalid password or code', code: 'INVALID_CODE' }, 400);
    }
    run('UPDATE users SET totp_enabled=0, totp_secret=NULL, recovery_hashes=? WHERE id=?', '[]', auth.user.id);
    audit(auth.user.id, 'auth.2fa_disabled', c.request);
    return ok({ ok: true });
  });

  r.get('/auth/sessions', ({ ctx: c }) => {
    const auth = requireAuth(c);
    return ok({ items: sessionsFor(auth.user.id).map((s) => ({ ...s, current: s.id === auth.session.id })) });
  });

  r.delete('/auth/sessions/:id', ({ ctx: c, params }) => {
    const auth = write(c);
    if (!revokeSession(auth.user.id, params.id)) return notFound('Session not found');
    audit(auth.user.id, 'auth.session_revoked', c.request, params.id);
    return ok({ ok: true });
  });

  r.post('/auth/ws-ticket', ({ ctx: c }) => {
    const auth = write(c);
    enforceApiAccess({ ...c, path: '/conversations' });
    return ok({ ticket: issueWsTicket(auth.user.id), expiresIn: 30 });
  });

  return r.run();
}
