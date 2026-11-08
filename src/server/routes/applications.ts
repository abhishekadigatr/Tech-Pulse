import { get, run } from '../db.ts';
import { notFound } from '../http.ts';
import { applicationsFor, createApplication, toApplication, type ApplicationRow } from '../repo.ts';
import { ok, readBody, requireAuth, Routes, write, type Ctx } from '../router.ts';
import { applicationPatchSchema, applicationSchema } from '../schemas.ts';
import { createNotification, inboxFor } from '../features.ts';

export async function handleApplications(ctx: Ctx): Promise<Response | null> {
  const r = new Routes(ctx);

  r.get('/applications', ({ ctx: c, }) => {
    const auth = requireAuth(c);
    return ok({ items: applicationsFor(auth.user.id, c.url.searchParams.get('status') ?? undefined) });
  });

  r.post('/applications', async ({ ctx: c }) => {
    const auth = write(c);
    const input = await readBody(c, applicationSchema);
    const row = get<{ id: string; name: string }>('SELECT id,name FROM hackathons WHERE id=? AND approval_status=?', input.hackathonId, 'approved');
    if (!row) return notFound('Hackathon not found');
    const app = createApplication(auth.user.id, input.hackathonId, input.status, input.notes);
    createNotification(auth.user.id, 'application', `Tracking · ${row.name}`,
      `Added to your inbox as “${input.status}”. Deadline and event dates were added to your calendar.`, '/inbox');
    return ok({ application: app }, 201);
  });

  r.patch('/applications/:id', async ({ ctx: c, params }) => {
    const auth = write(c);
    const existing = get<ApplicationRow>('SELECT * FROM applications WHERE id=? AND user_id=?', params.id, auth.user.id);
    if (!existing) return notFound('Application not found');
    const input = await readBody(c, applicationPatchSchema);
    run('UPDATE applications SET status=?, notes=?, updated_at=? WHERE id=?',
      input.status ?? existing.status,
      input.notes !== undefined ? input.notes : existing.notes,
      Date.now(), params.id);
    return ok({ application: toApplication(get<ApplicationRow>('SELECT * FROM applications WHERE id=?', params.id)!) });
  });

  r.delete('/applications/:id', ({ ctx: c, params }) => {
    const auth = write(c);
    const changed = (() => {
      const before = get('SELECT 1 FROM applications WHERE id=? AND user_id=?', params.id, auth.user.id);
      if (!before) return false;
      run('DELETE FROM applications WHERE id=? AND user_id=?', params.id, auth.user.id);
      return true;
    })();
    if (!changed) return notFound('Application not found');
    return ok({ ok: true });
  });

  r.get('/inbox', ({ ctx: c }) => {
    const auth = requireAuth(c);
    return ok({ items: inboxFor(auth.user.id) });
  });

  return r.run();
}
