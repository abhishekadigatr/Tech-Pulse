import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import {
  assertCsrf, assertSameOrigin, body, clampInt, cookieHeader, parseCookies,
  rateLimit, safeExternalUrl,
} from '../src/server/http.ts';
import { parseJson, settingsFor, toHackathon } from '../src/server/repo.ts';

const req = (url: string, init?: RequestInit): Request => new Request(url, init);

test('same-origin enforcement blocks cross-site writes', () => {
  assert.doesNotThrow(() => assertSameOrigin(req('http://localhost:3000/api/v1/applications', {
    method: 'POST', headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
  })));
  assert.throws(() => assertSameOrigin(req('http://localhost:3000/api/v1/applications', {
    method: 'POST', headers: { origin: 'https://evil.example', host: 'localhost:3000' },
  })), /Cross-origin/);
});

test('CSRF token must match exactly', () => {
  const good = req('http://localhost/x', { method: 'POST', headers: { 'x-csrf-token': 'abc123' } });
  assert.doesNotThrow(() => assertCsrf(good, 'abc123'));
  assert.throws(() => assertCsrf(req('http://localhost/x', { method: 'POST' }), 'abc123'), /CSRF/);
  assert.throws(() => assertCsrf(good, 'different'), /CSRF/);
});

test('body size cap and Zod validation reject bad input', async () => {
  const schema = z.object({ title: z.string().min(2).max(20), count: z.number().int() });
  const valid = req('http://localhost/x', { method: 'POST', body: JSON.stringify({ title: 'Hello', count: 2, evil: 'strip' }), headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await body(valid, schema), { title: 'Hello', count: 2 });
  const invalid = req('http://localhost/x', { method: 'POST', body: JSON.stringify({ title: 'H', count: 1.5 }), headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => body(invalid, schema), /Validation failed/);
  const huge = req('http://localhost/x', { method: 'POST', body: JSON.stringify({ title: 'x'.repeat(40_000) }), headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => body(huge, schema), /too large/i);
});

test('external redirect targets must be plain HTTPS URLs', () => {
  assert.equal(safeExternalUrl('https://devpost.com/hackathons')?.hostname, 'devpost.com');
  assert.equal(safeExternalUrl('http://devpost.com/hackathons'), null);
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('https://user:pw@devpost.com'), null);
  assert.equal(safeExternalUrl('https://localhost'), null);
});

test('rate limiter trips after the configured window', () => {
  const key = `test-${Date.now()}`;
  assert.doesNotThrow(() => rateLimit(key, 2, 60_000));
  assert.doesNotThrow(() => rateLimit(key, 2, 60_000));
  assert.throws(() => rateLimit(key, 2, 60_000), /Too many/);
});

test('cookie helpers and clamping', () => {
  const header = cookieHeader('tp_session', 'a b/c', { maxAge: 60, httpOnly: true, sameSite: 'Lax', secure: false });
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Max-Age=60/);
  const parsed = parseCookies(req('http://localhost/x', { headers: { cookie: header.split(';')[0] } }));
  assert.equal(parsed.tp_session, 'a b/c');
  assert.equal(clampInt('999', 1, 10, 5), 10);
  assert.equal(clampInt('abc', 1, 10, 5), 5);
  assert.deepEqual(parseJson<string[]>('not json', ['fallback']), ['fallback']);
});

test('settings and hackathon mapping provide safe defaults', () => {
  const settings = settingsFor('non-existent-user');
  assert.deepEqual(settings.reminderOffsets, [10080, 1440, 120]);
  assert.equal(settings.notifyInApp, true);
  const hackathon = toHackathon({
    id: 'hk', slug: 'hk', name: 'Test', organizer: 'Org', description: 'Desc', domain: 'AI',
    tags: '["AI"]', mode: 'online', city: 'Remote', venue: 'Online', lat: 0, lng: 0,
    deadline: Date.now() + 1000, start_at: Date.now(), end_at: Date.now(), official_url: 'https://x.dev',
    apply_url: 'https://x.dev', prize: '', hue: 190, source: 'curated', approval_status: 'approved', created_at: Date.now(),
  });
  assert.deepEqual(hackathon.tags, ['AI']);
  assert.equal(hackathon.bookmarked, false);
});
