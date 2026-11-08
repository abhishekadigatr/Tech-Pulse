import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWrappedNotesKey, decryptNote, encryptNote, unwrapNotesKey, b64, unb64 } from '../src/lib/crypto.ts';

const old = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'tp-notes-'));
process.chdir(temp);
const { db, get, run } = await import('../src/server/db.ts');
const { sealForUser } = await import('../src/server/crypto.ts');
const { toApplication, createApplication } = await import('../src/server/repo.ts');
const { applicationSchema, calendarSchema } = await import('../src/server/schemas.ts');
after(() => { db().close(); process.chdir(old); rmSync(temp, { recursive: true, force: true }); });

test('notes key wraps and decrypts; wrong passphrase and tampering fail', async () => {
  const { key, wrapped } = await createWrappedNotesKey('a long private passphrase');
  const recovered = await unwrapNotesKey('a long private passphrase', wrapped);
  const encrypted = await encryptNote(key, 'private note 🌱');
  assert.notEqual(encrypted.includes('private'), true);
  assert.equal(await decryptNote(recovered, encrypted), 'private note 🌱');
  await assert.rejects(() => unwrapNotesKey('wrong passphrase', wrapped));
  const parts = encrypted.split('.'); const cipher = unb64(parts[2]); cipher[0] ^= 1; parts[2] = b64(cipher);
  await assert.rejects(() => decryptNote(recovered, parts.join('.')));
  const wrappedBytes = unb64(wrapped.ciphertext); wrappedBytes[0] ^= 1;
  await assert.rejects(() => unwrapNotesKey('a long private passphrase', { ...wrapped, ciphertext: b64(wrappedBytes) }));
});

test('legacy notes are readable and migrate to client ciphertext on edit', async () => {
  const user = 'notes-test';
  run('INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)', user, 'notes@example.test', 'Notes', 'x', Date.now());
  const hack = get<{ id: string }>('SELECT id FROM hackathons LIMIT 1')!.id;
  const now = Date.now();
  run('INSERT INTO applications (id,user_id,hackathon_id,status,notes,applied_at,updated_at) VALUES (?,?,?,?,?,?,?)', 'legacy', user, hack, 'applied', sealForUser(user, 'legacy private text'), now, now);
  const row = get<Parameters<typeof toApplication>[0]>('SELECT * FROM applications WHERE id=?', 'legacy')!;
  const legacy = toApplication(row);
  assert.equal(legacy.notesFormat, 'legacy'); assert.equal(legacy.notes, 'legacy private text');
  const { key } = await createWrappedNotesKey('another long passphrase');
  const ciphertext = await encryptNote(key, legacy.notes);
  const updated = createApplication(user, hack, 'applied', ciphertext);
  assert.equal(updated.notesFormat, 'client'); assert.equal(updated.notes, ciphertext);
  assert.equal(await decryptNote(key, updated.notes), legacy.notes);
  assert.equal(get<{ notes: string }>('SELECT notes FROM applications WHERE id=?', 'legacy')!.notes, ciphertext);
  assert.equal(applicationSchema.safeParse({ hackathonId: hack, notes: 'plaintext' }).success, false);
  assert.equal(calendarSchema.safeParse({ title: 'Test', startsAt: 1, endsAt: 2, notes: 'plaintext' }).success, false);
});

test('wrapped key endpoint prevents replacement, and calendar migrates legacy notes', async () => {
  const { handleUsers } = await import('../src/server/routes/users.ts');
  const { handlePlanning } = await import('../src/server/routes/planning.ts');
  const { ctxFrom } = await import('../src/server/router.ts');
  const { userById } = await import('../src/server/auth.ts');
  const user = 'notes-test';
  const auth = { user: userById(user)!, session: { aal2: 1, id: 'session' }, csrf: 'csrf' } as unknown as import('../src/server/auth.ts').AuthContext;
  const ctx = (path: string, method: string, body?: unknown) => {
    const request = new Request(`http://localhost/api/v1${path}`, { method, headers: { origin: 'http://localhost', 'x-csrf-token': 'csrf', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const c = ctxFrom(request, path.slice(1).split('/')); c.auth = auth; return c;
  };
  const { key, wrapped } = await createWrappedNotesKey('a secure notes passphrase');
  assert.equal((await handleUsers(ctx('/users/me/notes-key', 'POST', wrapped)))?.status, 201);
  assert.equal((await handleUsers(ctx('/users/me/notes-key', 'POST', wrapped)))?.status, 409);
  const retrieved = await handleUsers(ctx('/users/me/notes-key', 'GET'));
  assert.deepEqual((await retrieved!.json() as { wrapped: unknown }).wrapped, wrapped);
  const now = Date.now();
  run('INSERT INTO calendar_events (id,user_id,title,type,starts_at,ends_at,notes,remind_offsets,created_at) VALUES (?,?,?,?,?,?,?,?,?)', 'legacy-calendar', user, 'Test', 'study', now, now + 1000, sealForUser(user, 'old calendar note'), '[]', now);
  const { calendarEvents } = await import('../src/server/features.ts');
  const before = calendarEvents(user).find((e) => e.id === 'legacy-calendar')!;
  assert.equal(before.notesFormat, 'legacy'); assert.equal(before.notes, 'old calendar note');
  const ciphertext = await encryptNote(key, before.notes);
  const response = await handlePlanning(ctx('/calendar/legacy-calendar', 'PATCH', { notes: ciphertext }));
  assert.equal(response?.status, 200);
  const after = calendarEvents(user).find((e) => e.id === 'legacy-calendar')!;
  assert.equal(after.notesFormat, 'client'); assert.equal(after.notes, ciphertext);
  assert.equal(await decryptNote(key, after.notes), before.notes);
});
