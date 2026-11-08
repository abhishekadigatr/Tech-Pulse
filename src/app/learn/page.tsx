'use client';

import Link from 'next/link';
import { BookOpen, Check, Compass, Lightbulb, Rocket, Trophy, Users, Zap } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Progress, SectionHeader, Tabs, cn } from '@/components/ui';

const PHASES = {
  before: [
    { title: 'Pick a scope you can demo', text: 'One problem, one happy path, one wow moment. A finished small idea beats an unfinished platform every time.' },
    { title: 'Read the rules twice', text: 'Team size, eligibility, allowed libraries, IP terms and submission format. Ten minutes here saves a disqualification.' },
    { title: 'Build the team deliberately', text: 'Complementary skills beat four identical developers. Use Collaborate to find a designer, a backend dev or a storyteller.' },
    { title: 'Set three reminders', text: 'Seven days for the idea, one day for the submission, two hours for check-in. Tech Pulse adds these automatically.' },
    { title: 'Prep your environment', text: 'Clone repos, verify API keys, test the deploy pipeline and charge everything the night before.' },
  ],
  during: [
    { title: 'Ship a vertical slice by hour 6', text: 'End-to-end flow working early, even if ugly. Integrate continuously instead of merging on the last night.' },
    { title: 'Talk to mentors early', text: 'Ask about the judging criteria and the story, not just the code. Bring a 30-second demo.' },
    { title: 'Keep a decision log', text: 'Write down why you cut features — it becomes your pitch and your README.' },
    { title: 'Sleep and eat properly', text: 'Use the Journey planner for food and rest stops near the venue. A tired team ships bugs.' },
    { title: 'Rehearse the 3-minute demo', text: 'One presenter, one screen, one backup video. Practise twice before the jury arrives.' },
  ],
  after: [
    { title: 'Publish the repo and a short write-up', text: 'Clean README, screenshots, setup steps. Recruiters and future teammates will actually read it.' },
    { title: 'Update your pipeline', text: 'Move the application to Shortlisted or Participating and keep your private notes for next time.' },
    { title: 'Thank your team and mentors', text: 'A short message builds the network that gets you into the next hackathon.' },
    { title: 'Write down three lessons', text: 'What to reuse, what to cut, what to learn. Your second hackathon will be twice as good.' },
  ],
};

export default function LearnPage() {
  const [phase, setPhase] = useState('before');
  const [done, setDone] = useState<Set<string>>(new Set());
  const items = PHASES[phase as keyof typeof PHASES];
  const toggle = (key: string) => setDone((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });

  return (
    <div className="space-y-6">
      <div className="glass relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-lime/10 blur-3xl" />
        <div className="relative"><Badge tone="lime"><BookOpen size={11} /> The playbook</Badge>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">A better hackathon <span className="glow-text">journey.</span></h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">Hard-won, practical tips for the days before, the 48 hours during, and the follow-up after — plus the route tips that make travel painless.</p></div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icon: Compass, label: 'Choose wisely', value: '01' },
          { icon: Users, label: 'Build the team', value: '02' },
          { icon: Zap, label: 'Ship the slice', value: '03' },
          { icon: Trophy, label: 'Tell the story', value: '04' },
        ].map((s) => <Card key={s.label} className="p-4"><div className="flex items-center justify-between"><s.icon size={17} className="text-cyan" /><span className="font-mono text-xs text-slate-700">{s.value}</span></div><div className="mt-3 text-sm font-semibold text-white">{s.label}</div></Card>)}
      </div>

      <Card className="p-5 sm:p-6">
        <Tabs tabs={[{ id: 'before', label: 'Before' }, { id: 'during', label: 'During' }, { id: 'after', label: 'After' }]} active={phase} onChange={setPhase} />
        <div className="mt-5"><div className="mb-4 flex items-center justify-between text-xs text-slate-500"><span>Your progress through this phase</span><span>{done.size}/{items.length * Object.keys(PHASES).length} total tips</span></div><Progress value={(done.size / (items.length * 3)) * 100} tone="lime" /></div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {items.map((tip, i) => {
            const key = `${phase}-${i}`;
            return <button key={key} onClick={() => toggle(key)} className={cn('flex items-start gap-3 rounded-xl border p-4 text-left transition', done.has(key) ? 'border-lime/30 bg-lime/[.05]' : 'border-white/[.06] bg-white/[.02] hover:border-white/15')}>
              <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border', done.has(key) ? 'border-lime bg-lime text-[#04121a]' : 'border-white/20 text-transparent')}><Check size={13} /></span>
              <span><span className={cn('block text-sm font-semibold', done.has(key) ? 'text-slate-500 line-through' : 'text-white')}>{tip.title}</span><span className="mt-1 block text-xs leading-relaxed text-slate-400">{tip.text}</span></span>
            </button>;
          })}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6"><SectionHeader eyebrow="On the road" title="Journey tips, not just checklists" />
          <p className="text-sm leading-relaxed text-slate-400">For in-person events, Tech Pulse ranks restaurants, cafés, fuel, ATMs and rest stops along your route by rating, detour time and whether they are open right now. It also generates a packing checklist tuned to your travel mode and the event length.</p>
          <div className="mt-4 flex flex-wrap gap-2"><Badge tone="amber">Food nearby</Badge><Badge tone="cyan">Fuel &amp; rest</Badge><Badge tone="lime">Packing list</Badge></div>
          <Link href="/journey" className="btn btn-primary mt-5"><Rocket size={15} /> Open journey planner</Link>
        </Card>
        <Card className="p-6"><SectionHeader eyebrow="One more thing" title="Find people who complement you" />
          <p className="text-sm leading-relaxed text-slate-400">The fastest way to level up is a teammate who does something you cannot. Post a listing with the skills you need, or list yourself as available — accepted requests unlock an encrypted team chat instantly.</p>
          <div className="mt-4 flex flex-wrap gap-2"><Badge tone="violet">Skill matching</Badge><Badge tone="cyan">Encrypted chat</Badge></div>
          <Link href="/collaborate" className="btn btn-outline mt-5"><Users size={15} /> Find teammates</Link>
        </Card>
      </div>
    </div>
  );
}
