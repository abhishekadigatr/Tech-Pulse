'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, ChevronLeft, KeyRound, LockKeyhole, Send, ShieldCheck, Users, Wifi, WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useApi } from '@/lib/api-client';
import { AuthGate } from '@/components/AppShell';
import { useAuth, useSocket, useToast } from '@/components/providers';
import {
  establishConversationKey, encryptMessage, decryptMessage, ensureDevice, registerDevice,
  type ConversationKey,
} from '@/lib/client-crypto';
import { Avatar, Badge, Button, Card, EmptyState, Input, Loading, cn } from '@/components/ui';
import { fmtTime, relative } from '@/lib/format';
import type { CipherMessage, Conversation, Paged } from '@/lib/types';

interface PlainMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: number;
  mine: boolean;
  pending?: boolean;
}

export default function ChatRoomPage() {
  return <AuthGate><ChatRoom /></AuthGate>;
}

function ChatRoom() {
  const params = useParams<{ conversationId: string }>();
  const id = params.conversationId;
  const { me } = useAuth();
  const { status, send, subscribe } = useSocket();
  const { toast } = useToast();
  const conv = useApi<{ conversation: Conversation }>(`/conversations/${encodeURIComponent(id)}`);
  const [key, setKey] = useState<ConversationKey | null>(null);
  const [messages, setMessages] = useState<PlainMessage[]>([]);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [typingFrom, setTypingFrom] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seen = useRef(new Set<string>());

  const decryptBatch = useCallback(async (cryptoKey: ConversationKey, batch: CipherMessage[]): Promise<PlainMessage[]> => {
    const out: PlainMessage[] = [];
    for (const m of batch) {
      if (seen.current.has(m.id)) continue;
      seen.current.add(m.id);
      let text: string;
      if (m.keyVersion !== cryptoKey.version) text = '🔒 Encrypted with an earlier conversation key';
      else {
        try { text = await decryptMessage(cryptoKey.key, m.ciphertext, m.nonce); }
        catch { text = '🔒 Could not decrypt on this device'; }
      }
      out.push({ id: m.id, senderId: m.senderId, senderName: m.senderName ?? 'Member', text, createdAt: m.createdAt, mine: m.senderId === me?.id });
    }
    return out;
  }, [me?.id]);

  const initialise = useCallback(async () => {
    setLoading(true);
    setSetupError(null);
    try {
      await registerDevice();
      const device = await ensureDevice();
      setDeviceLabel(String(device.publicJwk.x ?? '').slice(0, 10));
      const cryptoKey = await establishConversationKey(id);
      setKey(cryptoKey);
      const history = await api<Paged<CipherMessage>>(`/conversations/${encodeURIComponent(id)}/messages?limit=100`);
      seen.current.clear();
      setMessages(await decryptBatch(cryptoKey, history.items));
      await api(`/conversations/${encodeURIComponent(id)}/read`, { method: 'POST' }).catch(() => null);
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Could not establish encryption keys');
    } finally { setLoading(false); }
  }, [id, decryptBatch]);

  useEffect(() => { void initialise(); }, [initialise]);

  useEffect(() => {
    if (status === 'open') send({ type: 'join', conversationId: id });
  }, [status, id, send]);

  useEffect(() => subscribe((frame) => {
    if (frame.conversationId !== id && frame.type !== 'presence' && frame.type !== 'keys:updated') return;
    if (frame.type === 'message:new' && key) {
      const incoming = frame.message as CipherMessage;
      void decryptBatch(key, [incoming]).then((decoded) => {
        if (!decoded.length) return;
        setMessages((prev) => [...prev.filter((m) => !m.pending || m.text !== decoded[0].text), ...decoded].sort((a, b) => a.createdAt - b.createdAt));
        void api(`/conversations/${encodeURIComponent(id)}/read`, { method: 'POST' }).catch(() => null);
      });
    }
    if (frame.type === 'typing') {
      setTypingFrom(frame.typing ? String(frame.userId) : null);
    }
    if (frame.type === 'keys:updated') void initialise();
  }), [subscribe, id, key, decryptBatch, initialise]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || !key || !me) return;
    setDraft('');
    const optimistic: PlainMessage = { id: `local_${Date.now()}`, senderId: me.id, senderName: me.name, text, createdAt: Date.now(), mine: true, pending: true };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const payload = await encryptMessage(key.key, text);
      if (status === 'open') {
        send({ type: 'message:send', conversationId: id, ...payload });
      } else {
        // Secure fallback: still ciphertext-only, delivered over REST.
        await api(`/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body: payload });
      }
      setMessages((prev) => prev.map((m) => m.id === optimistic.id ? { ...m, pending: false } : m));
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
      toast('Message could not be sent', 'error');
    }
  };

  const onType = (value: string) => {
    setDraft(value);
    send({ type: 'typing', conversationId: id, typing: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => send({ type: 'typing', conversationId: id, typing: false }), 1600);
  };

  const conversation = conv.data?.conversation;
  const onlineIds = conversation?.members.filter((m) => m.id !== me?.id) ?? [];

  return (
    <div className="space-y-4">
      <Link href="/chat" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-cyan"><ChevronLeft size={13} /> All conversations</Link>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Room info */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan/20 to-violet/20 text-cyan">{conversation?.kind === 'team' ? <Users size={22} /> : <LockKeyhole size={22} />}</div>
              <div className="min-w-0"><h2 className="truncate text-sm font-bold text-white">{conversation?.title ?? 'Secure conversation'}</h2><div className="text-[11px] text-slate-500">{conversation?.members.length ?? 0} members · key v{key?.version ?? '…'}</div></div>
            </div>
            <div className="mt-4 space-y-2">
              {(conversation?.members ?? []).map((m) => (
                <div key={m.id} className="flex items-center gap-2.5 rounded-xl bg-white/[.02] p-2"><Avatar name={m.name} hue={m.avatarHue} size={28} /><span className="flex-1 truncate text-xs text-slate-300">{m.name}{m.id === me?.id ? ' (you)' : ''}</span><span className="truncate text-[10px] text-slate-600">{m.skills[0]}</span></div>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan"><ShieldCheck size={14} /> Encryption status</div>
            <div className="mt-3 space-y-2 text-[11px]">
              <div className="flex items-center justify-between"><span className="text-slate-500">Device key</span><span className="font-mono text-lime">{deviceLabel ? `${deviceLabel}…` : 'generating…'}</span></div>
              <div className="flex items-center justify-between"><span className="text-slate-500">Key agreement</span><span className="text-slate-300">P-256 ECDH · HKDF</span></div>
              <div className="flex items-center justify-between"><span className="text-slate-500">Message cipher</span><span className="text-slate-300">AES-256-GCM</span></div>
              <div className="flex items-center justify-between"><span className="text-slate-500">Transport</span><span className={status === 'open' ? 'text-lime' : 'text-amber'}>{status === 'open' ? 'WSS live' : 'REST fallback'}</span></div>
            </div>
            <div className="mt-4 rounded-xl border border-cyan/20 bg-cyan/[.05] p-3 text-[11px] leading-relaxed text-slate-400"><KeyRound size={13} className="mb-1 text-cyan" /><br />The private half of your device key is non-extractable and never leaves this browser. The server stores only ciphertext and public keys.</div>
          </Card>
        </div>

        {/* Chat pane */}
        <Card className="flex h-[min(70vh,680px)] min-h-[480px] flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-white/[.06] px-4 py-3">
            <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan"><LockKeyhole size={16} /></span><div><div className="text-xs font-bold text-white">{conversation?.title ?? 'Encrypted chat'}</div><div className="text-[10px] text-slate-500">{typingFrom ? 'Someone is typing…' : onlineIds.length ? `${onlineIds.length} member(s) in this room` : 'End-to-end encrypted'}</div></div></div>
            <div className="flex items-center gap-2">
              {status === 'open' ? <span className="flex items-center gap-1 text-[10px] text-lime"><Wifi size={12} /> live</span> : <span className="flex items-center gap-1 text-[10px] text-amber"><WifiOff size={12} /> reconnecting</span>}
              <Badge tone="cyan">E2EE</Badge>
            </div>
          </div>

          <div className="hide-scroll flex-1 space-y-3 overflow-y-auto px-4 py-5">
            {(loading || conv.loading) ? <Loading rows={4} /> : setupError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center"><KeyRound size={26} className="text-amber" /><div className="text-sm font-semibold text-slate-200">Encryption setup needs attention</div><p className="max-w-sm text-xs text-slate-500">{setupError}</p><Button size="sm" onClick={() => void initialise()}>Retry key exchange</Button></div>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center"><div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan/10 text-cyan"><LockKeyhole size={26} /></div><div className="text-sm font-semibold text-slate-200">This is the start of your encrypted history</div><p className="mt-1 max-w-sm text-xs text-slate-500">Only members of this conversation can read what you send. Say hello 👋</p></div>
            ) : messages.map((m) => (
              <div key={m.id} className={cn('flex gap-2.5', m.mine && 'flex-row-reverse')}>
                {!m.mine && <Avatar name={m.senderName} hue={200} size={28} />}
                <div className={cn('max-w-[78%]', m.mine && 'text-right')}>
                  <div className={cn('mb-1 text-[10px] text-slate-600', m.mine && 'text-right')}>{m.mine ? 'You' : m.senderName} · {fmtTime(m.createdAt)} {m.pending && '· sending'}</div>
                  <div className={cn('inline-block rounded-2xl px-3.5 py-2.5 text-left text-xs leading-relaxed',
                    m.mine ? 'rounded-tr-sm bg-gradient-to-br from-cyan/85 to-violet/85 text-[#04121a]' : 'rounded-tl-sm border border-white/[.07] bg-white/[.05] text-slate-200')}>
                    {m.text}
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-white/[.06] p-3">
            {key ? (
              <div className="flex items-center gap-2">
                <Input value={draft} onChange={(e) => onType(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }}
                  placeholder="Write a message — encrypted before it leaves your browser…" maxLength={2000} className="!py-2.5" />
                <Button variant="primary" onClick={() => void submit()} disabled={!draft.trim()} aria-label="Send"><Send size={16} /></Button>
              </div>
            ) : <div className="py-2 text-center text-xs text-slate-500">Establishing encryption keys…</div>}
            <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-slate-600"><span className="flex items-center gap-1"><LockKeyhole size={10} /> Zero server-side plaintext</span><span>{relative(Date.now())} · nonce per message</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
