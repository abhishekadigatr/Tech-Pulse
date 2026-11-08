'use client';

import Link from 'next/link';
import {
  Bell, Check, ChevronRight, ExternalLink, Inbox, MessageSquare, Sparkles,
  Trash2, Users, X,
} from 'lucide-react';
import { useState } from 'react';
import { api, useApi } from '@/lib/api-client';
import { useAuth, useToast } from '@/components/providers';
import { NotesUnlock, useNotesKey, useReadableNotes } from '@/components/NotesUnlock';
import { encryptNote } from '@/lib/crypto';
import { AuthGate as Gate } from '@/components/AppShell';
import { Badge, Button, Card, Countdown, EmptyState, Field, Loading, SectionHeader, Select, Stat, Tabs, Textarea, cn } from '@/components/ui';
import { fmtDateTime, hueColor, relative, statusLabel } from '@/lib/format';
import type { Application, ApplicationStatus, InboxItem, TeamRequest } from '@/lib/types';

export default function InboxPage() {
  return <Gate><InboxContent /></Gate>;
}

function InboxContent() {
  const { toast } = useToast();
  const { me } = useAuth();
  const noteKey = useNotesKey(me?.id);
  const [tab, setTab] = useState('all');
  const apps = useApi<{ items: Application[] }>('/applications');
  const inbox = useApi<{ items: InboxItem[] }>('/inbox');
  const requests = useApi<{ items: TeamRequest[] }>('/team-requests?status=pending');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ status: 'applied' as ApplicationStatus, notes: '' });
  const [busy, setBusy] = useState(false);

  const readable = useReadableNotes(apps.data?.items, noteKey.key);
  const applications = apps.data?.items ?? [];
  const items = inbox.data?.items ?? [];
  const pending = (requests.data?.items ?? []).filter((r) => r.status === 'pending');
  const unread = items.filter((i) => !i.read).length;

  const refresh = () => { apps.reload(); inbox.reload(); requests.reload(); };

  const openEditor = (a: Application) => { const note = readable[a.id]; if (!note || note.locked || note.failed) { toast('Unlock your notes before editing', 'error'); return; } setEditing(a.id); setDraft({ status: a.status, notes: note.text }); };

  const save = async (id: string) => {
    setBusy(true);
    try {
      if (draft.notes && !noteKey.key) throw new Error('Unlock notes before saving');
      await api(`/applications/${id}`, { method: 'PATCH', body: { ...draft, notes: draft.notes ? await encryptNote(noteKey.key!, draft.notes) : '' } });
      toast('Application updated · notes re-encrypted');
      setEditing(null); refresh();
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not update', 'error'); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    try { await api(`/applications/${id}`, { method: 'DELETE' }); toast('Removed from your pipeline'); refresh(); }
    catch { toast('Could not remove', 'error'); }
  };

  const resolve = async (id: string, accept: boolean) => {
    try {
      await api(`/team-requests/${id}`, { method: 'PATCH', body: { accept } });
      toast(accept ? 'Request accepted · encrypted team chat created' : 'Request declined');
      refresh();
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not resolve request', 'error'); }
  };

  const markRead = async (id: string) => {
    if (!id.startsWith('not:')) return;
    try { await api(`/notifications/${id.slice(4)}/read`, { method: 'PATCH' }); inbox.reload(); window.dispatchEvent(new Event('tp:notifications')); }
    catch { /* silent */ }
  };

  return (
    <div className="space-y-6">
      <div className="glass relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-violet/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div><Badge tone="violet"><Inbox size={11} /> Unified inbox</Badge>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white">Everything that needs <span className="glow-text">your attention.</span></h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Applications, updates and teammate requests in one stream. New notes are encrypted in your browser. Older notes remain server-encrypted until edited.</p>
          </div>
          <Link href="/hackathons" className="btn btn-primary"><ExternalLink size={15} /> Find something to apply to</Link>
        </div>
      </div>

      <NotesUnlock state={noteKey} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Applications" value={applications.length} hint="tracked" icon={<Sparkles size={16} />} tone="cyan" />
        <Stat label="Shortlisted" value={applications.filter((a) => a.status === 'shortlisted' || a.status === 'participating').length} hint="moving forward" icon={<Check size={16} />} tone="lime" />
        <Stat label="Team requests" value={pending.length} hint="awaiting you" icon={<Users size={16} />} tone="violet" />
        <Stat label="Unread updates" value={unread} hint="in your stream" icon={<Bell size={16} />} tone="amber" />
      </div>

      <Tabs tabs={[
        { id: 'all', label: 'Activity stream', count: items.length },
        { id: 'applications', label: 'Applications', count: applications.length },
        { id: 'requests', label: 'Team requests', count: pending.length },
      ]} active={tab} onChange={setTab} />

      {tab === 'all' && (
        <Card className="divide-y divide-white/[.05] p-2">
          {inbox.loading ? <div className="p-4"><Loading rows={4} /></div> : items.length === 0 ? <div className="p-4"><EmptyState icon={<Inbox size={24} />} title="Your inbox is clear" description="Track an application to get started." /></div> :
            items.map((item) => (
              <Link key={item.id} href={item.link || '/inbox'} onClick={() => void markRead(item.id)}
                className={cn('flex items-start gap-3 rounded-xl p-4 transition hover:bg-white/[.04]', !item.read && 'bg-cyan/[.025]')}>
                <span className={cn('mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                  item.kind === 'request' ? 'bg-violet/10 text-violet' : item.kind === 'application' ? 'bg-cyan/10 text-cyan' : 'bg-lime/10 text-lime')}>
                  {item.kind === 'request' ? <Users size={16} /> : item.kind === 'application' ? <Sparkles size={16} /> : <Bell size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-slate-200">{item.title}</span>{!item.read && <span className="h-1.5 w-1.5 rounded-full bg-cyan" />}{item.meta && <Badge tone="neutral">{item.meta}</Badge>}</div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{item.body}</p>
                </div>
                <div className="shrink-0 text-right"><div className="text-[10px] text-slate-600">{relative(item.createdAt)}</div><ChevronRight size={14} className="mt-2 ml-auto text-slate-600" /></div>
              </Link>
            ))}
        </Card>
      )}

      {tab === 'applications' && (
        <div className="space-y-3">
          {apps.loading ? <Loading rows={4} /> : applications.length === 0 ? <EmptyState icon={<Sparkles size={24} />} title="No applications tracked" description="After applying through the official link, tap “I applied” on the hackathon page." action={<Link href="/hackathons" className="btn btn-primary">Browse hackathons</Link>} /> :
            applications.map((a) => (
              <Card key={a.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-1 h-11 w-1.5 shrink-0 rounded-full" style={{ background: hueColor(a.hackathon.hue ?? 190) }} />
                    <div className="min-w-0">
                      <Link href={`/hackathons/${a.hackathon.slug}`} className="text-sm font-bold text-white hover:text-cyan">{a.hackathon.name}</Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500"><span>{a.hackathon.organizer}</span><span>·</span><span>Tracked {fmtDateTime(a.appliedAt)}</span></div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={a.status === 'shortlisted' || a.status === 'participating' ? 'lime' : a.status === 'rejected' ? 'rose' : 'cyan'}>{statusLabel[a.status]}</Badge>
                    {!a.hackathon.application && null}
                    <Countdown deadline={a.hackathon.deadline} compact />
                  </div>
                </div>

                {editing === a.id ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
                    <Field label="Status"><Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ApplicationStatus })}>
                      {(['applied', 'shortlisted', 'participating', 'rejected'] as const).map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
                    </Select></Field>
                    <Field label="Private notes"><Textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} maxLength={2000} className="!min-h-[76px]" /></Field>
                    <div className="flex gap-2 sm:col-span-2"><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save(a.id)}><Check size={14} /> Save changes</Button></div>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="max-w-xl truncate text-xs text-slate-500">{readable[a.id]?.locked ? '🔒 Unlock notes to read' : readable[a.id]?.failed ? 'Unable to decrypt this note' : readable[a.id]?.text ? <><span className="text-cyan">🔒</span> {readable[a.id].text}{readable[a.id].legacy && ' (legacy server-encrypted)'}</> : <span className="italic">No private notes</span>}</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => openEditor(a)}>Edit & update</Button>
                      <Button size="sm" variant="ghost" onClick={() => void remove(a.id)} aria-label="Delete application"><Trash2 size={14} className="text-rose" /></Button>
                    </div>
                  </div>
                )}
              </Card>
            ))}
        </div>
      )}

      {tab === 'requests' && (
        <div className="space-y-3">
          {pending.length === 0 ? <EmptyState icon={<Users size={24} />} title="No pending team requests" description="When someone asks to join one of your team listings, you can accept or decline here." /> :
            pending.map((r) => (
              <Card key={r.id} className="flex flex-wrap items-center gap-4 p-5">
                <div className="flex-1 min-w-[220px]"><div className="text-sm font-bold text-white">{r.fromUser.name} → {r.teamTitle}</div><div className="mt-1 text-xs text-slate-400">{r.message}</div><div className="mt-1 text-[11px] text-slate-600">{r.hackathonName} · {relative(r.createdAt)}</div></div>
                <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => void resolve(r.id, true)}><Check size={14} /> Accept</Button><Button size="sm" variant="danger" onClick={() => void resolve(r.id, false)}><X size={14} /> Decline</Button></div>
              </Card>
            ))}
          {pending.length > 0 && <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><MessageSquare size={12} className="text-cyan" /> Accepting unlocks an end-to-end encrypted team conversation automatically.</p>}
        </div>
      )}
    </div>
  );
}
