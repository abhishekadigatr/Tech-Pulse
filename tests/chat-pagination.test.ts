import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const cwd = process.cwd(); const temp = mkdtempSync(join(tmpdir(), 'tp-chat-')); process.chdir(temp);
const { db, run } = await import('../src/server/db.ts');
const { messagesFor, markConversationRead, conversationById } = await import('../src/server/features.ts');
for (const user of ['a', 'b', 'outsider']) run('INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)', user, `${user}@test.invalid`, user, 'unused', 1);
run('INSERT INTO conversations (id,kind,title,key_version,created_at) VALUES (?,?,?,?,?)', 'chat', 'dm', 'Chat', 1, 1);
for (const user of ['a', 'b']) run('INSERT INTO conversation_members VALUES (?,?,?,?)', 'chat', user, '', 0);
for (const id of ['m1', 'm2', 'm3', 'm4', 'm5']) run('INSERT INTO messages (id,conversation_id,sender_id,ciphertext,nonce,key_version,created_at) VALUES (?,?,?,?,?,?,?)', id, 'chat', 'a', 'abc', 'abc', 1, 100);
after(() => { db().close(); process.chdir(cwd); rmSync(temp, { recursive: true, force: true }); });

test('older-message cursor preserves messages with equal timestamps and checks membership', () => {
  const page1 = messagesFor('chat', 'a', undefined, 2);
  const page2 = messagesFor('chat', 'a', page1.nextCursor!, 2);
  const page3 = messagesFor('chat', 'a', page2.nextCursor!, 2);
  assert.deepEqual([...page1.items, ...page2.items, ...page3.items].map((m) => m.id).sort(), ['m1', 'm2', 'm3', 'm4', 'm5']);
  assert.equal(page3.nextCursor, null);
  assert.equal(messagesFor('chat', 'outsider').items.length, 0);
});

test('read receipts update member timestamp and notify only conversation members', () => {
  const global = globalThis as unknown as { __techPulseHub?: unknown };
  const sent: string[] = [];
  global.__techPulseHub = { broadcast: (user: string) => sent.push(user), conversationOnline: () => 0 };
  try {
    assert.equal(markConversationRead('chat', 'outsider'), false);
    assert.equal(markConversationRead('chat', 'b'), true);
    assert.deepEqual(sent.sort(), ['a', 'b']);
    assert.ok(conversationById('chat', 'a')!.readBy!.b > 0);
  } finally { delete global.__techPulseHub; }
});
