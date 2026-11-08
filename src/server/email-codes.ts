import { createHmac, randomInt } from 'node:crypto';
import { db, get, run } from './db.ts';
import { constantTimeEqual, signing } from './crypto.ts';
import { sendCode } from './mail.ts';

export type CodeKind = 'verify' | 'reset';
const TTL = 15 * 60_000;
const COOLDOWN = 60_000;
const MAX_ATTEMPTS = 5;
function init(): void {
  db().exec(`CREATE TABLE IF NOT EXISTS email_codes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
    sent_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,kind)
  )`);
}
const digest = (userId: string, kind: CodeKind, code: string) => createHmac('sha256', signing()).update(`${kind}:${userId}:${code}`).digest('hex');

/** Reserve a code before sending. Failed delivery invalidates only that reservation. */
export async function issueEmailCode(userId: string, email: string, kind: CodeKind, now = Date.now()): Promise<string | null> {
  init();
  const code = String(randomInt(100_000, 1_000_000));
  const hash = digest(userId, kind, code);
  const result = db().prepare(`INSERT INTO email_codes (user_id,kind,code_hash,expires_at,sent_at,attempts) VALUES (?,?,?,?,?,0)
    ON CONFLICT(user_id,kind) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0
    WHERE email_codes.sent_at<=?`).run(userId, kind, hash, now + TTL, now, now - COOLDOWN);
  if (!result.changes) return null;
  try { await sendCode(email, code, kind); }
  catch (error) {
    run('DELETE FROM email_codes WHERE user_id=? AND kind=? AND code_hash=?', userId, kind, hash);
    throw error;
  }
  return code;
}

/** Consume atomically so a code cannot be replayed; wrong attempts persist. */
export function consumeEmailCode(userId: string, kind: CodeKind, code: string, now = Date.now()): boolean {
  init();
  const connection = db();
  connection.exec('BEGIN IMMEDIATE');
  try {
    const row = get<{ code_hash: string; expires_at: number; attempts: number }>(
      'SELECT code_hash,expires_at,attempts FROM email_codes WHERE user_id=? AND kind=?', userId, kind);
    if (!row || row.expires_at <= now || row.attempts >= MAX_ATTEMPTS) { connection.exec('COMMIT'); return false; }
    const valid = constantTimeEqual(row.code_hash, digest(userId, kind, code));
    if (valid) run('DELETE FROM email_codes WHERE user_id=? AND kind=?', userId, kind);
    else run('UPDATE email_codes SET attempts=attempts+1 WHERE user_id=? AND kind=?', userId, kind);
    connection.exec('COMMIT');
    return valid;
  } catch (error) { connection.exec('ROLLBACK'); throw error; }
}
