import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const original = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'tp-batch2-'));
process.chdir(dir);
const { db, run, get } = await import('../src/server/db.ts');
const { MemoryRateStore, SqliteRateStore, routeRatePolicy } = await import('../src/server/ratelimit.ts');
const { setMailTransport, configureMail } = await import('../src/server/mail.ts');
const { issueEmailCode, consumeEmailCode } = await import('../src/server/email-codes.ts');
const { handleAuth } = await import('../src/server/routes/auth.ts');
const { ctxFrom } = await import('../src/server/router.ts');
after(() => { setMailTransport(undefined); db().close(); process.chdir(original); rmSync(dir, { recursive: true, force: true }); });

const messages: Array<{ to: string; subject: string; text: string }> = [];
setMailTransport({ send: async (message) => { messages.push(message); } });
run('INSERT INTO users (id,email,name,password_hash,email_verified,created_at) VALUES (?,?,?,?,?,?)', 'test-user', 'member@example.test', 'Member', 'unused', 0, Date.now());

test('mock mail, cooldown, expiry, attempt limits and single-use verification codes', async () => {
  const code = await issueEmailCode('test-user', 'member@example.test', 'verify', 1_000_000);
  assert.ok(code); assert.equal(messages.length, 1); assert.match(messages[0].text, new RegExp(code));
  assert.equal(await issueEmailCode('test-user', 'member@example.test', 'verify', 1_001_000), null);
  for (let i = 0; i < 5; i++) assert.equal(consumeEmailCode('test-user', 'verify', '000000', 1_002_000), false);
  assert.equal(consumeEmailCode('test-user', 'verify', code, 1_002_000), false);
  const replacement = await issueEmailCode('test-user', 'member@example.test', 'verify', 1_060_000);
  assert.ok(replacement); assert.equal(consumeEmailCode('test-user', 'verify', replacement, 1_060_001), true);
  assert.equal(consumeEmailCode('test-user', 'verify', replacement, 1_060_001), false);
  const expired = await issueEmailCode('test-user', 'member@example.test', 'reset', 2_000_000);
  assert.ok(expired); assert.equal(consumeEmailCode('test-user', 'reset', expired, 2_900_000), false);
});

test('failed delivery invalidates reservation and permits retry', async () => {
  setMailTransport({ send: async () => { throw new Error('offline'); } });
  await assert.rejects(() => issueEmailCode('test-user', 'member@example.test', 'verify', 3_000_000));
  assert.equal(get('SELECT 1 FROM email_codes WHERE user_id=? AND kind=?', 'test-user', 'verify'), undefined);
  setMailTransport({ send: async (message) => { messages.push(message); } });
  assert.ok(await issueEmailCode('test-user', 'member@example.test', 'verify', 3_000_001));
});

test('production rejects missing SMTP configuration', () => {
  const old = { ...process.env }; setMailTransport(undefined);
  try {
    Object.assign(process.env, { NODE_ENV: 'production' }); delete process.env.SMTP_URL; delete process.env.MAIL_FROM;
    assert.throws(() => configureMail(), /SMTP_URL and MAIL_FROM/);
  } finally { process.env = old; setMailTransport({ send: async (message) => { messages.push(message); } }); }
});

test('public routes send verification and reset messages without leaking production codes', async () => {
  const old = process.env.NODE_ENV;
  const call = async (path: string, payload: object) => {
    const req = new Request(`http://localhost/api/v1${path}`, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return handleAuth(ctxFrom(req, path.slice(1).split('/')));
  };
  try {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.APP_ORIGIN = 'http://localhost';
    const res = await call('/auth/register', { name: 'Tester', email: 'signup@example.test', password: 'ValidPass1234', skills: [] });
    assert.equal(res?.status, 201);
    const payload = await res!.json() as { devCode?: string };
    assert.equal(payload.devCode, undefined);
    assert.equal(messages.at(-1)?.to, 'signup@example.test');
    const code = messages.at(-1)!.text.match(/\b\d{6}\b/)![0];
    const verify = await call('/auth/verify-email', { email: 'signup@example.test', code });
    assert.equal(verify?.status, 200);
    const reset = await call('/auth/forgot-password', { email: 'signup@example.test' });
    assert.equal((await reset!.json() as { devCode?: string }).devCode, undefined);
    assert.match(messages.at(-1)!.subject, /Reset/);
  } finally { if (old === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV; else Object.assign(process.env, { NODE_ENV: old }); delete process.env.APP_ORIGIN; }
});

test('stores isolate keys, reset windows and SQLite persists across instances', () => {
  const memory = new MemoryRateStore();
  assert.equal(memory.hit('a', 1, 1000, 100), 0);
  assert.equal(memory.hit('a', 1, 1000, 101), 1);
  assert.equal(memory.hit('b', 1, 1000, 101), 0);
  assert.equal(memory.hit('a', 1, 1000, 1100), 0);
  const file = join(dir, 'rates.db');
  const first = new DatabaseSync(file); const a = new SqliteRateStore(first);
  assert.equal(a.hit('x', 1, 1000, 200), 0); first.close();
  const second = new DatabaseSync(file); const b = new SqliteRateStore(second);
  assert.equal(b.hit('x', 1, 1000, 201), 1);
  assert.equal(b.hit('x', 1, 1000, 1200), 0); second.close();
  for (const [method, path] of [['POST','/auth/reset-password'], ['POST','/auth/refresh'], ['POST','/auth/ws-ticket'], ['GET','/users/me/export'], ['DELETE','/users/me'], ['GET','/trips/a/route'], ['GET','/hackathons/a/apply-link']]) assert.ok(routeRatePolicy(method, path));
});

test('429 includes the store-provided Retry-After', async () => {
  const { RateLimitError } = await import('../src/server/ratelimit.ts');
  const { errorResponse } = await import('../src/server/http.ts');
  const response = errorResponse(new RateLimitError(17));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '17');
});
