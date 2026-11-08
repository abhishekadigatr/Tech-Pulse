import { audit } from '../auth.ts';
import { all, run, uid } from '../db.ts';
import { clampInt, clientIp, notFound, safeExternalUrl } from '../http.ts';
import { limit, ok, Routes, write, type Ctx } from '../router.ts';
import { facets, hackathonRow, listHackathons, parseJson, toHackathon } from '../repo.ts';

export async function handleCatalog(ctx: Ctx): Promise<Response | null> {
  const r = new Routes(ctx);

  r.get('/hackathons', ({ ctx: c }) => {
    const q = c.url.searchParams;
    const result = listHackathons({
      q: q.get('q') ?? undefined,
      mode: q.get('mode') ?? undefined,
      city: q.get('city') ?? undefined,
      tag: q.get('tag') ?? undefined,
      status: q.get('status') ?? undefined,
      sort: q.get('sort') ?? undefined,
      page: clampInt(q.get('page'), 1, 1000, 1),
      pageSize: clampInt(q.get('pageSize'), 1, 48, 12),
    }, c.auth?.user.id);
    return ok(result);
  });

  r.get('/facets', () => ok(facets()));

  r.get('/search', ({ ctx: c }) => {
    const q = (c.url.searchParams.get('q') ?? '').slice(0, 80);
    const hackathons = listHackathons({ q, pageSize: 8 }, c.auth?.user.id).items;
    const skills = q.length >= 2
      ? all<{ name: string; id: string; skills: string }>('SELECT id,name,skills FROM users WHERE deleted_at IS NULL AND (LOWER(name) LIKE ? OR LOWER(skills) LIKE ?) LIMIT 8', `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`)
        .map((u) => ({ id: u.id, name: u.name, skills: parseJson<string[]>(u.skills, []) }))
      : [];
    return ok({ hackathons, people: skills, query: q });
  });

  r.get('/hackathons/:id', ({ ctx: c, params }) => {
    const row = hackathonRow(params.id);
    if (!row) return notFound('Hackathon not found');
    return ok({ hackathon: toHackathon(row, c.auth?.user.id) });
  });

  r.post('/hackathons/:id/bookmark', ({ ctx: c, params }) => {
    const auth = write(c);
    const row = hackathonRow(params.id);
    if (!row) return notFound('Hackathon not found');
    run('INSERT OR IGNORE INTO bookmarks (user_id,hackathon_id,created_at) VALUES (?,?,?)', auth.user.id, row.id, Date.now());
    return ok({ bookmarked: true });
  });

  r.delete('/hackathons/:id/bookmark', ({ ctx: c, params }) => {
    const auth = write(c);
    run('DELETE FROM bookmarks WHERE user_id=? AND hackathon_id=?', auth.user.id, params.id);
    return ok({ bookmarked: false });
  });

  /** Logs the outbound click, then 302s to the validated official URL.
   *  Only https: URLs already stored in the DB can ever be a redirect target. */
  r.get('/hackathons/:id/apply-link', ({ ctx: c, params }) => {
    const row = hackathonRow(params.id);
    if (!row) return notFound('Hackathon not found');
    const target = safeExternalUrl(row.apply_url) ?? safeExternalUrl(row.official_url);
    if (!target) return notFound('This listing has no valid external link');
    limit(`apply:${clientIp(c.request)}`, 60, 60_000);
    run('INSERT INTO apply_clicks (id,user_id,hackathon_id,ip_hash,created_at) VALUES (?,?,?,?,?)',
      uid('clk'), c.auth?.user.id ?? null, row.id, clientIp(c.request), Date.now());
    if (c.auth) audit(c.auth.user.id, 'hackathon.apply_click', c.request, row.id);
    return new Response(null, {
      status: 302,
      headers: {
        location: target.toString(),
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  });

  return r.run();
}
