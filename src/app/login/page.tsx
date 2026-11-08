'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, Check, Fingerprint, KeyRound, LockKeyhole, Mail,
  ShieldCheck, Sparkles, Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useAuth, useToast } from '@/components/providers';
import { Badge, Button, ErrorNote, Field, Input, SuccessNote, cn } from '@/components/ui';

type Mode = 'login' | 'register' | 'verify' | 'mfa' | 'forgot' | 'reset';

export default function LoginPage() {
  const router = useRouter();
  const { me, refreshMe } = useAuth();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hint, setHint] = useState<{ demo: { email: string; password: string }; admin: { email: string; password: string; totpCode: string } } | null>(null);

  useEffect(() => { void api<typeof hint>('/auth/dev-hint').then(setHint).catch(() => null); }, []);
  useEffect(() => { if (me) router.replace('/'); }, [me, router]);

  const submit = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      if (mode === 'login') {
        const result = await api<{ mfaRequired?: boolean; challengeToken?: string; message?: string; me?: unknown }>('/auth/login', { method: 'POST', body: { email, password } });
        if (result.mfaRequired && result.challengeToken) { setChallengeToken(result.challengeToken); setMode('mfa'); setNotice(result.message ?? 'Enter your authenticator code'); }
        else { await refreshMe(); toast('Signed in'); router.replace('/'); }
      } else if (mode === 'register') {
        const result = await api<{ devCode?: string; message: string }>('/auth/register', { method: 'POST', body: { email, password, name, college: '', city: '', skills: [] } });
        setCode(result.devCode ?? ''); setMode('verify'); setNotice(result.message);
      } else if (mode === 'verify') {
        await api('/auth/verify-email', { method: 'POST', body: { email, code } });
        toast('Email verified — you can sign in now'); setMode('login'); setNotice('Email verified. Sign in with your password.');
      } else if (mode === 'mfa') {
        await api('/auth/2fa/verify', { method: 'POST', body: { challengeToken, code } });
        await refreshMe(); toast('MFA verified'); router.replace('/');
      } else if (mode === 'forgot') {
        const result = await api<{ devCode?: string; message: string }>('/auth/forgot-password', { method: 'POST', body: { email } });
        setCode(result.devCode ?? ''); setNotice(result.message); setMode('reset');
      } else if (mode === 'reset') {
        await api('/auth/reset-password', { method: 'POST', body: { email, code, password } });
        toast('Password reset. Sign in with your new password.'); setMode('login'); setNotice('Password updated.');
      }
    } catch (err) {
      const e = err as { message?: string; code?: string };
      setError(e.message ?? 'Something went wrong');
      if (e.code === 'EMAIL_UNVERIFIED') { setMode('verify'); setNotice('Verify your email to continue.'); }
    } finally { setBusy(false); }
  };

  const titles: Record<Mode, { title: string; sub: string }> = {
    login: { title: 'Welcome back', sub: 'Sign in to your hackathon command centre.' },
    register: { title: 'Create your account', sub: 'One account for discovery, teams, reminders and encrypted chat.' },
    verify: { title: 'Verify your email', sub: 'Enter the 6-digit code sent to your inbox.' },
    mfa: { title: 'Two-factor check', sub: 'Enter the 6-digit code from your authenticator app or a recovery code.' },
    forgot: { title: 'Reset your password', sub: 'We will send a short-lived reset code to your email.' },
    reset: { title: 'Choose a new password', sub: 'Enter the reset code and a new strong password.' },
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-8">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-cyan/10 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-violet/10 blur-[120px]" />

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/[.08] bg-[#0a101d]/80 shadow-2xl backdrop-blur-2xl lg:grid-cols-[1fr_1fr]">
        {/* Brand panel */}
        <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[.06] p-9 lg:flex">
          <div className="absolute inset-0" style={{ background: 'radial-gradient(600px 400px at 20% 0%, rgba(53,230,208,.10), transparent)' }} />
          <div className="relative"><Link href="/" className="flex items-center gap-2.5">
            <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan to-violet text-[#04121a]"><Zap size={21} fill="currentColor" /></span>
            <span><span className="block text-base font-extrabold tracking-tight text-white">Tech Pulse</span><span className="block text-[10px] uppercase tracking-[.18em] text-cyan/70">Hackathon OS</span></span>
          </Link></div>
          <div className="relative">
            <Badge tone="cyan"><Sparkles size={11} /> Built for student builders</Badge>
            <h2 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-white">From the first<br /><span className="glow-text">idea to demo day.</span></h2>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">Discover verified hackathons, jump to official applications, track your pipeline, find teammates, chat privately, and show up prepared.</p>
            <div className="mt-8 space-y-3">{[
              { icon: ShieldCheck, text: 'Argon2id passwords + TOTP 2FA' },
              { icon: LockKeyhole, text: 'Two-step encrypted private vault' },
              { icon: Fingerprint, text: 'End-to-end encrypted WebSocket chat' },
            ].map((f) => <div key={f.text} className="flex items-center gap-3 text-xs text-slate-300"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[.05] text-cyan"><f.icon size={15} /></span>{f.text}</div>)}</div>
          </div>
          <div className="relative text-[11px] text-slate-600">© {new Date().getFullYear()} Tech Pulse · Secure by design</div>
        </div>

        {/* Form panel */}
        <div className="p-6 sm:p-9">
          <div className="mb-7 flex items-center justify-between">
            <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-cyan"><ArrowLeft size={13} /> Back home</Link>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-lime" /> Secure session</span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">{titles[mode].title}</h1>
          <p className="mt-1.5 text-sm text-slate-400">{titles[mode].sub}</p>

          <div className="mt-7 space-y-4">
            {mode === 'register' && <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Aarav Rao" autoComplete="name" /></Field>}
            {mode !== 'mfa' && <Field label="Email"><div className="relative"><Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@college.edu" type="email" autoComplete="email" className="!pl-9" /></div></Field>}
            {(mode === 'login' || mode === 'register' || mode === 'reset') && <Field label="Password" hint={mode === 'register' ? 'At least 10 characters with a letter and a number' : undefined}><div className="relative"><LockKeyhole size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="!pl-9" /></div></Field>}
            {(mode === 'verify' || mode === 'mfa' || mode === 'reset') && <Field label={mode === 'mfa' ? 'Authenticator / recovery code' : '6-digit code'}><div className="relative"><KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" inputMode="numeric" className="!pl-9 font-mono tracking-widest" maxLength={20} /></div></Field>}
            {error && <ErrorNote message={error} />}
            {notice && <SuccessNote><span>{notice}</span></SuccessNote>}
            <Button variant="primary" className="w-full !py-3" loading={busy} onClick={() => void submit()}>
              {mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : mode === 'verify' ? 'Verify email' : mode === 'mfa' ? 'Verify & sign in' : mode === 'forgot' ? 'Send reset code' : 'Reset password'}
              <ArrowRight size={15} />
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs">
            {mode === 'login' ? <>
              <button onClick={() => { setMode('forgot'); setError(null); }} className="text-slate-400 hover:text-cyan">Forgot password?</button>
              <button onClick={() => { setMode('register'); setError(null); }} className="font-semibold text-cyan hover:underline">Create an account</button>
            </> : <button onClick={() => { setMode('login'); setError(null); setNotice(null); }} className="text-slate-400 hover:text-cyan">← Back to sign in</button>}
          </div>

          {hint && (mode === 'login' || mode === 'mfa') && (
            <div className="mt-7 rounded-xl border border-white/[.07] bg-white/[.02] p-4">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400"><Sparkles size={12} className="text-cyan" /> Development shortcuts</div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => { setMode('login'); setEmail(hint.demo.email); setPassword(hint.demo.password); setError(null); }}>Fill demo account</Button>
                <Button size="sm" onClick={() => { setMode('login'); setEmail(hint.admin.email); setPassword(hint.admin.password); setError(null); }}>Fill admin (MFA)</Button>
                {mode === 'mfa' && <Button size="sm" variant="primary" onClick={() => setCode(hint.admin.totpCode)}><Check size={12} /> Use current admin code</Button>}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-600">Demo accounts are seeded only outside production. Admin access requires the TOTP step.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
