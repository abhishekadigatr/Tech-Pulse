import type { DatabaseSync } from 'node:sqlite';
import { db } from './db.ts';

export interface RateStore { hit(key: string, limit: number, windowMs: number, now: number): number }
export class RateLimitError extends Error {
  constructor(public retryAfter: number) { super('Too many requests. Please slow down.'); }
}
export class MemoryRateStore implements RateStore {
  private buckets = new Map<string, { count: number; expires: number }>();
  hit(key: string, limit: number, windowMs: number, now: number): number {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.expires <= now) bucket = { count: 0, expires: now + windowMs };
    bucket.count++;
    this.buckets.set(key, bucket);
    if (this.buckets.size > 5000) for (const [k, v] of this.buckets) if (v.expires <= now) this.buckets.delete(k);
    return bucket.count > limit ? Math.max(1, Math.ceil((bucket.expires - now) / 1000)) : 0;
  }
}
export class SqliteRateStore implements RateStore {
  constructor(private readonly database: DatabaseSync) {
    database.exec('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
  }
  hit(key: string, limit: number, windowMs: number, now: number): number {
    const row = this.database.prepare(`INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count,expires_at`)
      .get(key, now + windowMs, now, now) as { count: number; expires_at: number };
    return row.count > limit ? Math.max(1, Math.ceil((row.expires_at - now) / 1000)) : 0;
  }
}
let store: RateStore | undefined;
export function rateLimit(key: string, limit: number, windowMs: number): void {
  store ??= process.env.RATE_LIMIT_STORE === 'sqlite' ? new SqliteRateStore(db()) : new MemoryRateStore();
  const retry = store.hit(key, limit, windowMs, Date.now());
  if (retry) throw new RateLimitError(retry);
}

/** Separate, user-scoped budgets; anonymous requests use the server's IP hash. */
export function routeRatePolicy(method: string, path: string): { name: string; max: number; windowMs: number } | null {
  if (method === 'POST' && path === '/auth/reset-password') return { name: 'reset', max: 10, windowMs: 900_000 };
  if (method === 'POST' && path === '/auth/refresh') return { name: 'refresh', max: 30, windowMs: 60_000 };
  if (method === 'POST' && path === '/auth/ws-ticket') return { name: 'ticket', max: 30, windowMs: 60_000 };
  if (method === 'GET' && path === '/users/me/export') return { name: 'export', max: 5, windowMs: 3_600_000 };
  if (method === 'DELETE' && path === '/users/me') return { name: 'delete-account', max: 5, windowMs: 3_600_000 };
  if (path === '/trips' || path.startsWith('/trips/')) return { name: 'journey', max: 90, windowMs: 60_000 };
  if (method === 'GET' && /^\/hackathons\/[^/]+\/apply-link$/.test(path)) return { name: 'apply', max: 60, windowMs: 60_000 };
  return null;
}
