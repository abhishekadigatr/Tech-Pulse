import { all, get, run, uid } from './db.ts';
import { openForUser } from './crypto.ts';
import type { UserRow } from './auth.ts';
import type {
  Application, ApplicationStatus, Hackathon, Me, Mode, Paged, PublicUser, UserSettings,
} from '@/lib/types';

export interface HackathonRow {
  id: string; slug: string; name: string; organizer: string; description: string;
  domain: string; tags: string; mode: Mode; city: string; venue: string;
  lat: number; lng: number; deadline: number; start_at: number; end_at: number;
  official_url: string; apply_url: string; prize: string; hue: number;
  source: string; approval_status: 'approved' | 'pending' | 'rejected'; created_at: number;
}

export interface SettingsRow {
  user_id: string; theme: string; notify_in_app: number; notify_push: number; notify_email: number;
  reminder_offsets: string; profile_visibility: string; show_journey_tips: number; weekly_digest: number;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? (JSON.parse(value) as T) : fallback; } catch { return fallback; }
}

export function publicUser(row: UserRow): PublicUser {
  const settings = get<SettingsRow>('SELECT * FROM user_settings WHERE user_id=?', row.id);
  return {
    id: row.id,
    name: row.name,
    avatarHue: row.avatar_hue,
    college: row.college,
    city: row.city,
    skills: parseJson<string[]>(row.skills, []),
    bio: row.bio,
    role: row.role,
    profileVisibility: (settings?.profile_visibility as PublicUser['profileVisibility']) ?? 'public',
  };
}

export function publicUserById(id: string): PublicUser {
  const row = get<UserRow>('SELECT * FROM users WHERE id=? AND deleted_at IS NULL', id);
  if (!row) return { id, name: 'Former member', avatarHue: 200, college: '', city: '', skills: [], bio: '', role: 'user', profileVisibility: 'private' };
  return publicUser(row);
}

export function settingsFor(userId: string): UserSettings {
  const s = get<SettingsRow>('SELECT * FROM user_settings WHERE user_id=?', userId);
  return {
    theme: (s?.theme as UserSettings['theme']) ?? 'nebula',
    notifyInApp: Boolean(s?.notify_in_app ?? 1),
    notifyPush: Boolean(s?.notify_push ?? 0),
    notifyEmail: Boolean(s?.notify_email ?? 0),
    reminderOffsets: parseJson<number[]>(s?.reminder_offsets, [10080, 1440, 120]),
    profileVisibility: (s?.profile_visibility as UserSettings['profileVisibility']) ?? 'public',
    showJourneyTips: Boolean(s?.show_journey_tips ?? 1),
    weeklyDigest: Boolean(s?.weekly_digest ?? 1),
  };
}

export function toMe(user: UserRow, aal2: boolean): Me {
  return {
    ...publicUser(user),
    email: user.email,
    emailVerified: Boolean(user.email_verified),
    totpEnabled: Boolean(user.totp_enabled),
    aal2,
    createdAt: user.created_at,
    settings: settingsFor(user.id),
  };
}

export function hackathonRow(idOrSlug: string): HackathonRow | undefined {
  return get<HackathonRow>('SELECT * FROM hackathons WHERE (id=? OR slug=?) AND approval_status=?', idOrSlug, idOrSlug, 'approved');
}

export function toHackathon(row: HackathonRow, userId?: string): Hackathon {
  const bookmarked = userId
    ? Boolean(get('SELECT 1 FROM bookmarks WHERE user_id=? AND hackathon_id=?', userId, row.id))
    : false;
  const app = userId
    ? get<{ status: ApplicationStatus }>('SELECT status FROM applications WHERE user_id=? AND hackathon_id=?', userId, row.id)
    : undefined;
  const counts = get<{ teams: number; seekers: number }>(
    `SELECT (SELECT COUNT(*) FROM teams WHERE hackathon_id=?) as teams,
            (SELECT COUNT(*) FROM seekers WHERE hackathon_id=?) as seekers`, row.id, row.id);
  return {
    id: row.id, slug: row.slug, name: row.name, organizer: row.organizer,
    description: row.description, domain: row.domain, tags: parseJson<string[]>(row.tags, []),
    mode: row.mode, city: row.city, venue: row.venue, lat: row.lat, lng: row.lng,
    deadline: row.deadline, startAt: row.start_at, endAt: row.end_at,
    officialUrl: row.official_url, applyUrl: row.apply_url, prize: row.prize,
    hue: row.hue, source: row.source, approvalStatus: row.approval_status,
    bookmarked, application: app?.status ?? null,
    teamCount: counts?.teams ?? 0, seekerCount: counts?.seekers ?? 0,
  };
}

export interface HackathonFilters {
  q?: string; mode?: string; city?: string; tag?: string; status?: string;
  sort?: string; page?: number; pageSize?: number;
}

export function listHackathons(filters: HackathonFilters, userId?: string): Paged<Hackathon> {
  const now = Date.now();
  const where = ["approval_status='approved'"];
  const params: unknown[] = [];
  if (filters.q) {
    where.push('(LOWER(name) LIKE ? OR LOWER(organizer) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(domain) LIKE ?)');
    const q = `%${filters.q.toLowerCase().slice(0, 80)}%`;
    params.push(q, q, q, q, q);
  }
  if (filters.mode && ['online', 'offline', 'hybrid'].includes(filters.mode)) {
    where.push('mode=?'); params.push(filters.mode);
  }
  if (filters.city) { where.push('LOWER(city)=LOWER(?)'); params.push(filters.city.slice(0, 60)); }
  if (filters.tag) { where.push('LOWER(tags) LIKE ?'); params.push(`%${filters.tag.toLowerCase().slice(0, 40)}%`); }
  if (filters.status === 'open') { where.push('deadline > ?'); params.push(now); }
  if (filters.status === 'closed') { where.push('deadline <= ?'); params.push(now); }
  if (filters.status === 'saved' && userId) { where.push('id IN (SELECT hackathon_id FROM bookmarks WHERE user_id=?)'); params.push(userId); }
  if (filters.status === 'applied' && userId) { where.push('id IN (SELECT hackathon_id FROM applications WHERE user_id=?)'); params.push(userId); }
  const order = filters.sort === 'deadline' ? 'deadline ASC'
    : filters.sort === 'latest' ? 'start_at ASC'
      : filters.sort === 'prize' ? 'LENGTH(prize) DESC'
        : 'deadline ASC';
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(48, Math.max(1, filters.pageSize ?? 12));
  const clause = where.join(' AND ');
  const total = get<{ n: number }>(`SELECT COUNT(*) as n FROM hackathons WHERE ${clause}`, ...params)?.n ?? 0;
  const rows = all<HackathonRow>(
    `SELECT * FROM hackathons WHERE ${clause} ORDER BY CASE WHEN deadline > ${now} THEN 0 ELSE 1 END, ${order} LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize,
  );
  return { items: rows.map((r) => toHackathon(r, userId)), page, pageSize, total };
}

export function facets(): { cities: string[]; tags: string[]; domains: string[]; modes: string[] } {
  const rows = all<HackathonRow>("SELECT * FROM hackathons WHERE approval_status='approved'");
  const tags = new Set<string>();
  for (const r of rows) for (const t of parseJson<string[]>(r.tags, [])) tags.add(t);
  return {
    cities: [...new Set(rows.map((r) => r.city))].sort(),
    tags: [...tags].sort(),
    domains: [...new Set(rows.map((r) => r.domain))].sort(),
    modes: ['online', 'offline', 'hybrid'],
  };
}

/* ── Applications / Inbox tracking ───────────────────────────────────────── */
export interface ApplicationRow {
  id: string; user_id: string; hackathon_id: string; status: ApplicationStatus;
  notes: string; applied_at: number; updated_at: number;
}

export function toApplication(row: ApplicationRow, withHackathon = true): Application {
  let notes = row.notes.startsWith('enc1.') ? row.notes : '';
  let notesFormat: 'client' | 'legacy' | 'empty' | 'unreadable' = row.notes.startsWith('enc1.') ? 'client' : row.notes ? 'legacy' : 'empty';
  if (notesFormat === 'legacy') { try { notes = openForUser(row.user_id, row.notes); } catch { notesFormat = 'unreadable'; } }
  const hr = get<HackathonRow>('SELECT * FROM hackathons WHERE id=?', row.hackathon_id);
  return {
    id: row.id, userId: row.user_id, hackathonId: row.hackathon_id,
    hackathon: hr && withHackathon ? toHackathon(hr, row.user_id) : ({} as Hackathon),
    status: row.status, notes, notesFormat, appliedAt: row.applied_at, updatedAt: row.updated_at,
  };
}

export function applicationsFor(userId: string, status?: string): Application[] {
  const rows = status
    ? all<ApplicationRow>('SELECT * FROM applications WHERE user_id=? AND status=? ORDER BY updated_at DESC', userId, status)
    : all<ApplicationRow>('SELECT * FROM applications WHERE user_id=? ORDER BY updated_at DESC', userId);
  return rows.map((r) => toApplication(r));
}

export function createApplication(userId: string, hackathonId: string, status: ApplicationStatus, notes = ''): Application {
  const existing = get<ApplicationRow>('SELECT * FROM applications WHERE user_id=? AND hackathon_id=?', userId, hackathonId);
  const now = Date.now();
  if (existing) {
    // Re-tracking without a note must not erase an existing encrypted note.
    const updatedNotes = notes || existing.notes;
    run('UPDATE applications SET status=?, notes=?, updated_at=? WHERE id=?',
      status, updatedNotes, now, existing.id);
    return toApplication({ ...existing, status, notes: updatedNotes, updated_at: now });
  }
  const id = uid('app');
  run('INSERT INTO applications (id,user_id,hackathon_id,status,notes,applied_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    id, userId, hackathonId, status, notes, now, now);
  syncHackathonCalendar(userId, hackathonId);
  return toApplication(get<ApplicationRow>('SELECT * FROM applications WHERE id=?', id)!);
}

/** Auto-add deadline + event dates when a hackathon is tracked. */
export function syncHackathonCalendar(userId: string, hackathonId: string): number {
  const h = get<HackathonRow>('SELECT * FROM hackathons WHERE id=?', hackathonId);
  if (!h) return 0;
  const offsets = JSON.stringify(settingsFor(userId).reminderOffsets);
  const now = Date.now();
  let added = 0;
  const insert = (title: string, type: string, start: number, end: number, notes: string) => {
    if (get('SELECT 1 FROM calendar_events WHERE user_id=? AND hackathon_id=? AND type=?', userId, hackathonId, type)) return;
    run(`INSERT INTO calendar_events (id,user_id,title,type,starts_at,ends_at,hackathon_id,notes,remind_offsets,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      uid('cal'), userId, title, type, start, end, hackathonId, notes, offsets, now);
    added += 1;
  };
  insert(`Apply · ${h.name}`, 'apply', h.deadline - 2 * 3_600_000, h.deadline, '');
  insert(h.name, 'hackathon', h.start_at, h.end_at, '');
  return added;
}
