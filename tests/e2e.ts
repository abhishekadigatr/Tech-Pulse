/**
 * End-to-end smoke test against a running server (`npm run dev` first).
 * Exercises the real flow: register → verify → login → apply → inbox →
 * calendar → teams → trip → encrypted chat → security checks.
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const API = `${BASE}/api/v1`;

let cookies: Record<string, string> = {};
let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failures += 1; }
}

async function call<T = Record<string, unknown>>(path: string, options: {
  method?: string; body?: unknown; csrf?: boolean;
} = {}): Promise<{ status: number; data: T; headers: Headers }> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: BASE };
  if (options.csrf !== false && method !== 'GET') headers['x-csrf-token'] = cookies.tp_csrf ?? '';
  if (Object.keys(cookies).length) headers.cookie = cookieHeader();
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    credentials: 'include' as const,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual',
  });
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    const key = pair.slice(0, idx).trim();
    const value = decodeURIComponent(pair.slice(idx + 1).trim());
    if (value) cookies[key] = value; else delete cookies[key];
  }
  let data: T = {} as T;
  try { data = (await response.json()) as T; } catch { /* redirect / non-json */ }
  return { status: response.status, data, headers: response.headers };
}

const cookieHeader = (): string => Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');

async function main(): Promise<void> {
  console.log(`\nTech Pulse E2E → ${BASE}\n`);
  const health = await call('/health');
  check('health endpoint', health.status === 200 && (health.data as { status?: string }).status === 'ok');

  const list = await call<{ items: Array<{ id: string; slug: string; officialUrl: string }>; total: number }>('/hackathons?pageSize=5');
  check('hackathon catalogue is seeded', list.status === 200 && list.data.items.length > 0);
  const first = list.data.items[0];
  check('listing URLs are HTTPS', Boolean(first?.officialUrl.startsWith('https://')));

  const badCsrf = await call('/applications', { method: 'POST', body: { hackathonId: first?.id }, csrf: false });
  check('write without CSRF is rejected', badCsrf.status === 401 || badCsrf.status === 403);

  const email = `e2e-${Date.now()}@techpulse.dev`;
  const password = 'E2eStrong!2026';
  const registered = await call<{ devCode?: string }>('/auth/register', {
    method: 'POST', body: { name: 'E2E Runner', email, password, skills: ['TypeScript'] }, csrf: false,
  });
  check('registration succeeds', registered.status === 201);
  const verifyCode = registered.data.devCode;
  if (verifyCode) {
    const verified = await call('/auth/verify-email', { method: 'POST', body: { email, code: verifyCode }, csrf: false });
    check('email verification succeeds', verified.status === 200);
  } else check('email verification skipped (production mode)', true);

  const login = await call<{ me?: { id: string } }>('/auth/login', { method: 'POST', body: { email, password }, csrf: false });
  check('login issues session cookies', login.status === 200 && Boolean(cookies.tp_session && cookies.tp_csrf));
  const me = await call<{ me: { id: string; email: string } }>('/auth/me');
  check('authenticated profile loads', me.status === 200 && me.data.me?.email === email);

  const applied = await call<{ application?: { id: string } }>('/applications', {
    method: 'POST', body: { hackathonId: first?.id, status: 'applied', notes: 'E2E private note' },
  });
  check('application is tracked', applied.status === 201 || applied.status === 200);
  const apps = await call<{ items: Array<{ notes: string }> }>('/applications');
  check('encrypted note round-trips', apps.data.items.some((a) => a.notes === 'E2E private note'));

  const cal = await call<{ event?: { id: string } }>('/calendar', {
    method: 'POST', body: { title: 'E2E study block', type: 'study', startsAt: Date.now() + 86_400_000, endsAt: Date.now() + 88_200_000, notes: 'Revise system design', remindOffsets: [1440, 120] },
  });
  check('calendar event created', cal.status === 201);
  const events = await call<{ items: Array<{ notes: string }> }>('/calendar');
  check('calendar note decrypts', events.data.items.some((e) => e.notes === 'Revise system design'));

  const inbox = await call<{ items: unknown[] }>('/inbox');
  check('unified inbox has entries', inbox.status === 200 && inbox.data.items.length > 0);

  const teams = await call<{ items: Array<{ id: string }> }>('/teams');
  check('team listings are available', teams.status === 200 && teams.data.items.length > 0);

  const trip = await call<{ trip?: { id: string; suggestions: unknown[]; route: unknown[] } }>('/trips', {
    method: 'POST', body: { hackathonId: first?.id, origin: 'Mysuru', mode: 'car' },
  });
  check('journey route built', trip.status === 201 && (trip.data.trip?.route.length ?? 0) > 1);
  check('journey suggestions ranked', (trip.data.trip?.suggestions.length ?? 0) > 0);

  const conv = await call<{ conversation?: { id: string } }>('/conversations', {
    method: 'POST', body: { otherUserId: 'usr_meera' },
  });
  check('conversation created', conv.status === 201);
  const keys = await call<{ keyVersion: number; members: unknown[] }>(`/conversations/${conv.data.conversation?.id}/keys`);
  check('key distribution endpoint accessible', keys.status === 200 && Array.isArray(keys.data.members));
  const cipher = await call(`/conversations/${conv.data.conversation?.id}/messages`, {
    method: 'POST', body: { ciphertext: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo', nonce: 'YWJjZGVmZ2hpamts' },
  });
  check('server stores ciphertext without needing a key', cipher.status === 201);
  const messages = await call<{ items: Array<{ ciphertext: string }> }>(`/conversations/${conv.data.conversation?.id}/messages`);
  check('ciphertext retrievable via cursor pagination', messages.data.items.some((m) => m.ciphertext.startsWith('QUJD')));

  const ticket = await call<{ ticket: string }>('/auth/ws-ticket', { method: 'POST' });
  check('one-time WebSocket ticket issued', ticket.status === 200 && ticket.data.ticket.length > 10);

  const admin = await call('/admin/stats');
  check('admin endpoints refuse non-admin sessions', admin.status === 403);

  const redirect = await fetch(`${API}/hackathons/${first?.id}/apply-link`, { redirect: 'manual', headers: { cookie: cookieHeader() } });
  check('apply link redirects to HTTPS', redirect.status === 302 && (redirect.headers.get('location') ?? '').startsWith('https://'));

  const logout = await call('/auth/logout', { method: 'POST' });
  check('logout revokes session', logout.status === 200);
  const afterLogout = await call('/applications');
  check('protected data is inaccessible after logout', afterLogout.status === 401);

  console.log(`\n${failures === 0 ? '✓ All E2E checks passed' : `✗ ${failures} check(s) failed`}\n`);
  if (failures) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
