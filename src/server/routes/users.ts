import { z } from 'zod';
import { audit, revokeAuth, userById } from '../auth.ts';
import { all, get, run } from '../db.ts';
import { openForUser, sealForUser, verifyPassword } from '../crypto.ts';
import { json, notFound, withCookies } from '../http.ts';
import { applicationsFor, settingsFor, toMe } from '../repo.ts';
import { ok, readBody, requireAuth, Routes, write, type Ctx } from '../router.ts';
import { deviceSchema, profileSchema, settingsSchema, vaultSchema } from '../schemas.ts';
import { calendarEvents, notificationsFor } from '../features.ts';

export async function handleUsers(ctx: Ctx): Promise<Response | null> {
  const r = new Routes(ctx);

  r.get('/users/me', ({ ctx: c }) => {
    const auth = requireAuth(c);
    return ok({ me: toMe(auth.user, Boolean(auth.session.aal2)) });
  });

  r.get('/users/me/settings', ({ ctx: c }) => {
    const auth = requireAuth(c);
    return ok({ settings: settingsFor(auth.user.id) });
  });

  r.patch('/users/me', async ({ ctx: c }) => {
    const auth = write(c);
    const input = await readBody(c, profileSchema);
    const u = userById(auth.user.id)!;
    run('UPDATE users SET name=?, college=?, city=?, skills=?, bio=? WHERE id=?',
      input.name ?? u.name, input.college ?? u.college, input.city ?? u.city,
      input.skills ? JSON.stringify(input.skills) : u.skills, input.bio ?? u.bio, u.id);
    audit(u.id, 'user.profile_updated', c.request);
    return ok({ me: toMe(userById(u.id)!, Boolean(auth.session.aal2)) });
  });

  r.patch('/users/me/settings', async ({ ctx: c }) => {
    const auth = write(c);
    const input = await readBody(c, settingsSchema);
    const map: Record<string, [string, (v: unknown) => string | number]> = {
      theme: ['theme', String],
      notifyInApp: ['notify_in_app', (v) => Number(Boolean(v))],
      notifyPush: ['notify_push', (v) => Number(Boolean(v))],
      notifyEmail: ['notify_email', (v) => Number(Boolean(v))],
      reminderOffsets: ['reminder_offsets', (v) => JSON.stringify(v)],
      profileVisibility: ['profile_visibility', String],
      showJourneyTips: ['show_journey_tips', (v) => Number(Boolean(v))],
      weeklyDigest: ['weekly_digest', (v) => Number(Boolean(v))],
    };
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || !map[key]) continue;
      const [column, transform] = map[key];
      run(`UPDATE user_settings SET ${column}=? WHERE user_id=?`, transform(value), auth.user.id);
    }
    audit(auth.user.id, 'user.settings_updated', c.request);
    return ok({ settings: settingsFor(auth.user.id) });
  });

  /* ── Two-step encrypted private vault ─────────────────────────────────────
   * Layer 1 (browser): AES-GCM with a PBKDF2 key derived from the user's vault
   * passphrase. The server receives only ciphertext.
   * Layer 2 (server): AES-256-GCM envelope with a per-user HKDF data key.
   * Neither layer alone can reveal the plaintext.
   */
  r.get('/users/me/vault', ({ ctx: c }) => {
    const auth = requireAuth(c);
    const row = get<{ salt: string; blob: string; updated_at: number }>('SELECT * FROM vaults WHERE user_id=?', auth.user.id);
    if (!row) return ok({ vault: null });
    let blob = '';
    try { blob = openForUser(auth.user.id, row.blob); } catch { return ok({ vault: null }); }
    return ok({ vault: { salt: row.salt, blob, updatedAt: row.updated_at } });
  });

  r.put('/users/me/vault', async ({ ctx: c }) => {
    const auth = write(c);
    const input = await readBody(c, vaultSchema);
    run(`INSERT INTO vaults (user_id,salt,blob,updated_at) VALUES (?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET salt=excluded.salt, blob=excluded.blob, updated_at=excluded.updated_at`,
      auth.user.id, input.salt, sealForUser(auth.user.id, input.blob), Date.now());
    audit(auth.user.id, 'user.vault_written', c.request);
    return ok({ ok: true, layers: ['browser AES-GCM / PBKDF2', 'server AES-256-GCM / HKDF'] });
  });

  r.post('/users/me/devices', async ({ ctx: c }) => {
    const auth = write(c);
    const input = await readBody(c, deviceSchema);
    const id = `dev_${auth.user.id}_${Buffer.from(input.label).toString('base64url').slice(0, 24)}`;
    run(`INSERT INTO devices (id,user_id,public_jwk,label,created_at) VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET public_jwk=excluded.public_jwk, created_at=excluded.created_at`,
      id, auth.user.id, JSON.stringify(input.publicJwk), input.label, Date.now());
    audit(auth.user.id, 'user.device_registered', c.request, input.label);
    return ok({ device: { id, label: input.label } });
  });

  r.get('/users/:id/public-keys', ({ ctx: c, params }) => {
    const auth = requireAuth(c);
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(params.id)) return notFound();
    // Keys are available only to the owner or existing peers, regardless of visibility.
    if (params.id !== auth.user.id && !get(`SELECT 1 FROM conversation_members a JOIN conversation_members b ON a.conversation_id=b.conversation_id
      WHERE a.user_id=? AND b.user_id=? UNION SELECT 1 FROM team_members a JOIN team_members b ON a.team_id=b.team_id
      WHERE a.user_id=? AND b.user_id=? LIMIT 1`, auth.user.id, params.id, auth.user.id, params.id)) return notFound();
    if (!userById(params.id)) return notFound();
    const rows = all<{ id: string; public_jwk: string; label: string; created_at: number }>(
      'SELECT * FROM devices WHERE user_id=? ORDER BY created_at DESC', params.id);
    return ok({ items: rows.map((d) => ({ id: d.id, label: d.label, createdAt: d.created_at, publicJwk: JSON.parse(d.public_jwk) })) });
  });

  r.get('/users/me/export', ({ ctx: c }) => {
    const auth = requireAuth(c);
    const u = auth.user;
    const vault = get<{ salt: string; blob: string }>('SELECT * FROM vaults WHERE user_id=?', u.id);
    const payload = {
      exportedAt: new Date().toISOString(),
      profile: { id: u.id, email: u.email, name: u.name, college: u.college, city: u.city, skills: JSON.parse(u.skills), bio: u.bio },
      settings: settingsFor(u.id),
      applications: applicationsFor(u.id).map((a) => ({ hackathon: a.hackathon.name, status: a.status, notes: a.notes, appliedAt: new Date(a.appliedAt).toISOString() })),
      calendar: calendarEvents(u.id).map((e) => ({ title: e.title, type: e.type, startsAt: new Date(e.startsAt).toISOString(), notes: e.notes })),
      notifications: notificationsFor(u.id, 100).map((n) => ({ title: n.title, body: n.body, createdAt: new Date(n.createdAt).toISOString() })),
      publicDeviceKeys: all<{ public_jwk: string }>('SELECT public_jwk FROM devices WHERE user_id=?', u.id).map((d) => JSON.parse(d.public_jwk)),
      encryptedVault: vault ? { ...vault, note: 'Double-encrypted; decrypt with your vault passphrase + server key.' } : null,
    };
    return json(payload, 200, { 'content-disposition': 'attachment; filename="tech-pulse-export.json"' });
  });

  r.delete('/users/me', async ({ ctx: c }) => {
    const auth = write(c);
    const { password } = await readBody(c, z.object({ password: z.string().max(200) }));
    if (!await verifyPassword(password, auth.user.password_hash)) return json({ error: 'Incorrect password', code: 'INVALID_PASSWORD' }, 400);
    const id = auth.user.id;
    const byUser = ['user_settings', 'vaults', 'devices', 'sessions', 'refresh_tokens', 'ws_tickets',
      'bookmarks', 'applications', 'team_members', 'seekers', 'conversation_members',
      'calendar_events', 'reminders', 'notifications', 'push_subscriptions', 'trips'];
    run('DELETE FROM trip_saved_places WHERE trip_id IN (SELECT id FROM trips WHERE user_id=?)', id);
    for (const table of byUser) run(`DELETE FROM ${table} WHERE user_id=?`, id);
    run('DELETE FROM messages WHERE sender_id=?', id);
    run('DELETE FROM team_requests WHERE from_user_id=?', id);
    run('DELETE FROM teams WHERE owner_id=?', id);
    run('DELETE FROM conversations WHERE id NOT IN (SELECT conversation_id FROM conversation_members)');
    run('UPDATE users SET email=?, name=?, college=?, city=?, bio=?, skills=?, deleted_at=? WHERE id=?',
      `deleted-${id}@invalid.local`, 'Deleted account', '', '', '', '[]', Date.now(), id);
    audit(null, 'user.deleted', c.request, id);
    return withCookies(ok({ ok: true }), revokeAuth(c.request));
  });

  return r.run();
}
