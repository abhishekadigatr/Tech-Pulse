import { audit } from '../auth.ts';
import { get, run } from '../db.ts';
import { conflict, notFound, safeExternalUrl } from '../http.ts';
import { adminOnly, ok, readBody, Routes, write, type Ctx } from '../router.ts';
import { hackathonRow, toHackathon, type HackathonRow } from '../repo.ts';
import { adminCreateHackathon, adminDeleteHackathon, adminStats, auditEntries, ingestFeed, runReminderSweep } from '../features.ts';
import { hackathonSchema } from '../schemas.ts';

export async function handleAdmin(ctx: Ctx): Promise<Response | null> {
  const r = new Routes(ctx);

  r.get('/admin/stats', ({ ctx: c }) => {
    adminOnly(c);
    return ok({ stats: adminStats(), audit: auditEntries(12) });
  });

  r.get('/admin/audit', ({ ctx: c }) => {
    adminOnly(c);
    return ok({ items: auditEntries(Math.min(200, Number(c.url.searchParams.get('limit') ?? 60) || 60)) });
  });

  r.post('/admin/hackathons', async ({ ctx: c }) => {
    const auth = adminOnly(c);
    write(c);
    const input = await readBody(c, hackathonSchema);
    if (!safeExternalUrl(input.officialUrl) || !safeExternalUrl(input.applyUrl)) {
      return ok({ error: 'Only valid HTTPS URLs are accepted' }, 400);
    }
    if (input.endAt < input.startAt) return ok({ error: 'End date must be after start date' }, 400);
    const hackathon = adminCreateHackathon(input);
    audit(auth.user.id, 'admin.hackathon_created', c.request, hackathon.id);
    return ok({ hackathon }, 201);
  });

  r.patch('/admin/hackathons/:id', async ({ ctx: c, params }) => {
    const auth = adminOnly(c);
    write(c);
    const row = hackathonRow(params.id);
    if (!row) return notFound('Hackathon not found');
    const input = await readBody(c, hackathonSchema.partial());
    if (input.officialUrl) {
      if (!safeExternalUrl(input.officialUrl)) return ok({ error: 'Invalid URL' }, 400);
      const duplicate = get<{ id: string }>('SELECT id FROM hackathons WHERE official_url=? AND id<>?', input.officialUrl, row.id);
      if (duplicate) conflict('Another hackathon already uses this official URL');
    }
    const columns: Array<[string, unknown]> = [
      ['name', input.name], ['organizer', input.organizer], ['description', input.description],
      ['domain', input.domain], ['tags', input.tags ? JSON.stringify(input.tags) : undefined],
      ['mode', input.mode], ['city', input.city], ['venue', input.venue],
      ['deadline', input.deadline], ['start_at', input.startAt], ['end_at', input.endAt],
      ['official_url', input.officialUrl], ['apply_url', input.applyUrl], ['prize', input.prize],
    ];
    try {
      for (const [column, value] of columns) {
        if (value === undefined) continue;
        run(`UPDATE hackathons SET ${column}=? WHERE id=?`, value, row.id);
      }
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
        conflict('Another hackathon already uses this official URL');
      }
      throw error;
    }
    audit(auth.user.id, 'admin.hackathon_updated', c.request, row.id);
    return ok({ hackathon: toHackathon(get<HackathonRow>('SELECT * FROM hackathons WHERE id=?', row.id)!) });
  });

  r.delete('/admin/hackathons/:id', ({ ctx: c, params }) => {
    const auth = adminOnly(c);
    write(c);
    if (!adminDeleteHackathon(params.id)) return notFound('Hackathon not found');
    audit(auth.user.id, 'admin.hackathon_deleted', c.request, params.id);
    return ok({ ok: true });
  });

  r.post('/admin/ingest', async ({ ctx: c }) => {
    const auth = adminOnly(c);
    write(c);
    const result = await ingestFeed();
    audit(auth.user.id, 'admin.ingest', c.request, JSON.stringify(result));
    return ok(result);
  });

  r.post('/admin/reminders/run', ({ ctx: c }) => {
    const auth = adminOnly(c);
    write(c);
    const sent = runReminderSweep();
    audit(auth.user.id, 'admin.reminder_sweep', c.request, `sent=${sent}`);
    return ok({ sent });
  });

  return r.run();
}
