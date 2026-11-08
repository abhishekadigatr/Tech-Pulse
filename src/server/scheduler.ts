import { all, get } from './db.ts';
import { ensureReminders, ingestFeed, runReminderSweep } from './features.ts';
import { parseJson } from './repo.ts';

/** Single-node job runner. On a multi-node deploy, move these two loops to a
 *  queue worker (BullMQ/Redis) — the functions themselves are idempotent. */
export function startScheduler(): () => void {
  const backfill = (): void => {
    const rows = all<{ id: string; user_id: string; starts_at: number; remind_offsets: string }>('SELECT * FROM calendar_events');
    for (const row of rows) {
      if (get('SELECT 1 FROM reminders WHERE event_id=?', row.id)) continue;
      ensureReminders(row.id, row.user_id, row.starts_at, parseJson<number[]>(row.remind_offsets, [10080, 1440, 120]));
    }
  };

  backfill();
  const sent = runReminderSweep();
  if (sent) console.log(`[reminders] delivered ${sent} reminder(s)`);

  const reminders = setInterval(() => {
    try { runReminderSweep(); } catch (error) { console.error('[reminders]', error); }
  }, 60_000);

  const ingest = setInterval(() => {
    if (!process.env.OPPORTUNITIES_SHEET_FEED_URL) return;
    void ingestFeed().then((r) => {
      if (r.inserted || r.updated) console.log(`[ingest] +${r.inserted} ~${r.updated} opportunities`);
    }).catch((error) => console.error('[ingest]', error));
  }, 6 * 60 * 60_000);

  reminders.unref?.();
  ingest.unref?.();
  return () => { clearInterval(reminders); clearInterval(ingest); };
}
