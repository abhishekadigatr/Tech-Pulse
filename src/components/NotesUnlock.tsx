'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { createWrappedNotesKey, decryptNote, unwrapNotesKey, type WrappedNotesKey } from '@/lib/crypto';
import { Button, Field, Input } from '@/components/ui';

export function useNotesKey(userId?: string) {
  const [stored, setStored] = useState<{ userId: string; wrapped: WrappedNotesKey | null; error: string | null } | null>(null);
  const [unlocked, setUnlocked] = useState<{ userId: string; key: CryptoKey } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => { setUnlocked(null); }, [userId]);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void api<{ wrapped: WrappedNotesKey | null }>('/users/me/notes-key')
      .then(({ wrapped }) => { if (!cancelled) setStored({ userId, wrapped, error: null }); })
      .catch(() => { if (!cancelled) setStored({ userId, wrapped: null, error: 'Could not load notes key' }); });
    return () => { cancelled = true; };
  }, [userId, revision]);
  const active = stored?.userId === userId ? stored : null;
  const key = unlocked && unlocked.userId === userId ? unlocked.key : null;
  const unlock = async (passphrase: string, confirmation: string) => {
    if (!userId || !active || active.error) throw new Error('Notes key is not available');
    if (active.wrapped) setUnlocked({ userId, key: await unwrapNotesKey(passphrase, active.wrapped) });
    else {
      if (passphrase.length < 10) throw new Error('Use a notes passphrase of at least 10 characters');
      if (passphrase !== confirmation) throw new Error('Passphrases do not match');
      const created = await createWrappedNotesKey(passphrase);
      try { await api('/users/me/notes-key', { method: 'POST', body: created.wrapped }); }
      catch (error) { setStored(null); setRevision((value) => value + 1); throw error; }
      setStored({ userId, wrapped: created.wrapped, error: null });
      setUnlocked({ userId, key: created.key });
    }
  };
  return { key, unlock, lock: () => setUnlocked(null), exists: Boolean(active?.wrapped), loading: !active, error: active?.error, enabled: Boolean(userId) };
}
export type NotesKeyState = ReturnType<typeof useNotesKey>;
export function NotesUnlock({ state }: { state: NotesKeyState }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!state.enabled) return null;
  if (state.key) return <div className="rounded-xl border border-cyan/20 p-3 text-xs text-slate-300">Notes unlocked in this page. <button className="text-cyan underline" onClick={state.lock}>Lock</button></div>;
  return <div className="space-y-3 rounded-xl border border-violet/20 p-4 text-xs text-slate-300">
    <p>{state.exists ? 'Unlock your encrypted notes with your notes passphrase.' : 'Create a separate notes passphrase. If lost, encrypted notes cannot be recovered.'}</p>
    {state.error ? <p role="alert">Could not load the notes key. Reload and try again.</p> : <>
      <Field label="Notes passphrase"><Input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      {!state.exists && <Field label="Confirm notes passphrase"><Input type="password" autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></Field>}
      <Button size="sm" loading={busy || state.loading} onClick={async () => { setBusy(true); setError(''); try { await state.unlock(password, confirmation); setPassword(''); setConfirmation(''); } catch { setError('Could not unlock or create the notes key. Check your passphrase and try again.'); } finally { setBusy(false); } }}>{state.exists ? 'Unlock notes' : 'Create notes key'}</Button>
      {error && <p role="alert" className="text-rose">{error}</p>}
    </>}
  </div>;
}

type NoteItem = { id: string; notes: string; notesFormat?: 'client' | 'legacy' | 'empty' | 'unreadable' };
export type ReadableNote = { text: string; locked: boolean; failed: boolean; legacy: boolean };
export function useReadableNotes(items: NoteItem[] | undefined, key: CryptoKey | null): Record<string, ReadableNote> {
  const [decoded, setDecoded] = useState<Record<string, ReadableNote>>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all((items ?? []).map(async (item): Promise<[string, ReadableNote]> => {
      if (item.notesFormat === 'unreadable') return [item.id, { text: '', locked: false, failed: true, legacy: true }];
      if (item.notesFormat !== 'client') return [item.id, { text: item.notes, locked: false, failed: false, legacy: item.notesFormat === 'legacy' && Boolean(item.notes) }];
      if (!key) return [item.id, { text: '', locked: true, failed: false, legacy: false }];
      try { return [item.id, { text: await decryptNote(key, item.notes), locked: false, failed: false, legacy: false }]; }
      catch { return [item.id, { text: '', locked: false, failed: true, legacy: false }]; }
    })).then((entries) => { if (!cancelled) setDecoded(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [items, key]);
  return decoded;
}
