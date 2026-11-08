import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('demo seeding is opt-in and uses configured credentials without a TOTP shortcut', async () => {
  const cwd = process.cwd(); const dir = mkdtempSync(join(tmpdir(), 'tp-dev-')); const env = { ...process.env };
  process.chdir(dir);
  Object.assign(process.env, { NODE_ENV: 'development', SEED_DEMO: '0', DEMO_EMAIL: 'builder@example.test', DEMO_PASSWORD: 'disposable-123', ADMIN_EMAIL: 'admin@example.test', ADMIN_PASSWORD: 'disposable-456' });
  const { db, get, seedAccounts } = await import('../src/server/db.ts');
  try {
    await seedAccounts();
    assert.equal(get<{ n: number }>('SELECT count(*) n FROM users')!.n, 0);
    process.env.SEED_DEMO = '1';
    await seedAccounts();
    const { verifyPassword } = await import('../src/server/crypto.ts');
    const demo = get<{ email: string; password_hash: string }>('SELECT email,password_hash FROM users WHERE id=?', 'usr_demo')!;
    assert.equal(demo.email, process.env.DEMO_EMAIL);
    assert.equal(await verifyPassword(process.env.DEMO_PASSWORD!, demo.password_hash), true);
    assert.equal(get<{ totp_enabled: number }>('SELECT totp_enabled FROM users WHERE id=?', 'usr_admin')?.totp_enabled, 0);
    const { ctxFrom } = await import('../src/server/router.ts');
    const { handleAuth } = await import('../src/server/routes/auth.ts');
    const response = await handleAuth(ctxFrom(new Request('http://localhost/api/v1/auth/dev-hint'), ['auth', 'dev-hint']));
    const hint = await response!.json() as { admin: Record<string, unknown> };
    assert.equal('totpCode' in hint.admin, false);
  } finally { db().close(); process.chdir(cwd); process.env = env; rmSync(dir, { recursive: true, force: true }); }
});
