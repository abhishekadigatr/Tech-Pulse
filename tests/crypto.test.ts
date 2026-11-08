import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  base32Decode, base32Encode, constantTimeEqual, deriveUserKey, hashPassword,
  open, otpauthUrl, randomToken, seal, sealForUser, openForUser, sha256,
  signPayload, totpAt, verifyPassword, verifyTotp, verifyPayload, recoveryCodes,
} from '../src/server/crypto.ts';

test('AES-256-GCM envelope round-trips and detects tampering', () => {
  const key = deriveUserKey('user-a');
  const blob = seal('sensitive calendar note', key);
  assert.equal(open(blob, key), 'sensitive calendar note');
  assert.match(blob, /^v1\./);
  const parts = blob.split('.');
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => open(parts.join('.'), key));
});

test('per-user HKDF keys isolate encrypted data', () => {
  const blob = sealForUser('alice', 'alice only');
  assert.equal(openForUser('alice', blob), 'alice only');
  assert.throws(() => openForUser('bob', blob));
  assert.notEqual(deriveUserKey('alice').toString('hex'), deriveUserKey('bob').toString('hex'));
});

test('Argon2id verifies the right password only', async () => {
  const hash = await hashPassword('CorrectHorse!2026');
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword('CorrectHorse!2026', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
});

test('TOTP uses RFC 6238 test vector and tolerates one step of drift', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totpAt(secret, 1), '94287082'.slice(2)); // 8-digit vector truncated to 6
  const now = 1_800_000_000_000; // fixed instant
  const step = Math.floor(now / 30_000);
  assert.equal(verifyTotp(secret, totpAt(secret, step), now), true);
  assert.equal(verifyTotp(secret, totpAt(secret, step - 1), now), true);
  assert.equal(verifyTotp(secret, totpAt(secret, step + 1), now), true);
  assert.equal(verifyTotp(secret, totpAt(secret, step + 4), now), false);
  assert.equal(verifyTotp(secret, '12345', now), false);
});

test('base32 and URL generation are stable', () => {
  const raw = Buffer.from('Tech Pulse secret bytes');
  assert.deepEqual(base32Decode(base32Encode(raw)), raw);
  assert.match(otpauthUrl('JBSWY3DPEHPK3PXP', 'a@b.dev'), /^otpauth:\/\/totp\//);
  assert.equal(recoveryCodes(4).length, 4);
});

test('signed payloads reject tampering and expiry', () => {
  const token = signPayload({ uid: 'usr_1', purpose: 'login' }, 60);
  const payload = verifyPayload<{ uid: string; purpose: string }>(token);
  assert.equal(payload?.uid, 'usr_1');
  assert.equal(verifyPayload(token + 'x'), null);
  assert.equal(verifyPayload(signPayload({ uid: 'x' }, -1)), null);
  assert.equal(constantTimeEqual(sha256('a'), sha256('a')), true);
  assert.equal(constantTimeEqual(sha256('a'), sha256('b')), false);
  assert.notEqual(randomToken(), randomToken());
});
