'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Database, KeyRound, LockKeyhole, ShieldCheck, Wifi } from 'lucide-react';
import { Badge, Card, SectionHeader } from '@/components/ui';

const LAYERS = [
  { icon: KeyRound, title: 'Login', items: ['Argon2id password hashing (64 MiB, t=3) with a per-user salt', 'TOTP 2FA (RFC 6238) + single-use hashed recovery codes', '15-minute sessions with rotating refresh tokens in HttpOnly cookies', 'Dummy-hash verification for unknown accounts to prevent timing enumeration'] },
  { icon: ShieldCheck, title: 'Request hardening', items: ['Same-origin checks and session-bound CSRF tokens on every write', 'Zod validation, 32 KB body caps and per-route sliding-window rate limits', 'Strict security headers: CSP with per-request nonce, COOP, Referrer-Policy, Permissions-Policy', 'Audit log for authentication, admin and data-changing events'] },
  { icon: LockKeyhole, title: 'Data at rest', items: ['Layer 1: browser AES-256-GCM vault keyed by PBKDF2-SHA256 (210k iterations)', 'Layer 2: server AES-256-GCM envelope with per-user HKDF data keys', 'Sensitive application notes and calendar notes encrypted before storage', 'TOTP secrets and recovery codes encrypted / hashed at rest'] },
  { icon: Wifi, title: 'Encrypted chat', items: ['Non-extractable P-256 device private key stored in IndexedDB', 'ECDH → HKDF-SHA256 wraps a random AES-256-GCM conversation key per member', 'Fresh 96-bit nonce per message; server stores ciphertext only', 'WebSocket auth via one-time 30-second ticket + cross-origin handshake rejection', 'Key rotation when team membership changes'] },
];

export default function PrivacyPage() {
  return (
    <div className="space-y-6">
      <div className="glass relative overflow-hidden p-6 sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-32 h-96 w-96 rounded-full bg-violet/10 blur-[100px]" />
        <div className="relative max-w-3xl"><Badge tone="violet"><ShieldCheck size={11} /> Privacy & security</Badge>
          <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">Your data, <span className="glow-text">encrypted in layers.</span></h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-400 sm:text-base">This page explains exactly what Tech Pulse does with your data and where the cryptographic boundaries sit. No vague promises — just the mechanisms implemented in this codebase.</p></div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">{LAYERS.map((layer) => (
        <Card key={layer.title} className="p-6"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan/10 text-cyan"><layer.icon size={19} /></span><h2 className="text-base font-bold text-white">{layer.title}</h2></div>
          <ul className="mt-4 space-y-2.5">{layer.items.map((i) => <li key={i} className="flex gap-2.5 text-xs leading-relaxed text-slate-400"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-lime" />{i}</li>)}</ul></Card>
      ))}</div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6"><SectionHeader eyebrow="What is stored" title="Plaintext vs ciphertext" />
          <div className="overflow-hidden rounded-xl border border-white/[.06]">
            <div className="grid grid-cols-2 bg-white/[.04] px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><span>Plaintext (necessary)</span><span>Encrypted / hashed</span></div>
            {[
              ['Name, college, city, skills', 'Application & calendar notes'],
              ['Public hackathon listings', 'Private vault contents (×2)'],
              ['Public device keys', 'TOTP secret'],
              ['Team listings & requests', 'Password (Argon2id hash)'],
              ['Timestamps & audit actions', 'Chat messages (E2EE ciphertext)'],
            ].map(([a, b]) => <div key={a} className="grid grid-cols-2 border-t border-white/[.05] px-4 py-2.5 text-[11px]"><span className="text-slate-400">{a}</span><span className="text-cyan">{b}</span></div>)}
          </div>
          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-500"><Database size={14} className="mt-0.5 shrink-0" />IP addresses are stored only as truncated hashes in the audit log and click log.</p>
        </Card>
        <Card className="p-6"><SectionHeader eyebrow="Honest caveats" title="What this demo does not do" />
          <ul className="space-y-3 text-xs leading-relaxed text-slate-400">{[
            'No email or SMS provider is wired up: verification and reset codes are shown in the UI in development only.',
            'Web push is represented by browser notifications + stored subscriptions; a production deploy needs VAPID keys and a push service.',
            'Rate limiting is in-process — production should use Redis/Upstash across instances.',
            'The demo uses a generated local master key and SQLite. Production requires KMS-managed secrets and a managed database.',
            'True E2EE means a lost device loses history unless you back up the encrypted key; this build stores device keys only in that browser.',
            'Routes and food suggestions use curated local data; production can point to OSRM/Overpass or Google Places.',
          ].map((t) => <li key={t} className="flex gap-2.5"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber" />{t}</li>)}</ul>
        </Card>
      </div>

      <Card className="p-6"><SectionHeader eyebrow="Your controls" title="You are in charge" />
        <div className="flex flex-wrap gap-3"><Link href="/settings" className="btn btn-primary"><LockKeyhole size={15} /> Manage vault & 2FA</Link><Link href="/settings" className="btn btn-outline">Export your data</Link><Link href="/settings" className="btn btn-outline">Delete account</Link></div>
        <p className="mt-4 text-xs text-slate-500">Session cookies are HttpOnly and SameSite=Lax; refreshing rotates the token and revokes the previous one. Admin endpoints additionally require an MFA-verified session.</p>
      </Card>
    </div>
  );
}
