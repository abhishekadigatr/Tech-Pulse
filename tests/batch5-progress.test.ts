import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directionsUrl, placeSearchUrl } from '../src/lib/map-links.ts';
import { deadlineRangeSchema } from '../src/server/schemas.ts';
const cwd = process.cwd(); const temp = mkdtempSync(join(tmpdir(), 'tp-range-')); process.chdir(temp);
const { db, run } = await import('../src/server/db.ts');
const { listHackathons } = await import('../src/server/repo.ts');
after(() => { db().close(); process.chdir(cwd); rmSync(temp, { recursive: true, force: true }); });

test('map links encode locations, use fixed Google HTTPS endpoints and reject invalid values', () => {
  const url = new URL(directionsUrl({ origin: 'Mysuru & Co', destination: 'Hall #2', waypoints: ['Stop 1', 'Stop 2'], travelmode: 'driving' }));
  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.searchParams.get('origin'), 'Mysuru & Co');
  assert.equal(url.searchParams.get('destination'), 'Hall #2');
  assert.equal(url.searchParams.get('waypoints'), 'Stop 1|Stop 2');
  assert.equal(new URL(placeSearchUrl('A & B')).searchParams.get('query'), 'A & B');
  assert.throws(() => directionsUrl({ origin: '', destination: 'A' }));
  assert.throws(() => directionsUrl({ origin: 'A', destination: 'B', waypoints: ['a|b'] }));
  assert.throws(() => directionsUrl({ origin: 'A', destination: 'B', waypoints: Array(6).fill('x') }));
});

test('deadline dates validate calendar values and ordered bounds', () => {
  assert.equal(deadlineRangeSchema.safeParse({ from: '2024-02-29', to: '2024-03-01' }).success, true);
  for (const input of [{ from: '2023-02-29' }, { to: '2024-13-01' }, { from: '2024-02-02', to: '2024-02-01' }, { from: '' }, { extra: 'x' }]) assert.equal(deadlineRangeSchema.safeParse(input).success, false);
});

test('deadline filters are inclusive at the start and exclusive at the end, and old venues remain available', () => {
  run("UPDATE hackathons SET approval_status='rejected'");
  run(`INSERT INTO hackathons (id,slug,name,organizer,description,domain,tags,mode,city,venue,deadline,start_at,end_at,official_url,apply_url,prize,hue,source,approval_status,created_at)
       VALUES ('range','range','Range','Org','Description','tech','[]','offline','City','Old venue',?,?,?,'https://example.com','https://example.com','',1,'manual','approved',?)`, 1000, 2000, 3000, 1);
  assert.equal(listHackathons({ deadlineFrom: 1000, deadlineTo: 1001 }).total, 1);
  assert.equal(listHackathons({ deadlineFrom: 1001 }).total, 0);
  assert.equal(listHackathons({ deadlineTo: 1000 }).total, 0);
  const row = listHackathons({ q: 'Range' }).items[0];
  assert.equal(row.venueName, 'Old venue'); assert.equal(row.address, '');
});
