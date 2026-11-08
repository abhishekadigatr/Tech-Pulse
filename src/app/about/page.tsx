'use client';

import Link from 'next/link';
import { ArrowRight, Compass, Inbox, LockKeyhole, CalendarDays, Map, ShieldCheck, Users, Zap } from 'lucide-react';
import { Badge, Card, SectionHeader } from '@/components/ui';

const FLOW = [
  { icon: Compass, step: '01', title: 'Discover', text: 'Curated and feed-ingested listings with filters for mode, city, tag and deadline.' },
  { icon: Zap, step: '02', title: 'Apply directly', text: 'A logged, validated HTTPS redirect to the organiser’s official page. No credential collection.' },
  { icon: Inbox, step: '03', title: 'Track in inbox', text: 'Mark “I applied”; manage statuses and private encrypted notes in a unified inbox.' },
  { icon: Users, step: '04', title: 'Collaborate', text: 'Team listings, skill-matched seekers, join requests and automatic encrypted chat.' },
  { icon: CalendarDays, step: '05', title: 'Get reminded', text: 'Deadlines, study blocks and event dates with 7d / 1d / 2h reminders and an ICS feed.' },
  { icon: Map, step: '06', title: 'Travel smarter', text: 'Route-aware food, fuel, rest and ATM suggestions plus a packing checklist.' },
];

export default function AboutPage() {
  return (
    <div className="space-y-6">
      <div className="glass relative overflow-hidden p-6 sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-32 h-96 w-96 rounded-full bg-cyan/10 blur-[100px]" />
        <div className="relative max-w-3xl"><Badge tone="cyan"><Zap size={11} /> About Tech Pulse</Badge>
          <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">One secure workspace for <span className="glow-text">the whole hackathon journey.</span></h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-400 sm:text-base">Tech Pulse replaces the scattered spreadsheet of hackathon links, the group chat with no encryption, the calendar you forgot to update, and the frantic search for a decent meal near the venue. Everything lives in one coherent flow — from the first listing to demo day.</p>
          <div className="mt-6 flex flex-wrap gap-3"><Link href="/hackathons" className="btn btn-primary"><Compass size={15} /> Explore hackathons</Link><Link href="/privacy" className="btn btn-outline"><ShieldCheck size={15} /> How we protect you</Link></div>
        </div>
      </div>

      <section><SectionHeader eyebrow="The flow" title="Six connected steps, zero duplicated tools" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{FLOW.map((f) => (
          <Card key={f.step} hover className="p-5"><div className="flex items-center justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[.05] text-cyan"><f.icon size={19} /></span><span className="font-mono text-xs text-slate-700">{f.step}</span></div>
            <h3 className="mt-4 text-sm font-bold text-white">{f.title}</h3><p className="mt-1.5 text-xs leading-relaxed text-slate-500">{f.text}</p></Card>
        ))}</div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6"><SectionHeader eyebrow="Architecture" title="One codebase, one database" />
          <div className="space-y-2 text-xs text-slate-400">{[
            ['Frontend', 'Next.js 15 App Router · React 19 · TypeScript · Tailwind'],
            ['API', 'Single /api/v1 router with shared validation, auth, CSRF and rate limits'],
            ['Realtime', 'ws WebSocket gateway on the same port, one shared client connection'],
            ['Storage', 'SQLite (node:sqlite) with FK constraints, WAL and idempotent seeds'],
            ['Jobs', 'Idempotent in-process reminder sweep + optional HTTPS feed ingestion'],
            ['Crypto', 'WebCrypto in the browser · AES-256-GCM + HKDF + Argon2id on the server'],
          ].map(([k, v]) => <div key={k} className="flex gap-3 rounded-lg bg-white/[.02] p-3"><span className="w-20 shrink-0 font-semibold text-cyan">{k}</span><span>{v}</span></div>)}</div>
        </Card>
        <Card className="p-6"><SectionHeader eyebrow="Design principles" title="Built without redundancy" />
          <ul className="space-y-3 text-sm text-slate-400">{[
            'One shared type surface across server, API and UI.',
            'One API router instead of dozens of duplicated route files.',
            'One encrypted-message write path shared by WebSocket and REST.',
            'One realtime socket per browser, reused by chat and notifications.',
            'One database with FK-enforced relations — no parallel caches of truth.',
          ].map((t) => <li key={t} className="flex gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />{t}</li>)}</ul>
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-cyan/20 bg-cyan/[.05] p-3 text-xs text-slate-400"><LockKeyhole size={15} className="shrink-0 text-cyan" />Security is a feature, not a footer note. <Link href="/privacy" className="font-semibold text-cyan hover:underline">Read the details <ArrowRight size={11} className="inline" /></Link></div>
        </Card>
      </div>
    </div>
  );
}
