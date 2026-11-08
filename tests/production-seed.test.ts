import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('production cannot seed demos or return a dev hint even when explicitly enabled', async () => {
  const oldCwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), 'tp-prod-'));
  const oldEnv = { ...process.env };
  process.chdir(dir);
  Object.assign(process.env, { NODE_ENV: 'production', SEED_DEMO: '1', ALLOW_DEMO_ACCOUNTS: 'true', DEMO_EMAIL: 'd@example.test', DEMO_PASSWORD: 'disposable-123', ADMIN_EMAIL: 'a@example.test', ADMIN_PASSWORD: 'disposable-456' });
  const { db, get, seedAccounts } = await import('../src/server/db.ts');
  try {
    await seedAccounts();
    assert.equal(get<{ n: number }>('SELECT count(*) n FROM users')?.n, 0);
    const { ctxFrom } = await import('../src/server/router.ts');
    const { handleAuth } = await import('../src/server/routes/auth.ts');
    await assert.rejects(() => handleAuth(ctxFrom(new Request('http://localhost/api/v1/auth/dev-hint'), ['auth', 'dev-hint'])), (e: { status: number }) => e.status === 404);
  } finally {
    db().close(); process.chdir(oldCwd); process.env = oldEnv; rmSync(dir, { recursive: true, force: true });
  }
});
