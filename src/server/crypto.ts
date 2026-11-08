import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { argon2id, argon2Verify } from 'hash-wasm';

/* ────────────────────────────────────────────────────────────────────────────
 * Keys. In production both keys MUST be provided as 32-byte hex secrets from a
 * KMS/secret manager. In development we derive and persist one local key so a
 * restart does not invalidate the encrypted database (never committed).
 * ──────────────────────────────────────────────────────────────────────────── */
const DATA_DIR = path.join(process.cwd(), '.data');
let masterKey: Buffer | undefined;
let signingKey: Buffer | undefined;

function loadSecret(envName: string, fileName: string, purpose: string): Buffer {
  const raw = process.env[envName];
  if (raw) {
    const buf = Buffer.from(raw.replace(/^0x/, ''), 'hex');
    if (buf.length === 32) return buf;
    throw new Error(`${envName} must be exactly 32 bytes of hex`);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envName} is required in production`);
  }
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(DATA_DIR, fileName);
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8'), 'hex');
  const generated = randomBytes(32);
  writeFileSync(file, generated.toString('hex'), { mode: 0o600 });
  console.warn(`[security] ${purpose}: using a generated LOCAL key (${file}). Set ${envName} in production.`);
  return generated;
}

export function master(): Buffer {
  masterKey ??= loadSecret('DATA_ENCRYPTION_KEY', 'dev-master.key', 'envelope encryption');
  return masterKey;
}

export function signing(): Buffer {
  signingKey ??= loadSecret('AUTH_SIGNING_KEY', 'dev-signing.key', 'token signing');
  return signingKey;
}

/** HKDF-SHA256 context separation: every user gets a distinct data key. */
export function deriveUserKey(userId: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', master(), Buffer.from(`tp:${userId}`), 'tech-pulse:user-data:v1', 32),
  );
}

export function deriveSystemKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master(), Buffer.from(purpose), 'tech-pulse:system:v1', 32));
}

/** AES-256-GCM envelope. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function open(blob: string, key: Buffer): string {
  const [version, iv, tag, ct] = blob.split('.');
  if (version !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Invalid sealed payload');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export const sealForUser = (userId: string, plaintext: string): string => seal(plaintext, deriveUserKey(userId));
export const openForUser = (userId: string, blob: string): string => open(blob, deriveUserKey(userId));
export const sealSystem = (plaintext: string): string => seal(plaintext, deriveSystemKey('auth-secrets'));
export const openSystem = (blob: string): string => open(blob, deriveSystemKey('auth-secrets'));

/* ── Password hashing: Argon2id (m=64MiB, t=3, p=1) ─────────────────────── */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return argon2id({ password, salt, parallelism: 1, iterations: 3, memorySize: 64, hashLength: 32, outputType: 'encoded' });
}

export function verifyPassword(password: string, encoded: string): Promise<boolean> {
  return argon2Verify({ password, hash: encoded });
}

/* ── Tokens ─────────────────────────────────────────────────────────────── */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Short-lived, HMAC-signed, self-contained token (MFA challenge, WS ticket). */
export function signPayload(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${createHmac('sha256', signing()).update(body).digest('base64url')}`;
}

export function verifyPayload<T extends Record<string, unknown>>(token: string): (T & { exp: number }) | null {
  try {
    const [body, sig, extra] = token.split('.');
    if (!body || !sig || extra) return null;
    const expected = createHmac('sha256', signing()).update(body).digest('base64url');
    if (!constantTimeEqual(sig, expected)) return null;
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ── TOTP (RFC 6238, SHA-1, 30s step, 6 digits) ─────────────────────────── */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input.toUpperCase().replace(/=+$/, '')) {
    const idx = BASE32.indexOf(char);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = (): string => base32Encode(randomBytes(20));

export function totpAt(secret: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

export const currentTotp = (secret: string): string => totpAt(secret, Math.floor(Date.now() / 30_000));

/** Accepts ±1 step for clock drift. Constant-time comparison. */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(now / 30_000);
  return [step - 1, step, step + 1].some((s) => constantTimeEqual(totpAt(secret, s), code));
}

export function otpauthUrl(secret: string, email: string, issuer = 'Tech Pulse'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function recoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => randomBytes(5).toString('hex').toUpperCase().replace(/(.{4})/g, '$1-').slice(0, 9));
}
