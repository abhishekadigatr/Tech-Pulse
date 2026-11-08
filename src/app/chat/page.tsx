'use client';

import Link from 'next/link';
import { ArrowRight, KeyRound, LockKeyhole, MessageSquare, Plus, ShieldCheck, Users, Zap } from 'lucide-react';
import { useState } from 'react';
import { api, useApi } from '@/lib/api-client';
import { AuthGate } from '@/components/AppShell';
import { useAuth, useSocket, useToast } from '@/components/providers';
import { Avatar, Badge, Button, Card, EmptyState, Loading, Modal, SectionHeader, cn } from '@/components/ui';
import { relative } from '@/lib/format';
import type { Conversation, Seeker } from '@/lib/types';

export default function ChatIndexPage() {
  return <AuthGate><ChatList /></AuthGate>;
}

function ChatList() {
  const { me } = useAuth();
  const { status } = useSocket();
  const { toast } = useToast();
  const conversations = useApi<{ items: Conversation[] }>('/conversations');
  const seekers = useApi<{ items: Seeker[] }>('/seekers');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const people = (seekers.data?.items ?? []).filter((s) => s.user.id !== me?.id);
  const items = conversations.data?.items ?? [];

  const start = async (userId: string) => {
    setBusy(true);
    try {
      const result = await api<{ conversation: { id: string } }>('/conversations', { method: 'POST', body: { otherUserId: userId } });
      window.location.href = `/chat/${result.conversation.id}`;
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not start chat', 'error'); setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div className="glass relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-cyan/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div><Badge tone="cyan"><LockKeyhole size={11} /> End-to-end encrypted</Badge>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white">Conversations that stay <span className="glow-text">yours.</span></h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Messages are encrypted in your browser before they touch the WebSocket. The server stores ciphertext only — it has no key capable of reading them.</p>
          </div>
          <Button variant="primary" onClick={() => setOpen(true)}><Plus size={15} /> New secure chat</Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card className="divide-y divide-white/[.05] p-2">
          {conversations.loading ? <div className="p-4"><Loading rows={4} /></div> : items.length === 0 ? <div className="p-4"><EmptyState icon={<MessageSquare size={24} />} title="No conversations yet" description="Accept a teammate request or start a direct message from a builder profile." action={<Button onClick={() => setOpen(true)}>Start a chat</Button>} /></div> :
            items.map((c) => (
              <Link key={c.id} href={`/chat/${c.id}`} className="flex items-center gap-3 rounded-xl p-4 transition hover:bg-white/[.04]">
                <div className="relative"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan/20 to-violet/20 text-cyan">{c.kind === 'team' ? <Users size={19} /> : <MessageSquare size={19} />}</div>
                  {(c.online ?? 0) > 0 && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0c1322] bg-lime" />}</div>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-slate-200">{c.title}</span>{c.kind === 'team' && <Badge tone="violet">Team</Badge>}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">{c.members.slice(0, 3).map((m) => <Avatar key={m.id} name={m.name} hue={m.avatarHue} size={18} />)}<span>{c.members.length} members · key v{c.keyVersion}</span></div></div>
                <div className="shrink-0 text-right"><div className="text-[10px] text-slate-600">{relative(c.lastMessageAt)}</div>{c.unread > 0 && <span className="mt-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan px-1.5 text-[10px] font-bold text-[#04121a]">{c.unread}</span>}</div>
                <ArrowRight size={14} className="text-slate-600" />
              </Link>
            ))}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <SectionHeader eyebrow="Cryptography" title="How it works" />
            <div className="space-y-3">
              {[
                { icon: KeyRound, title: 'Device keypair', text: 'A non-extractable P-256 private key lives in IndexedDB on this browser.' },
                { icon: Zap, title: 'ECDH → HKDF', text: 'A shared secret wraps a random AES-256-GCM conversation key per member.' },
                { icon: ShieldCheck, title: 'AES-GCM messages', text: 'Fresh 96-bit nonce per message; only ciphertext is stored and relayed.' },
              ].map((s) => <div key={s.title} className="flex gap-3 rounded-xl bg-white/[.02] p-3"><s.icon size={16} className="mt-0.5 shrink-0 text-cyan" /><div><div className="text-xs font-semibold text-slate-200">{s.title}</div><div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{s.text}</div></div></div>)}
            </div>
            <div className={cn('mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px]', status === 'open' ? 'border-lime/25 bg-lime/[.05] text-lime' : 'border-white/10 text-slate-500')}>
              <span className={cn('h-1.5 w-1.5 rounded-full', status === 'open' ? 'bg-lime' : 'bg-slate-600')} />{status === 'open' ? 'WebSocket connected · realtime delivery' : 'Reconnecting… secure REST fallback available'}
            </div>
          </Card>
          <Card className="p-5">
            <div className="text-xs font-bold text-white">Key rotation</div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">When a member is removed from a team, the conversation key is rotated and old wrapped keys are discarded. The server cannot recover previous plaintext.</p>
          </Card>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Start a secure conversation" description="Pick a builder. A fresh conversation key will be wrapped for both devices.">
        {people.length === 0 ? <EmptyState title="No builders available" description="Browse Collaborate to find teammates first." action={<Link href="/collaborate" className="btn btn-primary">Open Collaborate</Link>} /> : (
          <div className="space-y-2">{people.map((s) => (
            <button key={s.id} disabled={busy} onClick={() => void start(s.user.id)} className="flex w-full items-center gap-3 rounded-xl border border-white/[.06] bg-white/[.02] p-3 text-left transition hover:border-cyan/30 disabled:opacity-50">
              <Avatar name={s.user.name} hue={s.user.avatarHue} size={38} />
              <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-200">{s.user.name}</div><div className="truncate text-[11px] text-slate-500">{s.skills.join(' · ')}</div></div>
              <MessageSquare size={15} className="text-cyan" />
            </button>
          ))}</div>
        )}
      </Modal>
    </div>
  );
}
