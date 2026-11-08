/** Browser/Node WebCrypto primitives; never log plaintext or key material. */
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export function bytes(value: Uint8Array): Uint8Array<ArrayBuffer> { return new Uint8Array(value); }
export function b64(value: ArrayBuffer | Uint8Array): string {
  const a = value instanceof Uint8Array ? value : new Uint8Array(value);
  let raw = ''; for (const byte of a) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('Invalid base64url');
  const s = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export const randomIv = (): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(12));
export const randomSalt = (): string => b64(crypto.getRandomValues(new Uint8Array(16)));
export async function derivePassphraseKey(passphrase: string, salt: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(salt), iterations: 210_000, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function hkdfKey(secret: Uint8Array, salt: Uint8Array, info: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', bytes(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bytes(salt), info: bytes(info) }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptText(key: CryptoKey, text: string): Promise<{ iv: string; ciphertext: string }> {
  const iv = randomIv();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text));
  return { iv: b64(iv), ciphertext: b64(ciphertext) };
}
export async function decryptText(key: CryptoKey, value: { iv: string; ciphertext: string }): Promise<string> {
  const iv = unb64(value.iv);
  if (iv.length !== 12) throw new Error('Invalid IV');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, unb64(value.ciphertext));
  return decoder.decode(plaintext);
}
export interface WrappedNotesKey { salt: string; iv: string; ciphertext: string; version: number }
export async function createWrappedNotesKey(passphrase: string): Promise<{ key: CryptoKey; wrapped: WrappedNotesKey }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const salt = randomSalt(); const wrappingKey = await derivePassphraseKey(passphrase, salt);
  const encrypted = await encryptText(wrappingKey, b64(raw));
  raw.fill(0);
  return { key, wrapped: { salt, ...encrypted, version: 1 } };
}
export async function unwrapNotesKey(passphrase: string, wrapped: WrappedNotesKey): Promise<CryptoKey> {
  if (wrapped.version !== 1) throw new Error('Unsupported notes key version');
  const wrappingKey = await derivePassphraseKey(passphrase, wrapped.salt);
  const raw = unb64(await decryptText(wrappingKey, wrapped));
  if (raw.length !== 32) throw new Error('Invalid notes key');
  try { return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
  finally { raw.fill(0); }
}
export async function encryptNote(key: CryptoKey, plaintext: string): Promise<string> {
  if (!plaintext) return '';
  const encrypted = await encryptText(key, plaintext);
  return `enc1.${encrypted.iv}.${encrypted.ciphertext}`;
}
export async function decryptNote(key: CryptoKey, blob: string): Promise<string> {
  const [version, iv, ciphertext, extra] = blob.split('.');
  if (version !== 'enc1' || !iv || !ciphertext || extra !== undefined) throw new Error('Invalid encrypted note');
  return decryptText(key, { iv, ciphertext });
}
