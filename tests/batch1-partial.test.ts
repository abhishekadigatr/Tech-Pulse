import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthContext } from '../src/server/auth.ts';

// Database paths are based on cwd at module load; isolate all fixture writes.
const originalCwd = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'tech-pulse-test-'));
process.chdir(temp);
const { db, get, run } = await import('../src/server/db.ts');
const { createTeam, resolveTeamRequest, rotateConversationKey, setConversationKeys } = await import('../src/server/features.ts');
const { handleCatalog } = await import('../src/server/routes/catalog.ts');
const { ctxFrom } = await import('../src/server/router.ts');
after(() => { db().close(); process.chdir(originalCwd); rmSync(temp, { recursive: true, force: true }); });

const tag = `t${process.pid}`;
const owner = `${tag}owner`, member = `${tag}member`, other = `${tag}other`;
for (const id of [owner, member, other]) run('INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)', id, `${id}@test.invalid`, id, 'unused', Date.now());
const hack = get<{ id: string }>('SELECT id FROM hackathons LIMIT 1')!.id;

test('team creation rolls back when owner membership fails; full team request stays pending', () => {
  db().exec(`CREATE TRIGGER ${tag}fail BEFORE INSERT ON team_members WHEN NEW.user_id='${owner}' BEGIN SELECT RAISE(ABORT, 'test'); END`);
  try { assert.throws(() => createTeam(owner, hack, tag, '', [], 1), /test/); }
  finally { db().exec(`DROP TRIGGER ${tag}fail`); }
  assert.equal(get('SELECT id FROM teams WHERE title=?', tag), undefined);
  const team = createTeam(owner, hack, tag, '', [], 1);
  run('INSERT INTO team_requests (id,team_id,from_user_id,status,created_at) VALUES (?,?,?,?,?)', tag, team.id, member, 'pending', Date.now());
  assert.throws(() => resolveTeamRequest(tag, owner, true), /full/);
  assert.equal(get<{ status: string }>('SELECT status FROM team_requests WHERE id=?', tag)?.status, 'pending');
  assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM team_members WHERE team_id=?', team.id)?.n, 1);
});

test('conversation key sets must cover all members and updates target members only', () => {
  run('INSERT INTO conversations (id,kind,title,key_version,created_at) VALUES (?,?,?,?,?)', tag, 'dm', tag, 1, Date.now());
  for (const id of [owner, member]) run('INSERT INTO conversation_members (conversation_id,user_id,wrapped_key,last_read_at) VALUES (?,?,?,?)', tag, id, '', 0);
  const sent: string[] = [];
  const global = globalThis as unknown as { __techPulseHub?: unknown };
  global.__techPulseHub = { broadcast: (id: string) => sent.push(id), broadcastAll: () => { throw new Error('broadcastAll'); } };
  try {
    assert.equal(setConversationKeys(tag, owner, 1, [{ userId: owner, wrappedKey: 'abcdefghij' }]), false);
    assert.equal(setConversationKeys(tag, owner, 1, [{ userId: owner, wrappedKey: 'abcdefghij' }, { userId: member, wrappedKey: 'abcdefghij' }]), true);
    assert.deepEqual(sent.sort(), [owner, member].sort());
    sent.length = 0;
    assert.equal(rotateConversationKey(tag, owner), true);
    assert.deepEqual(sent.sort(), [owner, member].sort());
  } finally { delete global.__techPulseHub; }
});

test('apply link requires authentication and records authenticated clicks', async () => {
  const context = (id: string) => ctxFrom(new Request(`http://localhost/api/v1/hackathons/${id}/apply-link`), ['hackathons', id, 'apply-link']);
  await assert.rejects(() => handleCatalog(context(hack)), /sign in/i);
  const ctx = context(hack);
  ctx.auth = { user: { id: owner } } as AuthContext;
  const response = await handleCatalog(ctx);
  assert.equal(response?.status, 302);
  const target = get<{ apply_url: string }>('SELECT apply_url FROM hackathons WHERE id=?', hack)!;
  assert.equal(response?.headers.get('location'), target.apply_url);
  assert.equal(get<{ user_id: string }>('SELECT user_id FROM apply_clicks WHERE user_id=? ORDER BY created_at DESC LIMIT 1', owner)?.user_id, owner);
  const missing = context(`${tag}missing`); missing.auth = ctx.auth;
  await assert.rejects(() => handleCatalog(missing), /not found/i);
});

test('apply link rejects invalid stored destinations and does not log a click', async () => {
  const original = get<{ apply_url: string; official_url: string }>('SELECT apply_url,official_url FROM hackathons WHERE id=?', hack)!;
  const { ctxFrom } = await import('../src/server/router.ts');
  const makeCtx = () => {
    const ctx = ctxFrom(new Request(`http://localhost/api/v1/hackathons/${hack}/apply-link`), ['hackathons', hack, 'apply-link']);
    ctx.auth = { user: { id: owner } } as AuthContext;
    return ctx;
  };
  const before = get<{ n: number }>('SELECT COUNT(*) n FROM apply_clicks WHERE user_id=?', owner)!.n;
  try {
    for (const url of ['http://example.com/apply', 'https://user:password@example.com/apply']) {
      run('UPDATE hackathons SET apply_url=?,official_url=? WHERE id=?', url, url, hack);
      await assert.rejects(() => handleCatalog(makeCtx()), /no valid external link/i);
    }
  } finally { run('UPDATE hackathons SET apply_url=?,official_url=? WHERE id=?', original.apply_url, original.official_url, hack); }
  assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM apply_clicks WHERE user_id=?', owner)!.n, before);
});

test('search respects visibility and public keys require a shared conversation or team', async () => {
  const { handleUsers } = await import('../src/server/routes/users.ts');
  run('INSERT INTO user_settings (user_id,profile_visibility) VALUES (?,?)', owner, 'private');
  run('INSERT INTO user_settings (user_id,profile_visibility) VALUES (?,?)', member, 'team-only');
  run('INSERT INTO user_settings (user_id,profile_visibility) VALUES (?,?)', other, 'public');
  run('INSERT INTO devices (id,user_id,public_jwk,label,created_at) VALUES (?,?,?,?,?)', `${tag}dev`, owner, '{}', 'test', Date.now());
  const search = async (viewer?: string) => {
    const ctx = ctxFrom(new Request(`http://localhost/api/v1/search?q=${tag}`), ['search']);
    if (viewer) ctx.auth = { user: { id: viewer } } as AuthContext;
    const response = await handleCatalog(ctx);
    return (await response!.json() as { people: { id: string }[] }).people.map((u) => u.id);
  };
  assert.deepEqual(await search(), [other]);
  const team = get<{ id: string }>('SELECT id FROM teams WHERE owner_id=?', owner)!;
  run('INSERT INTO team_members VALUES (?,?,?)', team.id, member, Date.now());
  assert.deepEqual((await search(owner)).sort(), [member, other].sort());
  const keys = (viewer: string, target: string) => {
    const ctx = ctxFrom(new Request(`http://localhost/api/v1/users/${target}/public-keys`), ['users', target, 'public-keys']);
    ctx.auth = { user: { id: viewer } } as AuthContext;
    return handleUsers(ctx);
  };
  await assert.rejects(() => keys(other, owner), (e: { status: number }) => e.status === 404);
  assert.equal((await (await keys(member, owner))!.json() as { items: unknown[] }).items.length, 1);
  assert.equal((await (await keys(owner, owner))!.json() as { items: unknown[] }).items.length, 1);
  // Conversation-only peers also receive keys.
  run('INSERT INTO conversation_members (conversation_id,user_id,wrapped_key,last_read_at) VALUES (?,?,?,?)', tag, other, '', 0);
  assert.equal((await (await keys(other, owner))!.json() as { items: unknown[] }).items.length, 1);
});

test('logout everywhere revokes all sessions and refresh tokens but not other users', async () => {
  const { createAuthCookies, getAuth, rotateAuth } = await import('../src/server/auth.ts');
  const { handleAuth } = await import('../src/server/routes/auth.ts');
  const toCookie = (cookies: string[]) => cookies.map((c) => c.split(';')[0]).join('; ');
  const request = new Request('http://localhost/api/v1/auth/login');
  const one = createAuthCookies(owner, request, true);
  const two = createAuthCookies(owner, request, true);
  const third = createAuthCookies(other, request, true);
  const logoutRequest = new Request('http://localhost/api/v1/auth/logout-everywhere', { method: 'POST', headers: { cookie: toCookie(one.cookies), 'x-csrf-token': one.csrf, origin: 'http://localhost' } });
  const global = globalThis as unknown as { __techPulseHub?: unknown };
  const disconnected: string[] = [];
  global.__techPulseHub = { disconnectUser: (id: string) => disconnected.push(id) };
  let response: Response | null;
  try { response = await handleAuth(ctxFrom(logoutRequest, ['auth', 'logout-everywhere'])); }
  finally { delete global.__techPulseHub; }
  assert.equal(response?.status, 200);
  assert.deepEqual(disconnected, [owner]);
  for (const cookies of [one.cookies, two.cookies]) {
    const req = new Request('http://localhost/', { headers: { cookie: toCookie(cookies) } });
    assert.equal(getAuth(req), null);
    assert.equal(rotateAuth(req), null);
  }
  assert.ok(getAuth(new Request('http://localhost/', { headers: { cookie: toCookie(third.cookies) } })));
});

test('API enforcement uses the current database-backed assurance state', async () => {
  const { enforceApiAccess } = await import('../src/server/router.ts');
  const ctx = ctxFrom(new Request('http://localhost/api/v1/calendar'), ['calendar']);
  assert.throws(() => enforceApiAccess(ctx), (e: { status: number }) => e.status === 401);
  ctx.auth = { user: { id: owner, totp_enabled: 0 }, session: { aal2: 0 } } as AuthContext;
  assert.throws(() => enforceApiAccess(ctx), (e: { code: string }) => e.code === 'MFA_ENROLL_REQUIRED');
  ctx.auth.user.totp_enabled = 1;
  assert.throws(() => enforceApiAccess(ctx), (e: { code: string }) => e.code === 'AAL2_REQUIRED');
  ctx.auth.session.aal2 = 1;
  assert.doesNotThrow(() => enforceApiAccess(ctx));
});
