'use client';

/**
 * Browser-side cryptography. No private key ever leaves the browser.
 *  • Vault: PBKDF2-SHA256 (210k) → AES-256-GCM for the private data layer.
 *  • Chat:  P-256 ECDH → HKDF-SHA256 → AES-256-GCM conversation key,
 *           wrapped individually for every member's public device key.
 * The server only ever stores ciphertext, nonces and public/wrapped keys.
 */
import { api } from './api-client';
import { b64, unb64, randomIv, derivePassphraseKey, encryptText, decryptText, hkdfKey } from './crypto';
export { b64, unb64 } from './crypto';

const enc = new TextEncoder();
/** Copy into an ArrayBuffer-backed view (TS 5.9 BufferSource strictness). */
const ab = (u: Uint8Array): Uint8Array<ArrayBuffer> => { const copy = new Uint8Array(u.length); copy.set(u); return copy; };
const toBytes = (s: string): Uint8Array<ArrayBuffer> => ab(enc.encode(s));
const dec = new TextDecoder();
const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

/* ── IndexedDB: CryptoKey objects are structured-cloneable and non-extractable ── */
const DB_NAME = 'tech-pulse-crypto-v1';
const STORE = 'keys';
const memory = new Map<string, unknown>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* in-memory fallback for restricted browsers */ }
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const db = await openDb();
    const value = await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (value) memory.set(key, value);
    return value;
  } catch { return memory.get(key) as T | undefined; }
}

/* ── Private vault (client-side layer of the 2-step encryption) ─────────── */
export const newVaultSalt = (): string => b64(globalThis.crypto.getRandomValues(new Uint8Array(16)));

export const deriveVaultKey = derivePassphraseKey;

let vaultKeyMemory: CryptoKey | null = null;
export const setVaultKey = (key: CryptoKey | null): void => { vaultKeyMemory = key; };
export const getVaultKey = (): CryptoKey | null => vaultKeyMemory;

export async function encryptVault(key: CryptoKey, value: unknown): Promise<string> {
  const iv = randomIv();
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, toBytes(JSON.stringify(value)));
  return b64(new Uint8Array([...iv, ...new Uint8Array(ct)]));
}

export async function decryptVault<T>(key: CryptoKey, blob: string): Promise<T> {
  const bytes = unb64(blob);
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: ab(bytes.slice(0, 12)) }, key, ab(bytes.slice(12)));
  return JSON.parse(dec.decode(plain)) as T;
}

/* ── Device identity ────────────────────────────────────────────────────── */
export interface DeviceIdentity {
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
}

export async function ensureDevice(): Promise<DeviceIdentity> {
  const existing = await idbGet<DeviceIdentity>('device');
  if (existing?.privateKey && existing?.publicJwk) return existing;
  const pair = (await subtle().generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  )) as CryptoKeyPair;
  const publicJwk = await subtle().exportKey('jwk', pair.publicKey);
  const privateJwk = await subtle().exportKey('jwk', pair.privateKey);
  // Re-import as non-extractable: the private half can never be exported again.
  const privateKey = await subtle().importKey(
    'jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
  );
  const identity: DeviceIdentity = { privateKey, publicJwk };
  await idbSet('device', identity);
  return identity;
}

let deviceRegistered = false;
export async function registerDevice(): Promise<void> {
  if (deviceRegistered) return;
  const device = await ensureDevice();
  await api('/users/me/devices', { method: 'POST', body: { publicJwk: device.publicJwk, label: 'This browser' } });
  deviceRegistered = true;
}

/* ── Conversation keys ──────────────────────────────────────────────────── */
const HKDF_INFO = toBytes('tech-pulse:conversation-key:v1');
const HKDF_SALT = toBytes('tech-pulse:e2ee:v1');

async function kekFor(privateKey: CryptoKey, publicJwk: JsonWebKey): Promise<CryptoKey> {
  const publicKey = await subtle().importKey('jwk', publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  return hkdfKey(new Uint8Array(bits), HKDF_SALT, HKDF_INFO);
}

interface WrappedPayload { iv: string; ct: string; wrapper: JsonWebKey }

async function wrapKey(privateKey: CryptoKey, wrapperPublic: JsonWebKey, memberPublic: JsonWebKey, groupJwk: JsonWebKey): Promise<string> {
  const kek = await kekFor(privateKey, memberPublic);
  const iv = randomIv();
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, kek, toBytes(JSON.stringify(groupJwk)));
  return b64(toBytes(JSON.stringify({ iv: b64(iv), ct: b64(ct), wrapper: wrapperPublic } satisfies WrappedPayload)));
}

export interface ConversationKeyInfo {
  keyVersion: number;
  myWrappedKey: string;
  members: Array<{ userId: string; publicJwk: JsonWebKey | null }>;
  ready: boolean;
  initialized: boolean;
}

export interface ConversationKey {
  key: CryptoKey;
  version: number;
}

export async function establishConversationKey(conversationId: string): Promise<ConversationKey> {
  await registerDevice();
  const device = await ensureDevice();
  let info = await api<ConversationKeyInfo>(`/conversations/${encodeURIComponent(conversationId)}/keys`);

  if (info.myWrappedKey) {
    try {
      const wrapped = JSON.parse(dec.decode(unb64(info.myWrappedKey))) as WrappedPayload;
      const kek = await kekFor(device.privateKey, wrapped.wrapper);
      const plain = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(wrapped.iv) }, kek, unb64(wrapped.ct));
      const jwk = JSON.parse(dec.decode(plain)) as JsonWebKey;
      const key = await subtle().importKey('jwk', jwk, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      return { key, version: info.keyVersion };
    } catch { /* stale/rotated wrapped key: rotate and re-initialise below */ }
    await api(`/conversations/${encodeURIComponent(conversationId)}/rotate-key`, { method: 'POST' });
    info = await api<ConversationKeyInfo>(`/conversations/${encodeURIComponent(conversationId)}/keys`);
  } else if (info.initialized) {
    // New member with no key for an already-initialised conversation → rotate.
    await api(`/conversations/${encodeURIComponent(conversationId)}/rotate-key`, { method: 'POST' });
    info = await api<ConversationKeyInfo>(`/conversations/${encodeURIComponent(conversationId)}/keys`);
  }

  const groupKey = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const groupJwk = await subtle().exportKey('jwk', groupKey);
  const wrapped: Array<{ userId: string; wrappedKey: string }> = [];
  for (const member of info.members) {
    if (!member.publicJwk) continue;
    try {
      wrapped.push({
        userId: member.userId,
        wrappedKey: await wrapKey(device.privateKey, device.publicJwk, member.publicJwk, groupJwk),
      });
    } catch { /* skip devices with incompatible keys */ }
  }
  if (!wrapped.length) throw new Error('No compatible device keys are available yet. Ask your teammate to open chat once.');
  await api(`/conversations/${encodeURIComponent(conversationId)}/keys`, {
    method: 'POST', body: { keyVersion: info.keyVersion, wrapped },
  });
  return { key: groupKey, version: info.keyVersion };
}

export async function encryptMessage(key: CryptoKey, plaintext: string): Promise<{ ciphertext: string; nonce: string }> {
  const result = await encryptText(key, plaintext);
  return { ciphertext: result.ciphertext, nonce: result.iv };
}

export async function decryptMessage(key: CryptoKey, ciphertext: string, nonce: string): Promise<string> {
  return decryptText(key, { ciphertext, iv: nonce });
}

export function exportPublicKeyLabel(jwk: JsonWebKey): string {
  return `${String(jwk.x ?? '').slice(0, 8)}…`;
}
