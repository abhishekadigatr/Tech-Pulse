'use client';

import Link from 'next/link';
import {
  Activity, Database, Download, FilePlus2, LockKeyhole, RefreshCw, ShieldAlert,
  ShieldCheck, Trash2, Users,
} from 'lucide-react';
import { useState } from 'react';
import { api, useApi } from '@/lib/api-client';
import { AuthGate } from '@/components/AppShell';
import { useAuth, useToast } from '@/components/providers';
import { Badge, Button, Card, ErrorNote, Field, Input, Loading, SectionHeader, Select, Stat, Textarea, cn } from '@/components/ui';
import { fmtDateTime, toLocalInput, fromLocalInput } from '@/lib/format';
import type { Hackathon, Paged } from '@/lib/types';

export default function AdminPage() {
  return <AuthGate><AdminContent /></AuthGate>;
}

function AdminContent() {
  const { me } = useAuth();
  const { toast } = useToast();
  const allowed = me?.role === 'admin' && me.aal2;
  const stats = useApi<{ stats: Record<string, number>; audit: Array<{ action: string; createdAt: number; email: string | null }> }>(allowed ? '/admin/stats' : null);
  const audit = useApi<{ items: Array<{ id: string; action: string; email: string | null; detail: string; createdAt: number }> }>(allowed ? '/admin/audit' : null);
  const catalog = useApi<Paged<Hackathon>>(allowed ? '/hackathons?pageSize=48' : null);
  const [form, setForm] = useState({ name: '', organizer: '', description: '', domain: '', tags: '', mode: 'online', city: '', venue: '', deadline: toLocalInput(Date.now() + 14 * 86_400_000), startAt: toLocalInput(Date.now() + 21 * 86_400_000), endAt: toLocalInput(Date.now() + 23 * 86_400_000), officialUrl: '', applyUrl: '', prize: '' });
  const [busy, setBusy] = useState(false);

  if (!allowed) return (
    <div className="mx-auto max-w-2xl py-14 text-center">
      <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl border border-amber/25 bg-amber/[.07] text-amber"><ShieldAlert size={36} /></div>
      <Badge tone="amber">Restricted area</Badge>
      <h1 className="mt-4 text-3xl font-extrabold text-white">Admin console locked</h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-slate-400">Administration requires a database <code className="text-cyan">role = admin</code> profile <strong>and</strong> an MFA-authenticated (<code className="text-cyan">aal2</code>) session. Sign in as the demo admin and complete the TOTP step.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3"><Link href="/login" className="btn btn-primary"><LockKeyhole size={15} /> Sign in with admin MFA</Link><Link href="/settings" className="btn btn-outline">Security settings</Link></div>
      <div className="glass mt-8 p-5 text-left text-xs leading-relaxed text-slate-500">Role promotion is deliberately not exposed through the app — it must be performed as a reviewed SQL statement by an operator. This prevents privilege-escalation paths in the public API.</div>
    </div>
  );

  const create = async () => {
    if (!form.name || !form.officialUrl.startsWith('https://')) { toast('Name and an HTTPS official URL are required', 'error'); return; }
    setBusy(true);
    try {
      await api('/admin/hackathons', { method: 'POST', body: {
        ...form, applyUrl: form.applyUrl || form.officialUrl,
        tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
        deadline: fromLocalInput(form.deadline), startAt: fromLocalInput(form.startAt), endAt: fromLocalInput(form.endAt),
      } });
      toast('Hackathon published'); catalog.reload(); stats.reload();
      setForm({ ...form, name: '', organizer: '', description: '', officialUrl: '', applyUrl: '' });
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not publish', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div className="glass relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-violet/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4"><div><Badge tone="violet"><ShieldCheck size={11} /> MFA-verified admin</Badge>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white">Platform <span className="glow-text">control room.</span></h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">Curate listings, inspect the security audit trail and run the ingestion and reminder workers.</p></div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={async () => { try { const r = await api<{ inserted: number; updated: number; skipped: number; error?: string }>('/admin/ingest', { method: 'POST' }); toast(r.error ? `Feed: ${r.error}` : `Feed synced: +${r.inserted} inserted, ~${r.updated} updated`, r.error ? 'info' : 'success'); catalog.reload(); } catch { toast('Ingest failed', 'error'); } }}><RefreshCw size={15} /> Sync feed</Button>
            <Button onClick={async () => { try { const r = await api<{ sent: number }>('/admin/reminders/run', { method: 'POST' }); toast(`Reminder sweep sent ${r.sent} notification(s)`); } catch { toast('Sweep failed', 'error'); } }}><Activity size={15} /> Run reminders</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Users" value={stats.data?.stats.users ?? '—'} icon={<Users size={16} />} tone="cyan" />
        <Stat label="Hackathons" value={stats.data?.stats.hackathons ?? '—'} icon={<Database size={16} />} tone="violet" />
        <Stat label="Applications" value={stats.data?.stats.applications ?? '—'} icon={<FilePlus2 size={16} />} tone="lime" />
        <Stat label="Encrypted messages" value={stats.data?.stats.messages ?? '—'} icon={<LockKeyhole size={16} />} tone="amber" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_.8fr]">
        <Card className="p-6"><SectionHeader eyebrow="Content" title="Publish a hackathon" subtitle="Only validated HTTPS URLs are accepted. All state-changing admin calls require CSRF + MFA." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Organiser"><Input value={form.organizer} onChange={(e) => setForm({ ...form, organizer: e.target.value })} /></Field>
            <Field label="Domain"><Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="AI / ML" /></Field>
            <Field label="Tags" hint="Comma separated"><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="AI, LLM, Beginner friendly" /></Field>
            <Field label="Mode"><Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="online">Online</option><option value="offline">In person</option><option value="hybrid">Hybrid</option></Select></Field>
            <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Remote" /></Field>
            <Field label="Venue"><Input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="Online · Global" /></Field>
            <Field label="Prize"><Input value={form.prize} onChange={(e) => setForm({ ...form, prize: e.target.value })} /></Field>
            <Field label="Deadline"><Input type="datetime-local" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field>
            <Field label="Start"><Input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} /></Field>
            <Field label="End"><Input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></Field>
            <Field label="Official URL" hint="HTTPS only"><Input value={form.officialUrl} onChange={(e) => setForm({ ...form, officialUrl: e.target.value })} placeholder="https://…" /></Field>
          </div>
          <Field label="Description" className="mt-4"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="mt-5 flex justify-end"><Button variant="primary" loading={busy} onClick={() => void create()}><FilePlus2 size={15} /> Publish listing</Button></div>
        </Card>

        <div className="space-y-5">
          <Card className="p-5"><SectionHeader eyebrow="Audit trail" title="Recent security events" />
            {audit.loading ? <Loading rows={3} /> : <div className="hide-scroll max-h-[320px] space-y-1.5 overflow-y-auto">{(audit.data?.items ?? []).map((a) => (
              <div key={a.id} className="flex items-start gap-2 rounded-lg bg-white/[.02] px-3 py-2"><span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', a.action.includes('failed') ? 'bg-rose' : 'bg-cyan')} /><div className="min-w-0 flex-1"><div className="truncate font-mono text-[11px] text-slate-300">{a.action}</div><div className="truncate text-[10px] text-slate-600">{a.email ?? 'anonymous'} {a.detail && `· ${a.detail}`}</div></div><span className="shrink-0 text-[10px] text-slate-600">{fmtDateTime(a.createdAt)}</span></div>
            ))}</div>}
          </Card>
          <Card className="p-5"><SectionHeader eyebrow="Listings" title="Manage catalogue" />
            <div className="hide-scroll max-h-[300px] space-y-1.5 overflow-y-auto">{(catalog.data?.items ?? []).map((h) => (
              <div key={h.id} className="flex items-center gap-2 rounded-lg bg-white/[.02] px-3 py-2"><span className="h-6 w-1 rounded-full" style={{ background: `hsl(${h.hue},80%,60%)` }} /><Link href={`/hackathons/${h.slug}`} className="min-w-0 flex-1 truncate text-[11px] text-slate-300 hover:text-cyan">{h.name}</Link>
                <button className="text-rose/70 hover:text-rose" title="Delete listing" onClick={async () => { try { await api(`/admin/hackathons/${h.id}`, { method: 'DELETE' }); toast('Listing deleted'); catalog.reload(); } catch { toast('Could not delete', 'error'); } }}><Trash2 size={13} /></button></div>
            ))}</div>
            <p className="mt-3 text-[11px] text-slate-500">An optional HTTPS JSON feed can be configured with <code className="text-cyan">OPPORTUNITIES_SHEET_FEED_URL</code>; rows are validated, deduplicated by URL and cached for five minutes.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
