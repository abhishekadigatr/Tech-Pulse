'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowRight, Check, Filter, MessageSquare, Plus, Search, Send, Sparkles, Users, X, ShieldCheck,
} from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { api, useApi } from '@/lib/api-client';
import { AuthGate } from '@/components/AppShell';
import { useAuth, useToast } from '@/components/providers';
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, SectionHeader, Select, Stat, Tabs, Textarea, cn } from '@/components/ui';
import { relative } from '@/lib/format';
import type { Hackathon, Paged, Seeker, Team, TeamRequest } from '@/lib/types';

export default function CollaboratePage() {
  return <Suspense fallback={<div className="skeleton h-64 w-full rounded-2xl" />}><AuthGate><CollaborateContent /></AuthGate></Suspense>;
}

function CollaborateContent() {
  const { me } = useAuth();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState('teams');
  const [hackathonId, setHackathonId] = useState(searchParams.get('hackathon') ?? '');
  const [skill, setSkill] = useState('');
  const [teamModal, setTeamModal] = useState(false);
  const [seekerModal, setSeekerModal] = useState(false);
  const [requestTeam, setRequestTeam] = useState<Team | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const catalog = useApi<Paged<Hackathon>>('/hackathons?pageSize=48&status=open');
  const teams = useApi<{ items: Team[] }>('/teams');
  const seekers = useApi<{ items: Seeker[] }>('/seekers');
  const requests = useApi<{ items: TeamRequest[] }>('/team-requests?status=pending');

  const [teamForm, setTeamForm] = useState({ hackathonId: '', title: '', description: '', lookingFor: '', maxSize: 4 });
  const [seekerForm, setSeekerForm] = useState({ hackathonId: '', headline: '', skills: '', availability: 'Weekends' });

  const filteredTeams = useMemo(() => (teams.data?.items ?? []).filter((t) =>
    (!hackathonId || t.hackathonId === hackathonId) &&
    (!skill || [...t.lookingFor, t.title, t.description].join(' ').toLowerCase().includes(skill.toLowerCase()))), [teams.data, hackathonId, skill]);
  const filteredSeekers = useMemo(() => (seekers.data?.items ?? []).filter((s) =>
    (!hackathonId || s.hackathonId === hackathonId) &&
    (!skill || [...s.skills, s.headline].join(' ').toLowerCase().includes(skill.toLowerCase()))), [seekers.data, hackathonId, skill]);
  const myTeams = (teams.data?.items ?? []).filter((t) => t.ownerId === me?.id);
  const mySeekerPosts = (seekers.data?.items ?? []).filter((s) => s.user.id === me?.id);
  const pending = requests.data?.items ?? [];

  const reload = () => { teams.reload(); seekers.reload(); requests.reload(); };

  const createTeam = async () => {
    if (!teamForm.hackathonId || teamForm.title.trim().length < 3) { toast('Pick a hackathon and add a title', 'error'); return; }
    setBusy(true);
    try {
      await api(`/hackathons/${teamForm.hackathonId}/teams`, { method: 'POST', body: {
        title: teamForm.title, description: teamForm.description,
        lookingFor: teamForm.lookingFor.split(',').map((s) => s.trim()).filter(Boolean), maxSize: teamForm.maxSize,
      } });
      toast('Team listing published'); setTeamModal(false); reload(); setTab('my');
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not create team', 'error'); }
    finally { setBusy(false); }
  };

  const createSeeker = async () => {
    if (!seekerForm.hackathonId || seekerForm.headline.trim().length < 4) { toast('Pick a hackathon and write a headline', 'error'); return; }
    setBusy(true);
    try {
      await api('/seekers', { method: 'POST', body: { ...seekerForm, skills: seekerForm.skills.split(',').map((s) => s.trim()).filter(Boolean) } });
      toast('You are visible to teams'); setSeekerModal(false); reload(); setTab('seekers');
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not post', 'error'); }
    finally { setBusy(false); }
  };

  const sendRequest = async () => {
    if (!requestTeam) return;
    setBusy(true);
    try {
      await api(`/teams/${requestTeam.id}/requests`, { method: 'POST', body: { message } });
      toast('Request sent — the owner gets a live notification'); setRequestTeam(null); setMessage(''); reload();
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not send request', 'error'); }
    finally { setBusy(false); }
  };

  const startDm = async (userId: string) => {
    try {
      const result = await api<{ conversation: { id: string } }>('/conversations', { method: 'POST', body: { otherUserId: userId } });
      window.location.href = `/chat/${result.conversation.id}`;
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not open chat', 'error'); }
  };

  const catalogItems = catalog.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="glass relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-violet/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div><Badge tone="violet"><Users size={11} /> Collaborate</Badge>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white">Great teams are <span className="glow-text">built, not found.</span></h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Match by complementary skills, send a request, and get an end-to-end encrypted team chat the moment you are accepted.</p>
          </div>
          <div className="flex flex-wrap gap-2"><Button onClick={() => { setTeamForm({ ...teamForm, hackathonId: hackathonId || catalogItems[0]?.id || '' }); setTeamModal(true); }} variant="primary"><Plus size={15} /> Post a team</Button>
            <Button onClick={() => { setSeekerForm({ ...seekerForm, hackathonId: hackathonId || catalogItems[0]?.id || '' }); setSeekerModal(true); }}><Sparkles size={15} /> I'm looking for a team</Button></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open teams" value={teams.data?.items.length ?? '—'} hint="recruiting now" icon={<Users size={16} />} tone="violet" />
        <Stat label="Builders" value={seekers.data?.items.length ?? '—'} hint="looking for teams" icon={<Sparkles size={16} />} tone="cyan" />
        <Stat label="Your listings" value={myTeams.length + mySeekerPosts.length} hint="published" icon={<Check size={16} />} tone="lime" />
        <Stat label="Requests" value={pending.length} hint="to review" icon={<MessageSquare size={16} />} tone="amber" />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400"><Filter size={14} className="text-cyan" /> Filters</div>
          <Select value={hackathonId} onChange={(e) => setHackathonId(e.target.value)} className="!w-auto min-w-[200px] flex-1 !py-2 sm:max-w-[280px]">
            <option value="">All hackathons</option>{catalogItems.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </Select>
          <div className="relative min-w-[180px] flex-1 sm:max-w-[260px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="Filter by skill…" className="!py-2 !pl-9" /></div>
          {(hackathonId || skill) && <Button size="sm" variant="ghost" onClick={() => { setHackathonId(''); setSkill(''); }}><X size={13} /> Clear</Button>}
        </div>
      </Card>

      <Tabs tabs={[
        { id: 'teams', label: 'Team listings', count: filteredTeams.length },
        { id: 'seekers', label: 'Builders', count: filteredSeekers.length },
        { id: 'my', label: 'My activity', count: myTeams.length + mySeekerPosts.length + pending.length },
      ]} active={tab} onChange={setTab} />

      {tab === 'teams' && (
        teams.loading ? <Loading rows={4} /> : filteredTeams.length === 0 ? <EmptyState icon={<Users size={24} />} title="No teams match" description="Try another hackathon or skill filter — or post your own listing." action={<Button onClick={() => setTeamModal(true)}>Post a team</Button>} /> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {filteredTeams.map((t) => (
              <Card key={t.id} hover className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3"><Avatar name={t.owner.name} hue={t.owner.avatarHue} size={40} /><div><h3 className="text-sm font-bold text-white">{t.title}</h3><div className="text-[11px] text-slate-500">{t.owner.name} · {t.owner.college}</div></div></div>
                  <Badge tone={t.members.length >= t.maxSize ? 'amber' : 'lime'}>{t.members.length}/{t.maxSize}</Badge>
                </div>
                {t.hackathon && <Link href={`/hackathons/${t.hackathon.slug}`} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-cyan hover:underline">{t.hackathon.name} <ArrowRight size={11} /></Link>}
                <p className="mt-3 flex-1 text-xs leading-relaxed text-slate-400">{t.description}</p>
                <div className="mt-3"><div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">Looking for</div><div className="flex flex-wrap gap-1.5">{t.lookingFor.map((s) => <span key={s} className="chip !text-[10px]">{s}</span>)}</div></div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[.06] pt-4">
                  <span className="text-[11px] text-slate-600">Posted {relative(t.createdAt)}</span>
                  {t.ownerId === me?.id ? <Badge tone="cyan">Your listing</Badge>
                    : t.myRequestStatus === 'pending' ? <Badge tone="amber">Request pending</Badge>
                      : t.myRequestStatus === 'accepted' ? <Link href="/chat" className="btn btn-primary !py-2 !text-xs"><MessageSquare size={13} /> Open team chat</Link>
                        : <Button size="sm" variant="primary" onClick={() => { setRequestTeam(t); setMessage(`Hi! I'd love to join ${t.title}. I can help with ${(me?.skills ?? []).slice(0, 2).join(' and ') || 'the build'}.`); }}><Send size={13} /> Request to join</Button>}
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === 'seekers' && (
        seekers.loading ? <Loading rows={4} /> : filteredSeekers.length === 0 ? <EmptyState icon={<Sparkles size={24} />} title="No builders here yet" description="Post yourself as available so teams can find you." action={<Button onClick={() => setSeekerModal(true)}>Post availability</Button>} /> : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredSeekers.map((s) => (
              <Card key={s.id} hover className="p-5">
                <div className="flex items-center gap-3"><Avatar name={s.user.name} hue={s.user.avatarHue} size={42} /><div className="min-w-0"><div className="truncate text-sm font-bold text-white">{s.user.name}</div><div className="truncate text-[11px] text-slate-500">{s.user.college} · {s.user.city}</div></div></div>
                <p className="mt-3 min-h-[40px] text-xs leading-relaxed text-slate-300">{s.headline}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">{s.skills.map((sk) => <span key={sk} className="chip !text-[10px]">{sk}</span>)}</div>
                <div className="mt-4 flex items-center justify-between border-t border-white/[.06] pt-4"><span className="text-[11px] text-slate-600">{s.availability}</span>
                  {s.user.id === me?.id ? <Badge tone="cyan">You</Badge> : <Button size="sm" onClick={() => void startDm(s.user.id)}><MessageSquare size={13} /> Secure chat</Button>}
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === 'my' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-5"><SectionHeader eyebrow="You own" title="Team listings" />
            {myTeams.length === 0 ? <EmptyState title="No listings yet" description="Post a team to start receiving requests." action={<Button onClick={() => setTeamModal(true)}>Post a team</Button>} /> : (
              <div className="space-y-3">{myTeams.map((t) => (
                <div key={t.id} className="glass-soft p-4"><div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-200">{t.title}</span><Badge tone="lime">{t.members.length} members</Badge></div>
                  <div className="mt-3 flex flex-wrap gap-1.5">{t.members.map((m) => <span key={m.id} className="chip !text-[10px]"><Avatar name={m.name} hue={m.avatarHue} size={16} /> {m.name}{m.id !== me?.id && <button className="ml-1 text-rose hover:underline" title="Remove member (rotates chat key)" onClick={async () => { try { await api(`/teams/${t.id}/members/${m.id}`, { method: 'DELETE' }); toast('Member removed · chat key rotated'); reload(); } catch { toast('Could not remove member', 'error'); } }}><X size={10} /></button>}</span>)}</div>
                  <Button size="sm" variant="ghost" className="mt-3 !text-rose" onClick={async () => { try { await api(`/teams/${t.id}`, { method: 'DELETE' }); toast('Listing removed'); reload(); } catch { toast('Could not remove listing', 'error'); } }}><X size={12} /> Delete listing</Button>
                </div>
              ))}</div>
            )}
          </Card>
          <div className="space-y-5">
            <Card className="p-5"><SectionHeader eyebrow="Incoming" title="Join requests" />
              {pending.length === 0 ? <EmptyState title="Nothing to review" description="Requests from other builders appear here in realtime." /> : (
                <div className="space-y-2">{pending.map((r) => (
                  <div key={r.id} className="glass-soft p-3"><div className="text-xs font-semibold text-slate-200">{r.fromUser.name} → {r.teamTitle}</div><p className="mt-1 text-[11px] text-slate-500">{r.message}</p>
                    <div className="mt-3 flex gap-2"><Button size="sm" variant="primary" onClick={async () => { try { await api(`/team-requests/${r.id}`, { method: 'PATCH', body: { accept: true } }); toast('Accepted · encrypted chat created'); reload(); } catch { toast('Could not accept', 'error'); } }}><Check size={12} /> Accept</Button>
                      <Button size="sm" variant="ghost" onClick={async () => { try { await api(`/team-requests/${r.id}`, { method: 'PATCH', body: { accept: false } }); reload(); } catch { /* ignore */ } }}>Decline</Button></div>
                  </div>
                ))}</div>
              )}
            </Card>
            <Card className="p-5"><SectionHeader eyebrow="Visibility" title="Your seeker posts" />
              {mySeekerPosts.length === 0 ? <p className="text-xs text-slate-500">You are not listed as available. Post yourself to be discovered by teams.</p> : mySeekerPosts.map((s) => (
                <div key={s.id} className="glass-soft p-3"><div className="text-xs font-semibold text-slate-200">{s.headline}</div><div className="mt-1 text-[11px] text-slate-500">{s.hackathon?.name ?? 'Hackathon'} · {s.availability}</div></div>
              ))}
              <Button size="sm" className="mt-4" onClick={() => setSeekerModal(true)}><Plus size={13} /> Post availability</Button>
            </Card>
          </div>
        </div>
      )}

      <Modal open={teamModal} onClose={() => setTeamModal(false)} title="Post a team listing" description="Describe what you are building and which skills would complete the team.">
        <div className="space-y-4">
          <Field label="Hackathon"><Select value={teamForm.hackathonId} onChange={(e) => setTeamForm({ ...teamForm, hackathonId: e.target.value })}>
            <option value="">Choose a hackathon…</option>{catalogItems.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </Select></Field>
          <Field label="Team name"><Input value={teamForm.title} onChange={(e) => setTeamForm({ ...teamForm, title: e.target.value })} placeholder="e.g. Orbit Agents" maxLength={100} /></Field>
          <Field label="What are you building?"><Textarea value={teamForm.description} onChange={(e) => setTeamForm({ ...teamForm, description: e.target.value })} placeholder="A short pitch for your idea, what is done, and what help you need." maxLength={1000} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Skills needed" hint="Comma separated"><Input value={teamForm.lookingFor} onChange={(e) => setTeamForm({ ...teamForm, lookingFor: e.target.value })} placeholder="React, UI design, ML" /></Field>
            <Field label="Max team size"><Input type="number" min={2} max={12} value={teamForm.maxSize} onChange={(e) => setTeamForm({ ...teamForm, maxSize: Number(e.target.value) })} /></Field>
          </div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setTeamModal(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void createTeam()}>Publish listing</Button></div>
        </div>
      </Modal>

      <Modal open={seekerModal} onClose={() => setSeekerModal(false)} title="List yourself as available" description="Teams can discover you by skills and open an encrypted chat.">
        <div className="space-y-4">
          <Field label="Hackathon"><Select value={seekerForm.hackathonId} onChange={(e) => setSeekerForm({ ...seekerForm, hackathonId: e.target.value })}>
            <option value="">Choose a hackathon…</option>{catalogItems.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </Select></Field>
          <Field label="Headline"><Input value={seekerForm.headline} onChange={(e) => setSeekerForm({ ...seekerForm, headline: e.target.value })} placeholder="Frontend dev who ships in 48 hours" maxLength={140} /></Field>
          <Field label="Your skills" hint="Comma separated"><Input value={seekerForm.skills} onChange={(e) => setSeekerForm({ ...seekerForm, skills: e.target.value })} placeholder="React, TypeScript, Figma" /></Field>
          <Field label="Availability"><Select value={seekerForm.availability} onChange={(e) => setSeekerForm({ ...seekerForm, availability: e.target.value })}>
            {['Weekends', 'Full weekend', 'Evenings', 'Flexible'].map((a) => <option key={a}>{a}</option>)}
          </Select></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setSeekerModal(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void createSeeker()}>Post availability</Button></div>
        </div>
      </Modal>

      <Modal open={Boolean(requestTeam)} onClose={() => setRequestTeam(null)} title={`Join ${requestTeam?.title ?? 'team'}`} description="Your request is delivered live to the team owner.">
        <div className="space-y-4">
          <Field label="Intro message"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} /></Field>
          <div className="flex items-start gap-2 rounded-xl border border-cyan/20 bg-cyan/[.05] p-3 text-[11px] leading-relaxed text-slate-400"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-cyan" /> If accepted, an encrypted conversation is created and the chat key is wrapped for each member individually.</div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setRequestTeam(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void sendRequest()}><Send size={14} /> Send request</Button></div>
        </div>
      </Modal>
    </div>
  );
}
