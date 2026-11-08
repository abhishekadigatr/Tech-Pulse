'use client';

import Link from 'next/link';
import {
  ArrowRight, Bell, Bookmark, CalendarDays, ChevronRight, Compass, Inbox, LockKeyhole,
  MessageSquare, Rocket, ShieldCheck, Sparkles, Trophy, Users, Zap, Map,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, useApi } from '@/lib/api-client';
import { useAuth, useToast } from '@/components/providers';
import { HackathonCard } from '@/components/HackathonCard';
import { Avatar, Badge, Button, Card, Countdown, EmptyState, Loading, Progress, SectionHeader, Stat, cn } from '@/components/ui';
import { DAY, countdown, fmtShort, hueColor, relative, statusLabel, typeLabel } from '@/lib/format';
import type { Application, CalendarEvent, Conversation, Hackathon, InboxItem, Me, Paged } from '@/lib/types';

const FEATURES = [
  { icon: Compass, title: 'Direct official links', text: 'One verified hop from discovery to the organiser’s application page. No scraped forms, no middlemen.', tone: 'cyan' },
  { icon: Inbox, title: 'Application pipeline', text: 'Mark “I applied” and track Applied → Shortlisted → Participating with private, encrypted notes.', tone: 'violet' },
  { icon: Users, title: 'Find your team', text: 'Post a listing, match by skills, accept requests and unlock an encrypted team chat automatically.', tone: 'lime' },
  { icon: LockKeyhole, title: 'End-to-end encrypted chat', text: 'P-256 ECDH + HKDF + AES-GCM over WebSockets. The server stores ciphertext only.', tone: 'amber' },
  { icon: CalendarDays, title: 'Reminders that land', text: 'Deadlines, study blocks and event dates with 7-day, 1-day and 2-hour reminders plus an ICS feed.', tone: 'cyan' },
  { icon: Map, title: 'Journey intelligence', text: 'Route-aware food, fuel, rest and ATM stops ranked by rating, detour and opening hours.', tone: 'violet' },
];

export default function DashboardPage() {
  const { me, refreshMe } = useAuth();
  const { toast } = useToast();
  const [demoBusy, setDemoBusy] = useState(false);
  const catalog = useApi<Paged<Hackathon>>('/hackathons?pageSize=8&status=open&sort=deadline');
  const applications = useApi<{ items: Application[] }>(me ? '/applications' : null);
  const calendar = useApi<{ items: CalendarEvent[] }>(me ? `/calendar?from=${Date.now()}` : null);
  const inbox = useApi<{ items: InboxItem[] }>(me ? '/inbox' : null);
  const conversations = useApi<{ items: Conversation[] }>(me ? '/conversations' : null);

  const now = Date.now();
  const openEvents = catalog.data?.items ?? [];
  const apps = applications.data?.items ?? [];
  const events = (calendar.data?.items ?? []).filter((e) => e.startsAt > now).sort((a, b) => a.startsAt - b.startsAt);
  const inboxItems = (inbox.data?.items ?? []).slice(0, 4);
  const unread = (inbox.data?.items ?? []).filter((i) => !i.read).length;
  const convs = conversations.data?.items ?? [];

  const recommended = useMemo(() => {
    const skills = (me?.skills ?? []).map((s) => s.toLowerCase());
    if (!skills.length) return openEvents.slice(0, 3);
    return [...openEvents].sort((a, b) => {
      const score = (h: Hackathon) => h.tags.filter((t) => skills.some((s) => t.toLowerCase().includes(s) || s.includes(t.toLowerCase()))).length
        + (skills.some((s) => h.domain.toLowerCase().includes(s)) ? 2 : 0);
      return score(b) - score(a) || a.deadline - b.deadline;
    }).slice(0, 3);
  }, [openEvents, me?.skills]);

  const enterDemo = async () => {
    setDemoBusy(true);
    try {
      const hint = await api<{ demo: { email: string; password: string } }>('/auth/dev-hint');
      await api('/auth/login', { method: 'POST', body: hint.demo });
      await refreshMe();
      toast('Welcome in! Your workspace is ready.');
    } catch { toast('Could not start the demo session', 'error'); }
    finally { setDemoBusy(false); }
  };

  return (
    <div className="space-y-8">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="glass relative overflow-hidden p-6 sm:p-9">
        <div className="pointer-events-none absolute -right-24 -top-32 h-[420px] w-[420px] rounded-full bg-cyan/10 blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-40 left-1/3 h-[360px] w-[360px] rounded-full bg-violet/10 blur-[100px]" />
        <div className="relative grid gap-8 lg:grid-cols-[1.25fr_.75fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan/25 bg-cyan/[.07] px-3 py-1.5 text-[11px] font-semibold text-cyan">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-cyan" /></span>
              Live hackathon signal · {openEvents.length} open deadlines
            </div>
            <h1 className="max-w-2xl text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[56px]">
              {me ? <>Good to see you, <span className="glow-text">{me.name.split(' ')[0]}.</span></> : <>Every hackathon.<br /><span className="glow-text">One pulse.</span></>}
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
              Discover verified hackathons, jump straight to the official application, track your pipeline, find teammates, chat end-to-end encrypted, and never miss a deadline — all the way to the food stop on your route.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/hackathons" className="btn btn-primary"><Compass size={16} /> Explore hackathons</Link>
              {me ? <Link href="/collaborate" className="btn btn-outline"><Users size={16} /> Find teammates</Link>
                : <Button loading={demoBusy} onClick={() => void enterDemo()}><Rocket size={16} /> Try the demo workspace</Button>}
              <Link href="/learn" className="btn btn-ghost">Playbook <ChevronRight size={15} /></Link>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5"><ShieldCheck size={13} className="text-cyan" /> Argon2id + TOTP 2FA</span>
              <span className="flex items-center gap-1.5"><LockKeyhole size={13} className="text-violet" /> 2-step data encryption</span>
              <span className="flex items-center gap-1.5"><Zap size={13} className="text-lime" /> Realtime encrypted chat</span>
            </div>
          </div>

          {/* Animated radar */}
          <div className="relative mx-auto hidden aspect-square w-full max-w-[320px] lg:block">
            <div className="absolute inset-0 rounded-full border border-cyan/10" />
            <div className="absolute inset-[15%] rounded-full border border-violet/15" />
            <div className="absolute inset-[31%] rounded-full border border-cyan/20" />
            <div className="absolute inset-[46%] rounded-full bg-gradient-to-br from-cyan/25 to-violet/25 blur-xl" />
            <div className="absolute inset-0 animate-orbit">
              <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-cyan shadow-[0_0_14px_#35e6d0]" />
              <span className="absolute bottom-[14%] right-[8%] h-2 w-2 rounded-full bg-violet shadow-[0_0_12px_#9b7bff]" />
            </div>
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 320 320" fill="none">
              <circle cx="160" cy="160" r="150" stroke="rgba(53,230,208,.12)" strokeWidth="1" strokeDasharray="4 8" />
              <circle cx="160" cy="160" r="110" stroke="rgba(155,123,255,.14)" strokeWidth="1" />
              <path d="M160 160 L160 12 A148 148 0 0 1 285 90 Z" fill="url(#radar)" opacity=".16" />
              <defs><linearGradient id="radar" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#35e6d0" /><stop offset="1" stopColor="#35e6d0" stopOpacity="0" /></linearGradient></defs>
            </svg>
            <div className="absolute left-1/2 top-1/2 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-white/10 bg-[#0a1120]/90 text-center shadow-glow backdrop-blur">
              <Zap size={22} className="text-cyan" fill="currentColor" />
              <span className="mt-1 text-2xl font-bold text-white">{openEvents.length || 14}</span>
              <span className="text-[10px] uppercase tracking-wider text-slate-500">live signals</span>
            </div>
            {openEvents.slice(0, 4).map((h, i) => (
              <div key={h.id} className="absolute flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0c1424]/90 px-2 py-1 text-[10px] text-slate-300 backdrop-blur animate-float"
                style={{ top: `${8 + i * 23}%`, left: i % 2 ? '2%' : '58%', animationDelay: `${i * 0.8}s` }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: hueColor(h.hue) }} />
                <span className="max-w-[110px] truncate">{h.name}</span>
                <Countdown deadline={h.deadline} compact />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Metrics ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open hackathons" value={openEvents.length || '—'} hint="deadlines ahead" icon={<Compass size={17} />} tone="cyan" />
        <Stat label={me ? 'Applications' : 'Verified sources'} value={me ? apps.length : 8} hint={me ? 'in your pipeline' : 'Devpost · MLH · Unstop'} icon={<Trophy size={17} />} tone="violet" />
        <Stat label={me ? 'Unread updates' : 'Team listings'} value={me ? unread : 5} hint={me ? 'in your inbox' : 'looking for teammates'} icon={me ? <Bell size={17} /> : <Users size={17} />} tone="lime" />
        <Stat label={me ? 'Upcoming events' : 'Journey stops'} value={me ? events.length : 23} hint={me ? 'on your calendar' : 'food · fuel · rest'} icon={me ? <CalendarDays size={17} /> : <Map size={17} />} tone="amber" />
      </div>

      {/* ── Deadline radar + next up ─────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
        <Card className="p-5">
          <SectionHeader eyebrow="Live radar" title="Closing soon" subtitle="Deadlines update in real time — apply through the official link, then track it in your inbox."
            action={<Link href="/hackathons" className="text-xs font-semibold text-cyan hover:underline">View all <ArrowRight size={12} className="inline" /></Link>} />
          {catalog.loading ? <Loading rows={4} /> : openEvents.length === 0 ? <EmptyState title="No open deadlines" description="Check back soon for new hackathons." /> : (
            <div className="space-y-2">
              {openEvents.slice(0, 5).map((h) => {
                const span = Math.max(1, h.deadline - (h.startAt - 20 * DAY));
                const pct = Math.min(100, Math.max(4, ((h.deadline - now) / span) * 100));
                const c = countdown(h.deadline);
                return (
                  <Link key={h.id} href={`/hackathons/${h.slug}`} className="group flex items-center gap-3 rounded-xl border border-white/[.05] bg-white/[.02] p-3 transition hover:border-cyan/25 hover:bg-cyan/[.03]">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold" style={{ background: hueColor(h.hue, 60, 22), color: hueColor(h.hue) }}>{h.name[0]}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-slate-200 group-hover:text-cyan">{h.name}</span>
                        <Countdown deadline={h.deadline} compact />
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500"><span className="truncate">{h.organizer}</span><span>·</span><span>{fmtShort(h.deadline)}</span></div>
                      <div className="mt-2"><Progress value={100 - pct} tone={c.urgent ? 'violet' : 'cyan'} /></div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <SectionHeader eyebrow="Your schedule" title="Next up" />
            {!me ? (
              <div className="rounded-xl border border-dashed border-white/10 p-5 text-center">
                <CalendarDays size={26} className="mx-auto mb-2 text-violet/70" />
                <p className="text-xs text-slate-400">Sign in to see deadlines, study blocks and reminders on your calendar.</p>
                <Link href="/login" className="mt-3 inline-block text-xs font-semibold text-cyan hover:underline">Sign in →</Link>
              </div>
            ) : calendar.loading ? <Loading rows={2} /> : events.length === 0 ? <EmptyState title="Nothing scheduled" description="Add a study block or track a hackathon." /> : (
              <div className="space-y-2">
                {events.slice(0, 4).map((e) => (
                  <Link key={e.id} href="/calendar" className="flex items-start gap-3 rounded-xl border border-white/[.05] bg-white/[.02] p-3 hover:border-white/15">
                    <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-violet/10 text-violet">
                      <span className="text-[9px] font-bold uppercase">{new Date(e.startsAt).toLocaleString('en-IN', { month: 'short' })}</span>
                      <span className="text-sm font-bold leading-none">{new Date(e.startsAt).getDate()}</span>
                    </div>
                    <div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-200">{e.title}</div><div className="mt-0.5 text-[11px] text-slate-500">{relative(e.startsAt)} · {typeLabel[e.type]}</div></div>
                  </Link>
                ))}
              </div>
            )}
            <Link href="/calendar" className="mt-4 flex items-center justify-center gap-1.5 rounded-xl border border-white/[.07] py-2 text-xs font-semibold text-slate-300 hover:bg-white/[.04]">Open calendar <ChevronRight size={13} /></Link>
          </Card>

          {me && (
            <Card className="p-5">
              <SectionHeader eyebrow="Quick actions" title="Jump back in" />
              <div className="grid grid-cols-2 gap-2">
                {[
                  { href: '/inbox', label: 'Track application', icon: Inbox, tint: 'text-cyan' },
                  { href: '/collaborate', label: 'Find teammates', icon: Users, tint: 'text-violet' },
                  { href: '/chat', label: 'Encrypted chat', icon: MessageSquare, tint: 'text-lime' },
                  { href: '/journey', label: 'Plan journey', icon: Map, tint: 'text-amber' },
                ].map((a) => (
                  <Link key={a.href} href={a.href} className="flex flex-col gap-2 rounded-xl border border-white/[.06] bg-white/[.02] p-3 transition hover:border-cyan/25 hover:bg-cyan/[.03]">
                    <a.icon size={18} className={a.tint} />
                    <span className="text-[11px] font-semibold text-slate-300">{a.label}</span>
                  </Link>
                ))}
              </div>
              {convs.length > 0 && <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-lime" />{convs.length} encrypted conversation{convs.length > 1 ? 's' : ''} ready</div>}
            </Card>
          )}
        </div>
      </div>

      {/* ── Pipeline / inbox for signed-in users ─────────────────────────── */}
      {me && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-5">
            <SectionHeader eyebrow="Pipeline" title="Your applications" action={<Link href="/inbox" className="text-xs font-semibold text-cyan hover:underline">Open inbox →</Link>} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['applied', 'shortlisted', 'participating', 'rejected'] as const).map((s) => {
                const count = apps.filter((a) => a.status === s).length;
                const tone = s === 'shortlisted' || s === 'participating' ? 'text-lime' : s === 'rejected' ? 'text-rose' : 'text-cyan';
                return (
                  <Link key={s} href="/inbox" className="rounded-xl border border-white/[.06] bg-white/[.02] p-3 text-center transition hover:border-white/20">
                    <div className={cn('text-2xl font-bold', tone)}>{count}</div>
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{statusLabel[s]}</div>
                  </Link>
                );
              })}
            </div>
            <div className="mt-4 space-y-2">
              {apps.slice(0, 3).map((a) => (
                <Link key={a.id} href="/inbox" className="flex items-center gap-3 rounded-xl bg-white/[.02] p-2.5 hover:bg-white/[.05]">
                  <div className="h-8 w-1 rounded-full" style={{ background: hueColor(a.hackathon.hue ?? 190) }} />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{a.hackathon.name}</span>
                  <Badge tone={a.status === 'shortlisted' || a.status === 'participating' ? 'lime' : 'violet'}>{statusLabel[a.status]}</Badge>
                </Link>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader eyebrow="Activity" title="Latest signals" action={<Link href="/inbox" className="text-xs font-semibold text-cyan hover:underline">All activity →</Link>} />
            {inbox.loading ? <Loading rows={3} /> : inboxItems.length === 0 ? <EmptyState title="All quiet" description="New updates will appear here." /> : (
              <div className="space-y-2">
                {inboxItems.map((item) => (
                  <Link key={item.id} href={item.link || '/inbox'} className="flex items-start gap-3 rounded-xl border border-white/[.05] bg-white/[.02] p-3 hover:border-white/15">
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', item.read ? 'bg-slate-600' : 'bg-cyan shadow-[0_0_8px_#35e6d0]')} />
                    <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-slate-200">{item.title}</div><div className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{item.body}</div></div>
                    <span className="shrink-0 text-[10px] text-slate-600">{relative(item.createdAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Recommended ─────────────────────────────────────────────────── */}
      <section>
        <SectionHeader eyebrow={me ? 'Matched to your skills' : 'Fresh opportunities'} title="Recommended hackathons"
          subtitle={me ? `Tuned from your profile: ${me.skills.slice(0, 3).join(', ') || 'add skills in settings'}.` : 'Hand-picked, verified, and one click from the official application page.'}
          action={<Link href="/hackathons" className="btn btn-outline !py-2 !text-xs">Browse all <ArrowRight size={13} /></Link>} />
        {catalog.loading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Loading rows={3} /><Loading rows={3} /><Loading rows={3} /></div> : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{recommended.map((h) => <HackathonCard key={h.id} hackathon={h} />)}</div>
        )}
      </section>

      {/* ── Feature strip ───────────────────────────────────────────────── */}
      <section>
        <SectionHeader eyebrow="One connected journey" title="From discovery to demo day" subtitle="No duplicate tools, no scattered spreadsheets — every step lives in one secure workspace." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Card key={f.title} hover className="group p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl bg-white/[.05]',
                  f.tone === 'cyan' && 'text-cyan', f.tone === 'violet' && 'text-violet', f.tone === 'lime' && 'text-lime', f.tone === 'amber' && 'text-amber')}>
                  <f.icon size={19} />
                </span>
                <span className="font-mono text-[11px] text-slate-700">0{i + 1}</span>
              </div>
              <h3 className="text-sm font-bold text-white group-hover:text-cyan">{f.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{f.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <div className="glass relative overflow-hidden p-6 text-center sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-cyan/[.06] via-transparent to-violet/[.06]" />
        <Sparkles size={22} className="mx-auto mb-3 text-cyan" />
        <h3 className="text-xl font-bold text-white">{me ? 'Ready for the next build?' : 'Your next hackathon starts here'}</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm text-slate-400">Set a reminder, find a teammate, and show up prepared. Tech Pulse keeps the whole journey in one place.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href="/hackathons" className="btn btn-primary"><Bookmark size={15} /> Browse hackathons</Link>
          {!me && <Button onClick={() => void enterDemo()} loading={demoBusy}><Rocket size={15} /> Launch demo</Button>}
        </div>
      </div>
    </div>
  );
}
