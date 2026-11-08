import { all, get, run, uid } from './db.ts';
import { publicUserById } from './repo.ts';
import type { CipherMessage } from '@/lib/types';

interface HubLike {
  broadcast(userId: string, type: string, payload: Record<string, unknown>): void;
  broadcastAll(type: string, payload: Record<string, unknown>): void;
}

/** Read the hub from the process global without importing ws-hub (avoids a cycle). */
const hub = (): HubLike | null => (globalThis as { __techPulseHub?: HubLike }).__techPulseHub ?? null;

const VALID = /^[A-Za-z0-9+/=_-]+$/;

/** Single write path for encrypted messages, shared by WebSocket and REST. */
export function storeCipherMessage(
  conversationId: string, senderId: string, ciphertext: unknown, nonce: unknown,
): CipherMessage | null {
  if (typeof ciphertext !== 'string' || typeof nonce !== 'string' ||
      ciphertext.length < 2 || ciphertext.length > 16_384 || nonce.length < 2 || nonce.length > 64 ||
      !VALID.test(ciphertext) || !VALID.test(nonce)) return null;
  if (!get('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?', conversationId, senderId)) return null;
  const keyVersion = get<{ key_version: number }>('SELECT key_version FROM conversations WHERE id=?', conversationId)?.key_version ?? 1;
  const id = uid('msg');
  const createdAt = Date.now();
  run(`INSERT INTO messages (id,conversation_id,sender_id,ciphertext,nonce,key_version,created_at)
       VALUES (?,?,?,?,?,?,?)`, id, conversationId, senderId, ciphertext, nonce, keyVersion, createdAt);
  const message: CipherMessage = {
    id, conversationId, senderId, senderName: publicUserById(senderId).name,
    ciphertext, nonce, keyVersion, createdAt,
  };
  const members = all<{ user_id: string }>('SELECT user_id FROM conversation_members WHERE conversation_id=?', conversationId)
    .map((r) => r.user_id);
  const h = hub();
  for (const memberId of members) {
    h?.broadcast(memberId, 'message:new', { message });
    if (memberId !== senderId) h?.broadcast(memberId, 'conversation:update', { conversationId, unreadHint: true });
  }
  return message;
}
