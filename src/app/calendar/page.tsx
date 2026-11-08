'use client';

import {
  Bell, CalendarDays, ChevronLeft, ChevronRight, Clock, Download, Plus, Sparkles, Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, useApi } from '@/lib/api-client';
import { AuthGate } from '@/components/AppShell';
import { useToast } from '@/components/providers';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, SectionHeader, Select, Stat, Textarea, cn } from '@/components/ui';
import { fmtShort, fmtTime, relative, toLocalInput, fromLocalInput, typeLabel } from '@/lib/format';
import type { CalendarEvent, CalendarType } from '@/lib/types';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TYPE_TONE: Record<string, string> = { apply: 'bg-amber', study: 'bg-violet', hackathon: 'bg-cyan', travel: 'bg-lime' };

export default function CalendarPage() {
  return <AuthGate><CalendarContent /></AuthGate>;
}

function CalendarContent() {
  const { toast } = useToast();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', type: 'study' as CalendarType, startsAt: toLocalInput(Date.now() + 3_600_000), endsAt: toLocalInput(Date.now() + 2 * 3_600_000), notes: '', reminder: '1440' });

  const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getTime();
  const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).getTime();
  const calendar = useApi<{ items: CalendarEvent[] }>(`/calendar?from=${from}&to=${to}`);
  const events = calendar.data?.items ?? [];

  const cells = useMemo(() => {
    const first = new Date(from);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [from]);

  const upcoming = events.filter((e) => e.startsAt >= Date.now()).sort((a, b) => a.startsAt - b.startsAt).slice(0, 6);
  const today = new Date();

  const create = async () => {
    if (form.title.trim().length < 2) { toast('Give your event a title', 'error'); return; }
    setBusy(true);
    try {
      await api('/calendar', { method: 'POST', body: {
        title: form.title, type: form.type, startsAt: fromLocalInput(form.startsAt), endsAt: fromLocalInput(form.endsAt),
        notes: form.notes, remindOffsets: [Number(form.reminder), 120],
      } });
      toast('Event added with reminders'); setCreateOpen(false); calendar.reload();
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not add event', 'error'); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    try { await api(`/calendar/${id}`, { method: 'DELETE' }); toast('Event removed'); setSelected(null); calendar.reload(); }
    catch { toast('Could not remove event', 'error'); }
  };

  return (
    <div className="space-y-6">
      <div className="glass relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-lime/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div><Badge tone="lime"><CalendarDays size={11} /> Calendar & reminders</Badge>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white">Never miss a <span className="glow-text">deadline.</span></h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Application deadlines, focused study blocks, travel and hackathon dates — with automatic 7-day, 1-day and 2-hour reminders.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/api/v1/calendar/ics" className="btn btn-outline"><Download size={15} /> Subscribe (ICS)</a>
            <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> Add event</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="This month" value={events.length} hint="scheduled blocks" icon={<CalendarDays size={16} />} tone="cyan" />
        <Stat label="Deadlines" value={events.filter((e) => e.type === 'apply').length} hint="apply-before" icon={<Clock size={16} />} tone="amber" />
        <Stat label="Study blocks" value={events.filter((e) => e.type === 'study').length} hint="focus time" icon={<Sparkles size={16} />} tone="violet" />
        <Stat label="Hackathons" value={events.filter((e) => e.type === 'hackathon').length} hint="event dates" icon={<Bell size={16} />} tone="lime" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_.5fr]">
        <Card className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button size="icon" variant="ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft size={17} /></Button>
              <h2 className="min-w-[160px] text-center text-sm font-bold text-white">{cursor.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</h2>
              <Button size="icon" variant="ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight size={17} /></Button>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</Button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">{WEEK.map((d) => <div key={d} className="py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day) => {
              const dayStart = day.getTime();
              const dayEvents = events.filter((e) => e.startsAt >= dayStart && e.startsAt < dayStart + 86_400_000);
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = day.toDateString() === today.toDateString();
              return (
                <button key={day.toISOString()} onClick={() => dayEvents[0] && setSelected(dayEvents[0])}
                  className={cn('group relative flex min-h-[76px] flex-col items-start gap-1 rounded-lg border p-1.5 text-left transition sm:min-h-[92px]',
                    isToday ? 'border-cyan/40 bg-cyan/[.06]' : 'border-white/[.04] bg-white/[.015] hover:border-white/15',
                    !inMonth && 'opacity-35')}>
                  <span className={cn('text-[11px] font-semibold', isToday ? 'text-cyan' : 'text-slate-400')}>{day.getDate()}</span>
                  <div className="w-full space-y-0.5">{dayEvents.slice(0, 2).map((e) => (
                    <div key={e.id} className="flex items-center gap-1 overflow-hidden rounded bg-white/[.05] px-1 py-0.5 text-[9px] text-slate-300">
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TYPE_TONE[e.type])} /><span className="truncate">{e.title}</span>
                    </div>
                  ))}{dayEvents.length > 2 && <div className="pl-1 text-[9px] text-slate-500">+{dayEvents.length - 2} more</div>}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-[10px] text-slate-500">{(['apply', 'study', 'hackathon', 'travel'] as const).map((t) => <span key={t} className="flex items-center gap-1.5"><span className={cn('h-2 w-2 rounded-full', TYPE_TONE[t])} />{typeLabel[t]}</span>)}</div>
        </Card>

        <div className="space-y-5">
          <Card className="p-5"><SectionHeader eyebrow="Coming up" title="Next on your plate" />
            {calendar.loading ? <Loading rows={3} /> : upcoming.length === 0 ? <EmptyState title="Nothing upcoming" description="Track a hackathon or add a study block." /> : (
              <div className="space-y-2">{upcoming.map((e) => (
                <button key={e.id} onClick={() => setSelected(e)} className="w-full rounded-xl border border-white/[.05] bg-white/[.02] p-3 text-left transition hover:border-cyan/25">
                  <div className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', TYPE_TONE[e.type])} /><span className="truncate text-xs font-semibold text-slate-200">{e.title}</span></div>
                  <div className="mt-1 text-[11px] text-slate-500">{fmtShort(e.startsAt)} · {fmtTime(e.startsAt)} · {relative(e.startsAt)}</div>
                </button>
              ))}</div>
            )}
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 text-xs font-bold text-white"><Bell size={14} className="text-cyan" /> Reminder cadence</div>
            <div className="mt-3 space-y-2 text-[11px] text-slate-500">
              {[['7 days before', 'Plan your submission'], ['1 day before', 'Final checklist'], ['2 hours before', 'Show up on time']].map(([a, b]) => (
                <div key={a} className="flex items-center justify-between rounded-lg bg-white/[.02] px-3 py-2"><span className="text-slate-300">{a}</span><span>{b}</span></div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Reminders are generated by an idempotent server worker and delivered in-app, as browser notifications and as an ICS feed you can subscribe to.</p>
            <Button size="sm" className="mt-3 w-full" onClick={async () => {
              if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                const result = await Notification.requestPermission();
                toast(result === 'granted' ? 'Browser reminders enabled' : 'Browser reminders stay off', result === 'granted' ? 'success' : 'info');
                if (result === 'granted') await api('/users/me/settings', { method: 'PATCH', body: { notifyPush: true } }).catch(() => null);
              } else toast('Notification permission already set', 'info');
            }}>Enable browser reminders</Button>
          </Card>
        </div>
      </div>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title ?? 'Event'} description={selected ? `${fmtShort(selected.startsAt)} · ${fmtTime(selected.startsAt)} · ${typeLabel[selected.type]}` : undefined}>
        {selected && <div className="space-y-4">
          <div className="glass-soft p-4 text-xs leading-relaxed text-slate-300">{selected.notes || 'No private notes for this event.'}</div>
          <div className="flex flex-wrap gap-2">{selected.remindOffsets.map((o) => <Badge key={o} tone="cyan">{o >= 1440 ? `${Math.round(o / 1440)}d` : `${o}m`} before</Badge>)}</div>
          <div className="flex justify-between"><Button variant="danger" onClick={() => void remove(selected.id)}><Trash2 size={14} /> Delete event</Button><Button variant="ghost" onClick={() => setSelected(null)}>Close</Button></div>
        </div>}
      </Modal>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add a calendar block" description="Notes are encrypted twice before storage. Reminders are scheduled automatically.">
        <div className="space-y-4">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Study · System design revision" maxLength={140} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CalendarType })}>
              {(['study', 'apply', 'hackathon', 'travel'] as const).map((t) => <option key={t} value={t}>{typeLabel[t]}</option>)}
            </Select></Field>
            <Field label="First reminder"><Select value={form.reminder} onChange={(e) => setForm({ ...form, reminder: e.target.value })}>
              <option value="10080">7 days before</option><option value="1440">1 day before</option><option value="120">2 hours before</option>
            </Select></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts"><Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
            <Field label="Ends"><Input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></Field>
          </div>
          <Field label="Private notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What to prepare, links, people to meet…" maxLength={2000} /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void create()}>Add to calendar</Button></div>
        </div>
      </Modal>
    </div>
  );
}
