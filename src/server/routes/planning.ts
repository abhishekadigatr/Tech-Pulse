import { db, get, run } from '../db.ts';
import { notFound } from '../http.ts';
import { ok, readBody, requireAuth, Routes, write, type Ctx } from '../router.ts';
import { syncHackathonCalendar } from '../repo.ts';
import {
  calendarEvents, createCalendarEvent, createTrip, deleteCalendarEvent, icsFeed,
  markAllNotificationsRead, markNotificationRead, notificationsFor, saveTripPlace,
  tripById, tripsFor, unreadCount, updateCalendarEvent,
} from '../features.ts';
import { calendarPatchSchema, calendarSchema, pushSchema, tripSchema } from '../schemas.ts';
import { z } from 'zod';

export async function handlePlanning(ctx: Ctx): Promise<Response | null> {
  const r = new Routes(ctx);

  r.get('/calendar', ({ ctx: c }) => {
    const auth = requireAuth(c);
    const from = Number(c.url.searchParams.get('from') ?? 0) || 0;
    const to = Number(c.url.searchParams.get('to') ?? 0) || Number.MAX_SAFE_INTEGER;
    return ok({ items: calendarEvents(auth.user.id, from, to) });
  });

  r.get('/calendar/ics', ({ ctx: c }) => {
    const auth = requireAuth(c);
    return new Response(icsFeed(auth.user.id), {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'attachment; filename="tech-pulse-calendar.ics"',
        'cache-control': 'no-store',
      },
    });
  });

  r.post('/calendar', async ({ ctx: c }) => {
    const auth = write(c);
    const input = await readBody(c, calendarSchema);
    if (input.endsAt < input.startsAt) return ok({ error: 'End time must be after start time' }, 400);
    return ok({ event: createCalendarEvent(auth.user.id, input) }, 201);
  });

  r.post('/calendar/sync-hackathon/:id', ({ ctx: c, params }) => {
    const auth = write(c);
    if (!get('SELECT 1 FROM hackathons WHERE id=?', params.id)) return notFound('Hackathon not found');
    return ok({ added: syncHackathonCalendar(auth.user.id, params.id) });
  });

  r.patch('/calendar/:id', async ({ ctx: c, params }) => {
    const auth = write(c);
    const input = await readBody(c, calendarPatchSchema);
    const event = updateCalendarEvent(auth.user.id, params.id, input);
    return event ? ok({ event }) : notFound('Event not found');
  });

  r.delete('/calendar/:id', ({ ctx: c, params }) => {
    const auth = write(c);
    return deleteCalendarEvent(auth.user.id, params.id) ? ok({ ok: true }) : notFound('Event not found');
  });

  r.post('/push/subscribe', async ({ ctx: c }) => {
    const auth = write(c);
    const input = await readBody(c, pushSchema);
    db().prepare(`INSERT INTO push_subscriptions (id,user_id,endpoint,keys_json,created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET keys_json=excluded.keys_json, user_id=excluded.user_id`)
      .run(`push_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, auth.user.id,
        input.endpoint, JSON.stringify(input.keys), Date.now());
    return ok({ ok: true });
  });

  r.delete('/push/subscribe', async ({ ctx: c }) => {
    const auth = write(c);
    const input = await readBody(c, z.object({ endpoint: z.string().url().max(1000) }));
    run('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?', auth.user.id, input.endpoint);
    return ok({ ok: true });
  });

  r.get('/notifications', ({ ctx: c }) => {
    const auth = requireAuth(c);
    return ok({ items: notificationsFor(auth.user.id), unread: unreadCount(auth.user.id) });
  });

  r.patch('/notifications/:id/read', ({ ctx: c, params }) => {
    const auth = write(c);
    return markNotificationRead(auth.user.id, params.id) ? ok({ ok: true }) : notFound('Notification not found');
  });

  r.post('/notifications/read-all', ({ ctx: c }) => {
    const auth = write(c);
    markAllNotificationsRead(auth.user.id);
    return ok({ ok: true });
  });

  /* ── Journey / route tips ────────────────────────────────────────────── */
  r.get('/trips', ({ ctx: c }) => {
    const auth = requireAuth(c);
    return ok({ items: tripsFor(auth.user.id) });
  });

  r.post('/trips', async ({ ctx: c }) => {
    const auth = write(c);
    const input = await readBody(c, tripSchema);
    const trip = createTrip(auth.user.id, input.hackathonId, input.origin, input.mode);
    return trip ? ok({ trip }, 201) : notFound('Hackathon not found');
  });

  r.get('/trips/:id', ({ ctx: c, params }) => {
    const auth = requireAuth(c);
    const trip = tripById(params.id, auth.user.id);
    return trip ? ok({ trip }) : notFound('Trip not found');
  });

  r.get('/trips/:id/route', ({ ctx: c, params }) => {
    const auth = requireAuth(c);
    const trip = tripById(params.id, auth.user.id);
    return trip ? ok({ route: trip.route, distanceKm: trip.distanceKm, durationMin: trip.durationMin }) : notFound('Trip not found');
  });

  r.get('/trips/:id/suggestions', ({ ctx: c, params }) => {
    const auth = requireAuth(c);
    const trip = tripById(params.id, auth.user.id);
    if (!trip) return notFound('Trip not found');
    const type = c.url.searchParams.get('type');
    const maxDetour = Number(c.url.searchParams.get('maxDetourMin') ?? 20) || 20;
    const items = trip.suggestions.filter((p) =>
      (!type || p.type === type) && p.detourMin <= Math.min(60, maxDetour));
    return ok({ items });
  });

  r.get('/trips/:id/checklist', ({ ctx: c, params }) => {
    const auth = requireAuth(c);
    const trip = tripById(params.id, auth.user.id);
    return trip ? ok({ items: trip.checklist }) : notFound('Trip not found');
  });

  r.post('/trips/:id/suggestions/:placeId/save', async ({ ctx: c, params }) => {
    const auth = write(c);
    const { saved } = await readBody(c, z.object({ saved: z.boolean().default(true) }));
    return saveTripPlace(auth.user.id, params.id, params.placeId, saved)
      ? ok({ ok: true, saved }) : notFound('Trip or place not found');
  });

  r.delete('/trips/:id', ({ ctx: c, params }) => {
    const auth = write(c);
    const before = get('SELECT 1 FROM trips WHERE id=? AND user_id=?', params.id, auth.user.id);
    if (!before) return notFound('Trip not found');
    run('DELETE FROM trip_saved_places WHERE trip_id=?', params.id);
    run('DELETE FROM trips WHERE id=? AND user_id=?', params.id, auth.user.id);
    return ok({ ok: true });
  });

  return r.run();
}

