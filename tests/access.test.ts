import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessDecision, apiAccessDecision, protectedApi } from '../src/lib/access.ts';
import { buildCsp, frameAncestors, frameOptions } from '../src/lib/csp.ts';

const aal1 = { totpEnabled: true, aal2: false };
const aal2 = { totpEnabled: true, aal2: true };
const noMfa = { totpEnabled: false, aal2: false };
test('page assurance policy blocks AAL1, allows AAL2 and offers enrollment', () => {
  for (const path of ['/settings', '/inbox', '/collaborate', '/calendar', '/chat/abc']) {
    assert.equal(accessDecision(path, aal1), 'step-up');
    assert.equal(accessDecision(path, aal2), 'allow');
    assert.equal(accessDecision(path, noMfa), 'enroll');
    assert.equal(accessDecision(path, null), 'login');
  }
  assert.equal(accessDecision('/settings', noMfa, true), 'allow');
  for (const path of ['/login', '/api/v1/auth/me', '/_next/static/a.js', '/settings-other']) assert.equal(accessDecision(path, aal1), 'allow');
});
test('API assurance policy covers workspace endpoints and exempts auth and unrelated routes', () => {
  for (const path of ['/users/me', '/users/me/vault', '/users/someone/public-keys', '/applications/a', '/inbox', '/calendar/ics', '/teams/a', '/team-requests', '/seekers', '/hackathons/h/teams', '/hackathons/h/seekers', '/conversations/c/messages']) {
    assert.equal(protectedApi(path), true, path);
    assert.equal(apiAccessDecision(path, aal1), 'step-up');
    assert.equal(apiAccessDecision(path, aal2), 'allow');
    assert.equal(apiAccessDecision(path, noMfa), 'enroll');
    assert.equal(apiAccessDecision(path, null), 'login');
  }
  for (const path of ['/auth/me', '/auth/2fa/confirm', '/search', '/hackathons', '/health']) assert.equal(apiAccessDecision(path, aal1), 'allow');
});
test('frame policy and X-Frame-Options agree, including custom external ancestors', () => {
  assert.match(buildCsp('nonce', true, ''), /frame-ancestors 'self'/);
  assert.equal(frameOptions(''), 'SAMEORIGIN');
  assert.equal(frameOptions("'none'"), 'DENY');
  assert.match(buildCsp('', false, "'self' https://*.e2b.app"), /frame-ancestors 'self' https:\/\/\*\.e2b\.app/);
  assert.equal(frameOptions("'self' https://*.e2b.app"), undefined);
  assert.throws(() => frameAncestors("'self'; script-src *"), /Invalid/);
});

test('middleware emits default and custom framing headers', async () => {
  const { NextRequest } = await import('next/server.js');
  const { middleware } = await import('../src/middleware.ts');
  const old = process.env.FRAME_ANCESTORS;
  try {
    delete process.env.FRAME_ANCESTORS;
    const standard = await middleware(new NextRequest('http://localhost/login'));
    assert.equal(standard.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(standard.headers.get('content-security-policy')!, /frame-ancestors 'self'/);
    process.env.FRAME_ANCESTORS = "'self' https://*.e2b.app";
    const custom = await middleware(new NextRequest('http://localhost/login'));
    assert.equal(custom.headers.get('x-frame-options'), null);
    assert.match(custom.headers.get('content-security-policy')!, /frame-ancestors 'self' https:\/\/\*\.e2b\.app/);
  } finally { if (old === undefined) delete process.env.FRAME_ANCESTORS; else process.env.FRAME_ANCESTORS = old; }
});
