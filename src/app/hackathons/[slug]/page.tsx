'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, ArrowUpRight, Bookmark, Building2, CalendarDays, Check, Clock, Compass,
  ExternalLink, Globe2, Map, MapPin, ShieldCheck, Sparkles, Trophy, Users, Zap,
} from 'lucide-react';
import { useState } from 'react';
import { api, useApi } from '@/lib/api-client';
import { useAuth, useToast } from '@/components/providers';
import { HackathonCard } from '@/components/HackathonCard';
import { Avatar, Badge, Button, Card, Countdown, EmptyState, Field, Input, Loading, Modal, SectionHeader, Select, Tabs, Textarea, cn } from '@/components/ui';
import { fmtDateTime, fmtShort, hueColor, modeLabel, statusLabel } from '@/lib/format';
import type { ApplicationStatus, Hackathon, Paged, Seeker, Team } from '@/lib/types';

export default function HackathonDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { me } = useAuth();
  const { toast } = useToast();
  const detail = useApi<{ hackathon: Hackathon }>(`/hackathons/${encodeURIComponent(slug)}`);
  const teams = useApi<{ items: Team[] }>(detail.data ? `/hackathons/${detail.data.hackathon.id}/teams` : null, [detail.data?.hackathon.id]);
  const seekers = useApi<{ items: Seeker[] }>(detail.data ? `/hackathons/${detail.data.hackathon.id}/seekers` : null, [detail.data?.hackathon.id]);
  const related = useApi<Paged<Hackathon>>(detail.data ? `/hackathons?tag=${encodeURIComponent(detail.data.hackathon.tags[0] ?? '')}&pageSize=3` : null, [detail.data?.hackathon.id]);
  const [tab, setTab] = useState('overview');
  const [applyOpen, setApplyOpen] = useState(false);
  const [status, setStatus] = useState<ApplicationStatus>('applied');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  if (detail.loading) return <div className="mx-auto max-w-5xl space-y-4"><div className="skeleton h-64 w-full rounded-2xl" /><Loading rows={3} /></div>;
  if (detail.error || !detail.data) return <EmptyState icon={<Compass size={24} />} title="Hackathon not found" description={detail.error ?? 'This listing may have been removed.'} action={<Link href="/hackathons" className="btn btn-primary">Back to discovery</Link>} />;

  const h = detail.data.hackathon;
  const accent = hueColor(h.hue);

  const requireSignIn = (): boolean => {
    if (me) return true;
    toast('Sign in to use workspace actions', 'info');
    return false;
  };

  const toggleBookmark = async () => {
    if (!requireSignIn()) return;
    try {
      await api(`/hackathons/${h.id}/bookmark`, { method: h.bookmarked ? 'DELETE' : 'POST' });
      toast(h.bookmarked ? 'Removed from saved' : 'Saved to your list');
      detail.reload();
    } catch { toast('Could not update saved list', 'error'); }
  };

  const trackApplication = async () => {
    if (!requireSignIn()) return;
    setBusy(true);
    try {
      await api('/applications', { method: 'POST', body: { hackathonId: h.id, status, notes } });
      toast('Added to your inbox · deadline added to calendar');
      setApplyOpen(false);
      detail.reload();
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not track application', 'error'); }
    finally { setBusy(false); }
  };

  const syncCalendar = async () => {
    if (!requireSignIn()) return;
    try {
      const result = await api<{ added: number }>(`/calendar/sync-hackathon/${h.id}`, { method: 'POST' });
      toast(result.added ? `${result.added} event(s) added to your calendar` : 'Deadline and event dates are already on your calendar');
    } catch { toast('Could not sync calendar', 'error'); }
  };

  const info = [
    { icon: CalendarDays, label: 'Apply by', value: fmtDateTime(h.deadline) },
    { icon: Clock, label: 'Event dates', value: `${fmtShort(h.startAt)} – ${fmtShort(h.endAt)}` },
    { icon: MapPin, label: 'Location', value: h.venue || h.city },
    { icon: Trophy, label: 'Prize pool', value: h.prize || 'Recognition & mentorship' },
  ];

  return (
    <div className="space-y-6">
      <Link href="/hackathons" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-cyan"><ArrowLeft size={13} /> Back to discovery</Link>

      {/* Hero */}
      <div className="glass relative overflow-hidden">
        <div className="relative h-40 sm:h-52" style={{ background: `linear-gradient(115deg, ${hueColor(h.hue, 65, 16)}, #0a1020 70%)` }}>
          <div className="absolute -right-10 -top-20 h-72 w-72 rounded-full opacity-30 blur-3xl" style={{ background: accent }} />
          <div className="absolute inset-0 opacity-25" style={{ backgroundImage: `radial-gradient(${accent} 1px, transparent 1px)`, backgroundSize: '22px 22px' }} />
          <svg className="absolute -bottom-16 right-10 h-64 w-64 animate-orbit opacity-25" viewBox="0 0 200 200" fill="none">
            <circle cx="100" cy="100" r="94" stroke={accent} strokeWidth="1" strokeDasharray="6 12" />
            <circle cx="100" cy="100" r="62" stroke={accent} strokeWidth="1" />
            <circle cx="100" cy="100" r="30" stroke={accent} strokeWidth="1" />
          </svg>
          <div className="absolute bottom-5 left-6 right-6 flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="cyan" className="!bg-black/45">{h.domain}</Badge>
              <Badge className="!bg-black/45 !text-white">{modeLabel[h.mode]}</Badge>
              <Badge className="!bg-black/45 !text-white">{h.city}</Badge>
            </div>
            <div className="rounded-xl border border-white/15 bg-black/50 px-3 py-2 backdrop-blur"><Countdown deadline={h.deadline} /></div>
          </div>
        </div>
        <div className="p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{h.name}</h1>
              <p className="mt-2 flex items-center gap-2 text-sm text-slate-400"><Building2 size={14} />{h.organizer}<span className="text-slate-700">·</span><ShieldCheck size={13} className="text-cyan" /> Verified listing</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void toggleBookmark()} variant="outline"><Bookmark size={15} fill={h.bookmarked ? 'currentColor' : 'none'} className={h.bookmarked ? 'text-cyan' : ''} />{h.bookmarked ? 'Saved' : 'Save'}</Button>
              <Button onClick={() => void syncCalendar()} variant="outline"><CalendarDays size={15} /> Add to calendar</Button>
            </div>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {info.map((item) => (
              <div key={item.label} className="glass-soft flex items-start gap-3 p-3.5">
                <span className="mt-0.5 text-cyan"><item.icon size={16} /></span>
                <div className="min-w-0"><div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{item.label}</div><div className="mt-0.5 truncate text-xs font-semibold text-slate-200" title={item.value}>{item.value}</div></div>
              </div>
            ))}
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <button onClick={() => window.open(`/api/v1/hackathons/${h.id}/apply-link`, '_blank', 'noopener,noreferrer')} className="btn btn-primary !px-6 !py-3">
              <ExternalLink size={16} /> Apply on official site <ArrowUpRight size={14} />
            </button>
            <Button onClick={() => setApplyOpen(true)} className="!py-3"><Check size={16} /> I applied · track it</Button>
            <Link href={`/collaborate?hackathon=${h.id}`} className="btn btn-outline !py-3"><Users size={16} /> Find teammates</Link>
            <Link href={`/journey?hackathon=${h.id}`} className="btn btn-outline !py-3"><Map size={16} /> Plan journey</Link>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500"><ShieldCheck size={12} className="text-cyan" /> The apply button is a logged, validated HTTPS redirect — we never ask for your credentials.</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'teams', label: 'Teams', count: teams.data?.items.length },
        { id: 'seekers', label: 'Seekers', count: seekers.data?.items.length },
      ]} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_.6fr]">
          <Card className="p-6">
            <SectionHeader eyebrow="The brief" title="About this hackathon" />
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{h.description}</p>
            <div className="divider my-6" />
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Topics & tracks</div>
            <div className="mt-3 flex flex-wrap gap-2">{h.tags.map((t) => <span key={t} className="chip chip-active">{t}</span>)}</div>
            <div className="divider my-6" />
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { icon: Globe2, label: 'Format', value: modeLabel[h.mode] },
                { icon: Users, label: 'Teams looking', value: `${h.teamCount ?? 0} listings` },
                { icon: Zap, label: 'Seekers', value: `${h.seekerCount ?? 0} builders` },
              ].map((x) => (
                <div key={x.label} className="glass-soft p-3"><x.icon size={15} className="text-violet" /><div className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">{x.label}</div><div className="mt-0.5 text-sm font-semibold text-slate-200">{x.value}</div></div>
              ))}
            </div>
          </Card>
          <div className="space-y-5">
            <Card className="p-5">
              <SectionHeader eyebrow="Your plan" title="Before you apply" />
              <ul className="space-y-3 text-xs text-slate-400">
                {['Read the eligibility and team-size rules on the official page.', 'Sketch a 2-minute demo you can actually finish in 48 hours.', 'Find one teammate with a complementary skill.', 'Add the deadline and event dates to your calendar.', 'For in-person events, check the route and food stops.'].map((tip, i) => (
                  <li key={tip} className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan/10 text-[10px] font-bold text-cyan">{i + 1}</span>{tip}</li>
                ))}
              </ul>
              <Link href="/learn" className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-cyan hover:underline"><Sparkles size={13} /> Read the full playbook</Link>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 text-xs font-bold text-cyan"><ShieldCheck size={14} /> Privacy first</div>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">Your application notes and calendar entries are encrypted twice: once in your browser and once on the server with a per-user key.</p>
            </Card>
          </div>
        </div>
      )}

      {tab === 'teams' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {teams.loading ? <Loading rows={3} /> : (teams.data?.items.length ?? 0) === 0 ? <div className="sm:col-span-2"><EmptyState icon={<Users size={24} />} title="No team listings yet" description="Be the first to post a listing for this hackathon." action={<Link href={`/collaborate?hackathon=${h.id}`} className="btn btn-primary">Post a team listing</Link>} /></div> :
            teams.data!.items.map((t) => (
              <Card key={t.id} hover className="p-5">
                <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-white">{t.title}</h3><p className="mt-1 text-[11px] text-slate-500">by {t.owner.name} · {t.members.length}/{t.maxSize} members</p></div><Badge tone="violet">Open</Badge></div>
                <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-400">{t.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">{t.lookingFor.map((s) => <span key={s} className="chip !text-[10px]">{s}</span>)}</div>
                <Link href={`/collaborate?hackathon=${h.id}`} className="btn btn-outline mt-4 w-full !py-2 !text-xs">View in Collaborate</Link>
              </Card>
            ))}
        </div>
      )}

      {tab === 'seekers' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {seekers.loading ? <Loading rows={3} /> : (seekers.data?.items.length ?? 0) === 0 ? <div className="sm:col-span-2 lg:col-span-3"><EmptyState icon={<Users size={24} />} title="No seekers yet" description="Builders looking for a team will show up here." /></div> :
            seekers.data!.items.map((s) => (
              <Card key={s.id} hover className="p-5">
                <div className="flex items-center gap-3"><Avatar name={s.user.name} hue={s.user.avatarHue} size={38} /><div><div className="text-sm font-semibold text-white">{s.user.name}</div><div className="text-[11px] text-slate-500">{s.user.college}</div></div></div>
                <p className="mt-3 text-xs text-slate-300">{s.headline}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">{s.skills.map((skill) => <span key={skill} className="chip !text-[10px]">{skill}</span>)}</div>
                <div className="mt-4 text-[11px] text-slate-500">Available: {s.availability}</div>
              </Card>
            ))}
        </div>
      )}

      {related.data && related.data.items.filter((x) => x.id !== h.id).length > 0 && (
        <section>
          <SectionHeader eyebrow="Keep exploring" title="Similar hackathons" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{related.data.items.filter((x) => x.id !== h.id).slice(0, 3).map((x) => <HackathonCard key={x.id} hackathon={x} />)}</div>
        </section>
      )}

      <Modal open={applyOpen} onClose={() => setApplyOpen(false)} title="Track this application" description="The direct link opens the organiser's page. Come back here to log it in your inbox.">
        <div className="space-y-4">
          <div className="glass-soft flex items-center gap-3 p-3"><span className="h-9 w-1 rounded-full" style={{ background: accent }} /><div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-200">{h.name}</div><div className="text-[11px] text-slate-500">Deadline {fmtDateTime(h.deadline)}</div></div></div>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)}>
            {(['applied', 'shortlisted', 'participating', 'rejected'] as const).map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
          </Select></Field>
          <Field label="Private notes" hint="Encrypted twice before storage — only you can read these."><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Team name, submission link, things to remember…" maxLength={2000} /></Field>
          <div className="flex items-start gap-2 rounded-xl border border-cyan/20 bg-cyan/[.05] p-3 text-[11px] leading-relaxed text-slate-400"><CalendarDays size={14} className="mt-0.5 shrink-0 text-cyan" /> Saving also adds the application deadline and event dates to your calendar with reminders.</div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setApplyOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void trackApplication()}>Save to inbox</Button></div>
        </div>
      </Modal>
    </div>
  );
}
