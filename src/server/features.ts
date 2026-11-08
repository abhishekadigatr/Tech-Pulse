import { all, db, get, run, uid } from './db.ts';
import { conflict } from './http.ts';
import { sealForUser, openForUser } from './crypto.ts';
import { getHub } from './ws-hub.ts';
import {
  hackathonRow, parseJson, publicUserById, settingsFor, toHackathon,
  type HackathonRow,
} from './repo.ts';
import type {
  CalendarEvent, CalendarType, CipherMessage, Conversation, Hackathon, InboxItem,
  JourneyPlace, Notification, Paged, PlaceType, RequestStatus, RoutePoint,
  Seeker, Team, TeamRequest, Trip,
} from '@/lib/types';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/* ─────────────────────────────── Teams / Collaborate ─────────────────────── */
interface TeamRow {
  id: string; hackathon_id: string; owner_id: string; title: string; description: string;
  looking_for: string; max_size: number; created_at: number;
}

export function toTeam(row: TeamRow, viewerId?: string): Team {
  const members = all<{ user_id: string }>('SELECT user_id FROM team_members WHERE team_id=?', row.id)
    .map((m) => publicUserById(m.user_id));
  const hr = get<HackathonRow>('SELECT * FROM hackathons WHERE id=?', row.hackathon_id);
  const myRequest = viewerId
    ? get<{ status: RequestStatus }>('SELECT status FROM team_requests WHERE team_id=? AND from_user_id=? ORDER BY created_at DESC LIMIT 1', row.id, viewerId)
    : undefined;
  return {
    id: row.id, hackathonId: row.hackathon_id,
    hackathon: hr ? toHackathon(hr, viewerId) : undefined,
    ownerId: row.owner_id, owner: publicUserById(row.owner_id),
    title: row.title, description: row.description,
    lookingFor: parseJson<string[]>(row.looking_for, []), maxSize: row.max_size,
    members, createdAt: row.created_at, myRequestStatus: myRequest?.status ?? null,
  };
}

export function listTeams(hackathonId: string | undefined, viewerId?: string): Team[] {
  const rows = hackathonId
    ? all<TeamRow>('SELECT * FROM teams WHERE hackathon_id=? ORDER BY created_at DESC', hackathonId)
    : all<TeamRow>('SELECT * FROM teams ORDER BY created_at DESC');
  return rows.map((r) => toTeam(r, viewerId));
}

export function teamById(id: string, viewerId?: string): Team | undefined {
  const row = get<TeamRow>('SELECT * FROM teams WHERE id=?', id);
  return row ? toTeam(row, viewerId) : undefined;
}

export function createTeam(ownerId: string, hackathonId: string, title: string, description: string, lookingFor: string[], maxSize: number): Team {
  const id = uid('team');
  db().exec('BEGIN IMMEDIATE');
  try {
    run(`INSERT INTO teams (id,hackathon_id,owner_id,title,description,looking_for,max_size,created_at)
         VALUES (?,?,?,?,?,?,?,?)`, id, hackathonId, ownerId, title, description, JSON.stringify(lookingFor), maxSize, Date.now());
    run('INSERT INTO team_members VALUES (?,?,?)', id, ownerId, Date.now());
    db().exec('COMMIT');
  } catch (error) { db().exec('ROLLBACK'); throw error; }
  return toTeam(get<TeamRow>('SELECT * FROM teams WHERE id=?', id)!, ownerId);
}

export function deleteTeam(id: string, ownerId: string): boolean {
  return dbRun('DELETE FROM teams WHERE id=? AND owner_id=?', id, ownerId) > 0;
}

export function listSeekers(hackathonId?: string): Seeker[] {
  const rows = hackathonId
    ? all<{ id: string; user_id: string; hackathon_id: string; headline: string; skills: string; availability: string; created_at: number }>(
      'SELECT * FROM seekers WHERE hackathon_id=? ORDER BY created_at DESC', hackathonId)
    : all<{ id: string; user_id: string; hackathon_id: string; headline: string; skills: string; availability: string; created_at: number }>(
      'SELECT * FROM seekers ORDER BY created_at DESC');
  return rows.map((r) => ({
    id: r.id, user: publicUserById(r.user_id), hackathonId: r.hackathon_id,
    hackathon: (() => { const hr = get<HackathonRow>('SELECT * FROM hackathons WHERE id=?', r.hackathon_id); return hr ? toHackathon(hr) : undefined; })(),
    headline: r.headline, skills: parseJson<string[]>(r.skills, []),
    availability: r.availability, createdAt: r.created_at,
  }));
}

export function upsertSeeker(userId: string, hackathonId: string, headline: string, skills: string[], availability: string): Seeker {
  run(`INSERT INTO seekers (id,user_id,hackathon_id,headline,skills,availability,created_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id,hackathon_id) DO UPDATE SET headline=excluded.headline, skills=excluded.skills, availability=excluded.availability`,
    uid('seek'), userId, hackathonId, headline, JSON.stringify(skills), availability, Date.now());
  const row = get<{ id: string }>('SELECT id FROM seekers WHERE user_id=? AND hackathon_id=?', userId, hackathonId)!;
  return listSeekers().find((s) => s.id === row.id)!;
}

export function teamRequestsFor(userId: string, status?: RequestStatus): TeamRequest[] {
  const rows = status
    ? all<{ id: string; team_id: string; from_user_id: string; message: string; status: RequestStatus; created_at: number; title: string; name: string }>(
      `SELECT r.*, t.title, h.name FROM team_requests r JOIN teams t ON t.id=r.team_id JOIN hackathons h ON h.id=t.hackathon_id
       WHERE t.owner_id=? AND r.status=? ORDER BY r.created_at DESC`, userId, status)
    : all<{ id: string; team_id: string; from_user_id: string; message: string; status: RequestStatus; created_at: number; title: string; name: string }>(
      `SELECT r.*, t.title, h.name FROM team_requests r JOIN teams t ON t.id=r.team_id JOIN hackathons h ON h.id=t.hackathon_id
       WHERE t.owner_id=? ORDER BY r.created_at DESC`, userId);
  return rows.map((r) => ({
    id: r.id, teamId: r.team_id, teamTitle: r.title, hackathonName: r.name,
    fromUser: publicUserById(r.from_user_id), message: r.message, status: r.status, createdAt: r.created_at,
  }));
}

export function createTeamRequest(teamId: string, fromUserId: string, message: string): TeamRequest | null {
  const team = get<TeamRow>('SELECT * FROM teams WHERE id=?', teamId);
  if (!team || team.owner_id === fromUserId) return null;
  if (get('SELECT 1 FROM team_requests WHERE team_id=? AND from_user_id=? AND status=?', teamId, fromUserId, 'pending')) return null;
  const id = uid('req');
  run('INSERT INTO team_requests (id,team_id,from_user_id,message,status,created_at) VALUES (?,?,?,?,?,?)',
    id, teamId, fromUserId, message, 'pending', Date.now());
  const title = get<{ title: string }>('SELECT title FROM teams WHERE id=?', teamId)?.title ?? 'a team';
  createNotification(team.owner_id, 'team', 'New teammate request', `${publicUserById(fromUserId).name} wants to join ${title}.`, '/collaborate');
  return teamRequestsFor(team.owner_id).find((r) => r.id === id) ?? null;
}

/** Accept creates/updates the encrypted team conversation and notifies both sides. */
export function resolveTeamRequest(requestId: string, ownerId: string, accept: boolean): boolean {
  db().exec('BEGIN IMMEDIATE');
  const row = get<{ id: string; team_id: string; from_user_id: string; status: RequestStatus; owner_id: string; title: string; hackathon_id: string }>(
    `SELECT r.*, t.owner_id, t.title, t.hackathon_id FROM team_requests r JOIN teams t ON t.id=r.team_id WHERE r.id=?`, requestId);
  if (!row || row.owner_id !== ownerId || row.status !== 'pending') {
    db().exec('ROLLBACK');
    return false;
  }
  try {
    if (accept && !get('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?', row.team_id, row.from_user_id)) {
      const team = get<{ max_size: number; count: number }>(
        'SELECT max_size, (SELECT COUNT(*) FROM team_members WHERE team_id=teams.id) AS count FROM teams WHERE id=?', row.team_id);
      if (!team || team.count >= team.max_size) conflict('Team is full');
      run('INSERT INTO team_members VALUES (?,?,?)', row.team_id, row.from_user_id, Date.now());
    }
    run('UPDATE team_requests SET status=?, resolved_at=? WHERE id=?', accept ? 'accepted' : 'rejected', Date.now(), requestId);
    db().exec('COMMIT');
  } catch (error) { db().exec('ROLLBACK'); throw error; }
  if (!accept) {
    createNotification(row.from_user_id, 'team', 'Team request update', `Your request to join ${row.title} was declined.`, '/collaborate');
    return true;
  }
  let conv = get<{ id: string }>('SELECT id FROM conversations WHERE team_id=?', row.team_id);
  if (!conv) {
    const convId = uid('conv');
    run('INSERT INTO conversations (id,kind,team_id,title,key_version,created_at) VALUES (?,?,?,?,?,?)',
      convId, 'team', row.team_id, `${row.title} · team chat`, 1, Date.now());
    conv = { id: convId };
    for (const m of all<{ user_id: string }>('SELECT user_id FROM team_members WHERE team_id=?', row.team_id)) {
      run('INSERT OR IGNORE INTO conversation_members (conversation_id,user_id,wrapped_key,last_read_at) VALUES (?,?,?,?)', convId, m.user_id, '', 0);
    }
  } else {
    run('INSERT OR IGNORE INTO conversation_members (conversation_id,user_id,wrapped_key,last_read_at) VALUES (?,?,?,?)', conv.id, row.from_user_id, '', 0);
  }
  createNotification(row.from_user_id, 'team', 'You are in! 🎉', `You joined ${row.title}. An encrypted team chat is ready.`, `/chat/${conv.id}`);
  getHub()?.broadcast(row.from_user_id, 'team:update', { teamId: row.team_id, conversationId: conv.id });
  return true;
}

export function removeTeamMember(teamId: string, ownerId: string, memberId: string): boolean {
  const team = get<TeamRow>('SELECT * FROM teams WHERE id=? AND owner_id=?', teamId, ownerId);
  if (!team || memberId === ownerId) return false;
  if (dbRun('DELETE FROM team_members WHERE team_id=? AND user_id=?', teamId, memberId) < 1) return false;
  const conversationId = get<{ id: string }>('SELECT id FROM conversations WHERE team_id=?', teamId)?.id;
  if (conversationId) {
    dbRun('DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?', conversationId, memberId);
    rotateConversationKey(conversationId, ownerId);
  }
  getHub()?.broadcast(memberId, 'team:update', { teamId, removed: true });
  return true;
}

/* ─────────────────────────────── Conversations / chat ───────────────────── */
export function listConversations(userId: string): Conversation[] {
  const rows = all<{ id: string; kind: 'dm' | 'team'; team_id: string | null; title: string; key_version: number; created_at: number }>(
    `SELECT c.* FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id
     WHERE m.user_id=? ORDER BY c.created_at DESC`, userId);
  return rows.map((r) => {
    const members = all<{ user_id: string }>('SELECT user_id FROM conversation_members WHERE conversation_id=?', r.id)
      .map((m) => publicUserById(m.user_id));
    const last = get<{ created_at: number }>('SELECT created_at FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT 1', r.id);
    const read = get<{ last_read_at: number }>('SELECT last_read_at FROM conversation_members WHERE conversation_id=? AND user_id=?', r.id, userId);
    const unread = get<{ n: number }>('SELECT COUNT(*) as n FROM messages WHERE conversation_id=? AND created_at>? AND sender_id<>?',
      r.id, read?.last_read_at ?? 0, userId)?.n ?? 0;
    const title = r.kind === 'dm'
      ? (members.find((m) => m.id !== userId)?.name ?? 'Direct message')
      : r.title;
    return {
      id: r.id, kind: r.kind, teamId: r.team_id, title, members,
      keyVersion: r.key_version, lastMessageAt: last?.created_at ?? r.created_at, unread,
      online: getHub()?.conversationOnline(r.id) ?? 0,
    };
  });
}

export function conversationById(id: string, userId: string): Conversation | undefined {
  return listConversations(userId).find((c) => c.id === id);
}

export function createDirectConversation(userId: string, otherUserId: string): Conversation | null {
  if (userId === otherUserId || !get('SELECT 1 FROM users WHERE id=?', otherUserId)) return null;
  const existing = get<{ id: string }>(
    `SELECT c.id FROM conversations c
     JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=?
     JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=?
     WHERE c.kind='dm' LIMIT 1`, userId, otherUserId);
  if (existing) return conversationById(existing.id, userId) ?? null;
  const id = uid('conv');
  run('INSERT INTO conversations (id,kind,team_id,title,key_version,created_at) VALUES (?,?,?,?,?,?)',
    id, 'dm', null, 'Direct message', 1, Date.now());
  run('INSERT INTO conversation_members VALUES (?,?,?,?)', id, userId, '', 0);
  run('INSERT INTO conversation_members VALUES (?,?,?,?)', id, otherUserId, '', 0);
  return conversationById(id, userId) ?? null;
}

export function conversationKeys(id: string, userId: string): {
  keyVersion: number; myWrappedKey: string; members: Array<{ userId: string; publicJwk: unknown }>;
  ready: boolean; initialized: boolean;
} | null {
  const conv = get<{ key_version: number }>('SELECT key_version FROM conversations WHERE id=?', id);
  if (!conv || !get('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?', id, userId)) return null;
  const members = all<{ user_id: string; wrapped_key: string; public_jwk: string | null }>(
    `SELECT m.user_id, m.wrapped_key, (SELECT d.public_jwk FROM devices d WHERE d.user_id=m.user_id ORDER BY d.created_at DESC LIMIT 1) as public_jwk
     FROM conversation_members m WHERE m.conversation_id=?`, id);
  return {
    keyVersion: conv.key_version,
    myWrappedKey: members.find((m) => m.user_id === userId)?.wrapped_key ?? '',
    members: members.map((m) => ({ userId: m.user_id, publicJwk: m.public_jwk ? parseJson(m.public_jwk, null) : null })),
    ready: members.length > 0 && members.every((m) => Boolean(m.wrapped_key)),
    initialized: members.some((m) => Boolean(m.wrapped_key)),
  };
}

/** The browser wraps a fresh AES-GCM conversation key for each member's public key. */
export function setConversationKeys(id: string, userId: string, version: number, wrapped: Array<{ userId: string; wrappedKey: string }>): boolean {
  if (!get('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?', id, userId)) return false;
  const conv = get<{ key_version: number }>('SELECT key_version FROM conversations WHERE id=?', id);
  if (!conv || conv.key_version !== version) return false;
  const members = new Set(all<{ user_id: string }>('SELECT user_id FROM conversation_members WHERE conversation_id=?', id).map((m) => m.user_id));
  const seen = new Set<string>();
  if (wrapped.length === 0 || wrapped.length !== members.size) return false;
  for (const w of wrapped) {
    if (!members.has(w.userId) || seen.has(w.userId) || w.wrappedKey.length > 4096 || w.wrappedKey.length < 10) return false;
    seen.add(w.userId);
  }
  for (const w of wrapped) {
    run('UPDATE conversation_members SET wrapped_key=? WHERE conversation_id=? AND user_id=?', w.wrappedKey, id, w.userId);
  }
  for (const memberId of members) getHub()?.broadcast(memberId, 'keys:updated', { conversationId: id, keyVersion: version });
  return true;
}

/** Called when a member leaves: old key is retired and must be re-wrapped. */
export function rotateConversationKey(id: string, userId: string): boolean {
  if (!get('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?', id, userId)) return false;
  run('UPDATE conversations SET key_version=key_version+1 WHERE id=?', id);
  run('UPDATE conversation_members SET wrapped_key=? WHERE conversation_id=?', '', id);
  for (const member of all<{ user_id: string }>('SELECT user_id FROM conversation_members WHERE conversation_id=?', id))
    getHub()?.broadcast(member.user_id, 'keys:updated', { conversationId: id, rotated: true });
  return true;
}

export function messagesFor(id: string, userId: string, before?: number, limit = 50): Paged<CipherMessage> {
  if (!get('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?', id, userId)) {
    return { items: [], page: 1, pageSize: limit, total: 0 };
  }
  const cursor = before && Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER;
  const rows = all<{ id: string; conversation_id: string; sender_id: string; ciphertext: string; nonce: string; key_version: number; created_at: number }>(
    'SELECT * FROM messages WHERE conversation_id=? AND created_at<? ORDER BY created_at DESC LIMIT ?', id, cursor, Math.min(100, limit))
    .reverse();
  return {
    items: rows.map((r) => ({
      id: r.id, conversationId: r.conversation_id, senderId: r.sender_id,
      senderName: publicUserById(r.sender_id).name, ciphertext: r.ciphertext, nonce: r.nonce,
      keyVersion: r.key_version, createdAt: r.created_at,
    })),
    page: 1, pageSize: limit,
    total: get<{ n: number }>('SELECT COUNT(*) as n FROM messages WHERE conversation_id=?', id)?.n ?? 0,
  };
}

export function markConversationRead(id: string, userId: string): void {
  run('UPDATE conversation_members SET last_read_at=? WHERE conversation_id=? AND user_id=?', Date.now(), id, userId);
}

/* ─────────────────────────────── Calendar / reminders ───────────────────── */
interface CalendarRow {
  id: string; user_id: string; title: string; type: CalendarType; starts_at: number; ends_at: number;
  hackathon_id: string | null; notes: string; remind_offsets: string; created_at: number;
}

export function toCalendarEvent(row: CalendarRow): CalendarEvent {
  let notes = '';
  try { notes = openForUser(row.user_id, row.notes); } catch { notes = ''; }
  return {
    id: row.id, userId: row.user_id, title: row.title, type: row.type,
    startsAt: row.starts_at, endsAt: row.ends_at, hackathonId: row.hackathon_id,
    notes, remindOffsets: parseJson<number[]>(row.remind_offsets, [10080, 1440, 120]),
    createdAt: row.created_at,
  };
}

export function calendarEvents(userId: string, from?: number, to?: number): CalendarEvent[] {
  const rows = all<CalendarRow>(
    'SELECT * FROM calendar_events WHERE user_id=? AND starts_at>=? AND starts_at<=? ORDER BY starts_at',
    userId, from ?? 0, to ?? Number.MAX_SAFE_INTEGER);
  return rows.map(toCalendarEvent);
}

export function createCalendarEvent(userId: string, input: {
  title: string; type: CalendarType; startsAt: number; endsAt: number; notes: string; remindOffsets: number[]; hackathonId?: string | null;
}): CalendarEvent {
  const id = uid('cal');
  run(`INSERT INTO calendar_events (id,user_id,title,type,starts_at,ends_at,hackathon_id,notes,remind_offsets,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`, id, userId, input.title, input.type, input.startsAt, input.endsAt,
    input.hackathonId ?? null, sealForUser(userId, input.notes), JSON.stringify(input.remindOffsets), Date.now());
  ensureReminders(id, userId, input.startsAt, input.remindOffsets);
  return toCalendarEvent(get<CalendarRow>('SELECT * FROM calendar_events WHERE id=?', id)!);
}

export function updateCalendarEvent(userId: string, id: string, input: Partial<{
  title: string; startsAt: number; endsAt: number; notes: string; remindOffsets: number[]; type: CalendarType;
}>): CalendarEvent | null {
  const row = get<CalendarRow>('SELECT * FROM calendar_events WHERE id=? AND user_id=?', id, userId);
  if (!row) return null;
  const startsAt = input.startsAt ?? row.starts_at;
  const offsets = input.remindOffsets ?? parseJson<number[]>(row.remind_offsets, [10080, 1440, 120]);
  run(`UPDATE calendar_events SET title=?, starts_at=?, ends_at=?, notes=?, remind_offsets=?, type=? WHERE id=?`,
    input.title ?? row.title, startsAt, input.endsAt ?? row.ends_at,
    input.notes !== undefined ? sealForUser(userId, input.notes) : row.notes,
    JSON.stringify(offsets), input.type ?? row.type, id);
  run('DELETE FROM reminders WHERE event_id=? AND sent_at IS NULL', id);
  ensureReminders(id, userId, startsAt, offsets);
  return toCalendarEvent(get<CalendarRow>('SELECT * FROM calendar_events WHERE id=?', id)!);
}

export function deleteCalendarEvent(userId: string, id: string): boolean {
  return dbRun('DELETE FROM calendar_events WHERE id=? AND user_id=?', id, userId) > 0;
}

export function ensureReminders(eventId: string, userId: string, startsAt: number, offsets: number[]): void {
  for (const minutes of offsets) {
    const dueAt = startsAt - minutes * 60_000;
    if (dueAt <= Date.now()) continue;
    run('INSERT OR IGNORE INTO reminders (id,user_id,event_id,offset_minutes,due_at,sent_at) VALUES (?,?,?,?,?,NULL)',
      uid('rem'), userId, eventId, minutes, dueAt);
  }
}

/** Idempotent worker tick: no external queue needed for a single-node deploy. */
export function runReminderSweep(): number {
  const due = all<{ id: string; user_id: string; event_id: string; offset_minutes: number; due_at: number }>(
    'SELECT * FROM reminders WHERE sent_at IS NULL AND due_at<=? ORDER BY due_at LIMIT 200', Date.now());
  let sent = 0;
  for (const r of due) {
    const event = get<CalendarRow>('SELECT * FROM calendar_events WHERE id=?', r.event_id);
    if (!event) { run('UPDATE reminders SET sent_at=? WHERE id=?', Date.now(), r.id); continue; }
    const settings = settingsFor(r.user_id);
    const when = r.offset_minutes >= 1440 ? `${Math.round(r.offset_minutes / 1440)} day(s)` : `${r.offset_minutes} minutes`;
    if (settings.notifyInApp || settings.notifyPush || settings.notifyEmail) {
      createNotification(r.user_id, 'reminder', `Reminder · ${event.title}`,
        `Starts in ${when}. ${typeLabel(event.type)}`, '/calendar');
      sent += 1;
    }
    run('UPDATE reminders SET sent_at=? WHERE id=?', Date.now(), r.id);
  }
  return sent;
}

const typeLabel = (type: CalendarType): string =>
  ({ apply: 'Finish and submit your application.', study: 'Time for a focused study block.', hackathon: 'Pack your gear and charge up.', travel: 'Check your route and leave on time.' })[type];

function escapeIcs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
const icsDate = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function icsFeed(userId: string): string {
  const events = calendarEvents(userId);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tech Pulse//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@techpulse.local`, `DTSTAMP:${icsDate(Date.now())}`,
      `DTSTART:${icsDate(e.startsAt)}`, `DTEND:${icsDate(e.endsAt)}`, `SUMMARY:${escapeIcs(e.title)}`,
      `DESCRIPTION:${escapeIcs(typeLabel(e.type))}`, 'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcs(e.title)}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/* ─────────────────────────────── Notifications / inbox ──────────────────── */
interface NotificationRow {
  id: string; user_id: string; kind: Notification['kind']; title: string; body: string;
  link: string; read_at: number | null; created_at: number;
}

export const toNotification = (r: NotificationRow): Notification => ({
  id: r.id, userId: r.user_id, kind: r.kind, title: r.title, body: r.body,
  link: r.link, readAt: r.read_at, createdAt: r.created_at,
});

export function notificationsFor(userId: string, limit = 50): Notification[] {
  return all<NotificationRow>('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ?', userId, Math.min(200, limit))
    .map(toNotification);
}

export function createNotification(userId: string, kind: Notification['kind'], title: string, body: string, link: string): Notification {
  const id = uid('ntf');
  run('INSERT INTO notifications (id,user_id,kind,title,body,link,read_at,created_at) VALUES (?,?,?,?,?,?,NULL,?)',
    id, userId, kind, title, body, link, Date.now());
  const row = get<NotificationRow>('SELECT * FROM notifications WHERE id=?', id)!;
  getHub()?.broadcast(userId, 'notification:new', { notification: toNotification(row) });
  return toNotification(row);
}

export function markNotificationRead(userId: string, id: string): boolean {
  return dbRun('UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL', Date.now(), id, userId) > 0;
}

export function markAllNotificationsRead(userId: string): void {
  run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', Date.now(), userId);
}

export function unreadCount(userId: string): number {
  return get<{ n: number }>('SELECT COUNT(*) as n FROM notifications WHERE user_id=? AND read_at IS NULL', userId)?.n ?? 0;
}

export function inboxFor(userId: string): InboxItem[] {
  const items: InboxItem[] = [];
  for (const a of all<{ id: string; hackathon_id: string; status: string; applied_at: number; name: string }>(
    `SELECT a.*, h.name FROM applications a JOIN hackathons h ON h.id=a.hackathon_id WHERE a.user_id=?`, userId)) {
    items.push({
      id: `app:${a.id}`, kind: 'application', title: `Application · ${a.name}`,
      body: `Status: ${a.status}. Tap to update notes or move it along your pipeline.`,
      link: '/inbox', createdAt: a.applied_at, read: true, meta: a.status,
    });
  }
  for (const n of notificationsFor(userId)) {
    items.push({ id: `not:${n.id}`, kind: 'notification', title: n.title, body: n.body,
      link: n.link, createdAt: n.createdAt, read: Boolean(n.readAt), meta: n.kind });
  }
  for (const r of teamRequestsFor(userId, 'pending')) {
    items.push({ id: `req:${r.id}`, kind: 'request', title: `Join request · ${r.teamTitle}`,
      body: `${r.fromUser.name}: ${r.message || 'Would like to join your team.'}`,
      link: '/collaborate', createdAt: r.createdAt, read: false, meta: 'pending' });
  }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

/* ─────────────────────────────── Journey / tips ─────────────────────────── */
const CITY_COORDS: Record<string, [number, number]> = {
  mysuru: [12.2958, 76.6394], mysore: [12.2958, 76.6394], bengaluru: [12.9716, 77.5946],
  bangalore: [12.9716, 77.5946], hyderabad: [17.385, 78.4867], pune: [18.5204, 73.8567],
  mumbai: [19.076, 72.8777], delhi: [28.6139, 77.209], 'new delhi': [28.6139, 77.209],
  chennai: [13.0827, 80.2707], mangaluru: [12.9141, 74.856], remote: [12.9716, 77.5946],
};

function geocode(place: string, fallback: [number, number]): [number, number] {
  const key = place.trim().toLowerCase();
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  const partial = Object.entries(CITY_COORDS).find(([name]) => key.includes(name) || name.includes(key));
  if (partial) return partial[1];
  // Deterministic pseudo-geocode for arbitrary origins so the demo always works.
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return [fallback[0] + ((hash % 200) - 100) / 100, fallback[1] + ((hash % 170) - 85) / 100];
}

const distanceKm = (a: [number, number], b: [number, number]): number => {
  const dLat = (b[0] - a[0]) * 111;
  const dLng = (b[1] - a[1]) * 111 * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
  return Math.max(12, Math.round(Math.hypot(dLat, dLng)));
};

const SPEED: Record<Trip['mode'], number> = { car: 62, train: 75, bus: 52, flight: 620 };

export function buildRoute(origin: string, hackathon: Hackathon, mode: Trip['mode']): { route: RoutePoint[]; distanceKm: number; durationMin: number } {
  const destination: [number, number] = [hackathon.lat, hackathon.lng];
  const start = geocode(origin, destination);
  const km = distanceKm(start, destination);
  const stops = mode === 'flight' ? 2 : 4;
  const route: RoutePoint[] = [];
  for (let i = 0; i <= stops; i += 1) {
    const t = i / stops;
    const lat = start[0] + (destination[0] - start[0]) * t;
    const lng = start[1] + (destination[1] - start[1]) * t;
    const names = i === 0 ? origin : i === stops ? hackathon.city : ['Highway junction', 'Mid-route stop', 'City outskirts'][(i - 1) % 3];
    route.push({ name: typeof names === 'string' ? names : 'Stop', lat, lng, km: Math.round(km * t) });
  }
  const durationMin = Math.round((km / SPEED[mode]) * 60 + (mode === 'flight' ? 150 : mode === 'train' ? 45 : 30));
  return { route, distanceKm: km, durationMin };
}

export function journeySuggestions(tripId: string, hackathon: Hackathon, type?: PlaceType, maxDetour = 20): JourneyPlace[] {
  const saved = new Set(all<{ place_id: string }>('SELECT place_id FROM trip_saved_places WHERE trip_id=?', tripId).map((r) => r.place_id));
  const rows = all<{ id: string; name: string; type: PlaceType; city: string; lat: number; lng: number; rating: number; detour_min: number; open_now: number; price: string; note: string; address: string }>(
    'SELECT * FROM journey_places WHERE city=? OR city=? ORDER BY rating DESC', hackathon.city, nearbyCity(hackathon.city));
  const extra = all<{ id: string; name: string; type: PlaceType; city: string; lat: number; lng: number; rating: number; detour_min: number; open_now: number; price: string; note: string; address: string }>(
    'SELECT * FROM journey_places WHERE city<>? AND city<>? LIMIT 8', hackathon.city, nearbyCity(hackathon.city));
  return [...rows, ...extra]
    .filter((p) => (!type || p.type === type) && p.detour_min <= maxDetour)
    .map((p) => ({ id: p.id, name: p.name, type: p.type, city: p.city, lat: p.lat, lng: p.lng,
      rating: p.rating, detourMin: p.detour_min, openNow: Boolean(p.open_now), price: p.price,
      note: p.note, address: p.address, saved: saved.has(p.id) }))
    .sort((a, b) => (b.rating * 10 + (b.openNow ? 4 : 0) - b.detourMin * 0.15) - (a.rating * 10 + (a.openNow ? 4 : 0) - a.detourMin * 0.15));
}

function nearbyCity(city: string): string {
  return ({ Mysuru: 'Bengaluru', Bengaluru: 'Mysuru', Hyderabad: 'Bengaluru', Pune: 'Mumbai', Mumbai: 'Pune', Delhi: 'Bengaluru', Remote: 'Bengaluru' })[city] ?? 'Bengaluru';
}

export function travelChecklist(hackathon: Hackathon, mode: Trip['mode'], durationMin: number): Array<{ id: string; label: string; category: string }> {
  const days = Math.max(1, Math.ceil((hackathon.endAt - hackathon.startAt) / DAY));
  const list = [
    { id: 'c1', label: 'Laptop, charger and a spare power bank (20,000 mAh)', category: 'Gear' },
    { id: 'c2', label: 'Government/student ID printed + a digital copy', category: 'Documents' },
    { id: 'c3', label: 'Confirm registration QR and check-in time', category: 'Documents' },
    { id: 'c4', label: 'GitHub, cloud credits and API keys ready offline', category: 'Build' },
    { id: 'c5', label: 'Reusable water bottle and a light jacket for the venue', category: 'Comfort' },
    { id: 'c6', label: `${days}-day clothes + basic medication`, category: 'Comfort' },
  ];
  if (mode === 'car') list.push({ id: 'c7', label: 'Check toll balance, fuel and vehicle documents', category: 'Travel' });
  if (mode === 'train' || mode === 'bus') list.push({ id: 'c7', label: 'Download the ticket and screenshot the PNR/seat', category: 'Travel' });
  if (mode === 'flight') list.push({ id: 'c7', label: 'Web check-in 24h before and verify baggage limits', category: 'Travel' });
  if (durationMin > 240) list.push({ id: 'c8', label: 'Plan a meal + rest stop halfway (see suggestions)', category: 'Travel' });
  list.push({ id: 'c9', label: 'Share your live route with a teammate or family member', category: 'Safety' });
  return list;
}

export function tripById(id: string, userId: string): Trip | undefined {
  const row = get<{ id: string; user_id: string; hackathon_id: string; origin: string; mode: Trip['mode']; created_at: number }>(
    'SELECT * FROM trips WHERE id=? AND user_id=?', id, userId);
  if (!row) return undefined;
  const hr = get<HackathonRow>('SELECT * FROM hackathons WHERE id=?', row.hackathon_id);
  if (!hr) return undefined;
  const hackathon = toHackathon(hr, userId);
  const { route, distanceKm, durationMin } = buildRoute(row.origin, hackathon, row.mode);
  return {
    id: row.id, hackathonId: row.hackathon_id, hackathon, origin: row.origin, mode: row.mode,
    distanceKm, durationMin, route, suggestions: journeySuggestions(row.id, hackathon),
    checklist: travelChecklist(hackathon, row.mode, durationMin), createdAt: row.created_at,
  };
}

export function tripsFor(userId: string): Trip[] {
  return all<{ id: string }>('SELECT id FROM trips WHERE user_id=? ORDER BY created_at DESC', userId)
    .map((r) => tripById(r.id, userId)).filter((t): t is Trip => Boolean(t));
}

export function createTrip(userId: string, hackathonId: string, origin: string, mode: Trip['mode']): Trip | null {
  const hr = hackathonRow(hackathonId);
  if (!hr) return null;
  const id = uid('trip');
  run('INSERT INTO trips (id,user_id,hackathon_id,origin,mode,created_at) VALUES (?,?,?,?,?,?)',
    id, userId, hackathonId, origin, mode, Date.now());
  return tripById(id, userId)!;
}

export function saveTripPlace(userId: string, tripId: string, placeId: string, saved: boolean): boolean {
  if (!get('SELECT 1 FROM trips WHERE id=? AND user_id=?', tripId, userId)) return false;
  if (!get('SELECT 1 FROM journey_places WHERE id=?', placeId)) return false;
  if (saved) run('INSERT OR IGNORE INTO trip_saved_places VALUES (?,?,?)', tripId, placeId, Date.now());
  else run('DELETE FROM trip_saved_places WHERE trip_id=? AND place_id=?', tripId, placeId);
  return true;
}

/* ─────────────────────────────── Admin / ingestion ──────────────────────── */
export function adminStats(): Record<string, number> {
  const count = (table: string): number => get<{ n: number }>(`SELECT COUNT(*) as n FROM ${table}`)?.n ?? 0;
  return {
    users: count('users'), hackathons: count('hackathons'), applications: count('applications'),
    teams: count('teams'), conversations: count('conversations'), messages: count('messages'),
    calendarEvents: count('calendar_events'), notifications: count('notifications'),
  };
}

export function auditEntries(limit = 60): Array<{ id: string; action: string; email: string | null; ipHash: string; detail: string; createdAt: number }> {
  return all<{ id: string; action: string; email: string | null; ip_hash: string; detail: string; created_at: number }>(
    `SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT ?`, Math.min(200, limit))
    .map((r) => ({ id: r.id, action: r.action, email: r.email, ipHash: r.ip_hash, detail: r.detail, createdAt: r.created_at }));
}

export function adminCreateHackathon(input: {
  name: string; organizer: string; description: string; domain: string; tags: string[];
  mode: Hackathon['mode']; city: string; venue: string; deadline: number; startAt: number; endAt: number;
  officialUrl: string; applyUrl: string; prize: string;
}): Hackathon {
  if (get<{ id: string }>('SELECT id FROM hackathons WHERE official_url=?', input.officialUrl)) {
    conflict('A hackathon with this official URL already exists');
  }
  const id = uid('hk');
  const slug = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}-${id.slice(-4)}`;
  try {
    run(`INSERT INTO hackathons (id,slug,name,organizer,description,domain,tags,mode,city,venue,lat,lng,deadline,start_at,end_at,official_url,apply_url,prize,hue,source,approval_status,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, slug, input.name, input.organizer, input.description, input.domain, JSON.stringify(input.tags),
      input.mode, input.city, input.venue, 12.9716, 77.5946, input.deadline, input.startAt, input.endAt,
      input.officialUrl, input.applyUrl, input.prize, Math.floor(Math.random() * 360), 'admin', 'approved', Date.now());
  } catch (error) {
    if (isUniqueViolation(error)) conflict('A hackathon with this URL or slug already exists');
    throw error;
  }
  return toHackathon(get<HackathonRow>('SELECT * FROM hackathons WHERE id=?', id)!);
}

export function adminDeleteHackathon(id: string): boolean {
  return dbRun('DELETE FROM hackathons WHERE id=?', id) > 0;
}

let feedCache: { at: number; result: { inserted: number; updated: number; skipped: number; error?: string } } | null = null;

/** Optional HTTPS feed (array or {opportunities}). Dedupe by official_url,
 *  only approved rows, strict URL validation, 5-minute cache, no credentials. */
export async function ingestFeed(): Promise<{ inserted: number; updated: number; skipped: number; error?: string }> {
  if (feedCache && Date.now() - feedCache.at < 5 * 60_000) return feedCache.result;
  const url = process.env.OPPORTUNITIES_SHEET_FEED_URL;
  if (!url) return { inserted: 0, updated: 0, skipped: 0, error: 'No feed configured' };
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { inserted: 0, updated: 0, skipped: 0, error: 'Invalid feed URL' }; }
  if (parsed.protocol !== 'https:') return { inserted: 0, updated: 0, skipped: 0, error: 'Feed must use HTTPS' };
  const result = { inserted: 0, updated: 0, skipped: 0 };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' }, cache: 'no-store' });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw: unknown = await response.json();
    const rows: unknown[] = Array.isArray(raw) ? raw : (raw as { opportunities?: unknown[] })?.opportunities ?? [];
    for (const row of rows.slice(0, 500)) {
      if (!row || typeof row !== 'object') { result.skipped += 1; continue; }
      const r = row as Record<string, unknown>;
      if (r.approval_status !== undefined && r.approval_status !== 'approved') { result.skipped += 1; continue; }
      const official = typeof r.official_url === 'string' ? r.official_url : '';
      const apply = typeof r.apply_url === 'string' ? r.apply_url : official;
      if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(official) || !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(apply) ||
          typeof r.name !== 'string' || typeof r.slug !== 'string' || typeof r.organizer !== 'string' ||
          typeof r.description !== 'string' || typeof r.domain !== 'string' || typeof r.mode !== 'string' ||
          typeof r.deadline !== 'string' && typeof r.deadline !== 'number') { result.skipped += 1; continue; }
      const deadline = Number(new Date(r.deadline as string).getTime());
      if (!Number.isFinite(deadline)) { result.skipped += 1; continue; }
      const existing = get<{ id: string }>('SELECT id FROM hackathons WHERE official_url=?', official);
      const values = [r.name.slice(0, 160), r.organizer.slice(0, 160), r.description.slice(0, 2000),
        r.domain.slice(0, 80), JSON.stringify(Array.isArray(r.tags) ? r.tags.slice(0, 12) : []),
        ['online', 'offline', 'hybrid'].includes(r.mode) ? r.mode : 'online',
        String(r.city ?? 'Remote').slice(0, 80), String(r.venue ?? 'Online').slice(0, 160),
        Number(r.lat) || 12.9716, Number(r.lng) || 77.5946, deadline,
        Number(new Date(String(r.start_at ?? deadline)).getTime()) || deadline,
        Number(new Date(String(r.end_at ?? deadline + DAY)).getTime()) || deadline + DAY,
        official, apply, String(r.prize ?? '').slice(0, 160)];
      let action: 'updated' | 'inserted';
      try {
        if (existing) {
          run(`UPDATE hackathons SET name=?,organizer=?,description=?,domain=?,tags=?,mode=?,city=?,venue=?,lat=?,lng=?,deadline=?,start_at=?,end_at=?,official_url=?,apply_url=?,prize=? WHERE id=?`,
            ...values, existing.id);
          result.updated += 1;
          action = 'updated';
        } else {
          const id = uid('hk');
          let slug = String(r.slug).replace(/[^a-z0-9-]/g, '').slice(0, 70) || id;
          if (get<{ id: string }>('SELECT id FROM hackathons WHERE slug=?', slug)) {
            slug = `${slug.slice(0, 60)}-${id.slice(-6)}`;
          }
          run(`INSERT INTO hackathons (id,slug,name,organizer,description,domain,tags,mode,city,venue,lat,lng,deadline,start_at,end_at,official_url,apply_url,prize,hue,source,approval_status,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            id, slug, ...values.slice(0, 3), values[3], values[4], values[5], values[6], values[7], values[8], values[9],
            values[10], values[11], values[12], values[13], values[14], values[15],
            Math.floor(Math.random() * 360), 'feed', 'approved', Date.now());
          result.inserted += 1;
          action = 'inserted';
        }
      } catch (error) {
        // A malformed or duplicated feed row must never abort the whole ingest.
        if (!isUniqueViolation(error)) throw error;
        result.skipped += 1;
        continue;
      }
      run('INSERT INTO ingest_log (id,url,action,created_at) VALUES (?,?,?,?)',
        uid('ing'), official, action, Date.now());
    }
  } catch (error) {
    feedCache = { at: Date.now(), result: { ...result, error: error instanceof Error ? error.message : 'Feed unavailable' } };
    return feedCache.result;
  }
  feedCache = { at: Date.now(), result };
  return result;
}

/** SQLite surfaces duplicate urls/slugs as a constraint error, not a 500. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

/** Small helper returning the number of changed rows, used by delete paths. */
function dbRun(sql: string, ...params: unknown[]): number {
  return Number(db().prepare(sql).run(...(params as never[])).changes);
}
