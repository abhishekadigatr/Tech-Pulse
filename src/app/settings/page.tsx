'use client';

import {
  Copy, Download, Fingerprint, KeyRound, Laptop, LockKeyhole, LogOut, ShieldCheck,
  Smartphone, Trash2, UserRound, Bell, Palette, Check, Eye, EyeOff,
} from 'lucide-react';
import { useState } from 'react';
import { api, useApi } from '@/lib/api-client';
import { AuthGate } from '@/components/AppShell';
import { useAuth, useToast } from '@/components/providers';
import {
  deriveVaultKey, decryptVault, encryptVault, getVaultKey, newVaultSalt, setVaultKey,
} from '@/lib/client-crypto';
import { Badge, Button, Card, ErrorNote, Field, Input, Loading, SectionHeader, Select, SuccessNote, Tabs, Textarea, Toggle, cn } from '@/components/ui';
import { fmtDateTime, relative } from '@/lib/format';
import type { Me, UserSettings } from '@/lib/types';

interface VaultRecord { phone: string; emergency: string; links: string; notes: string }
const EMPTY_VAULT: VaultRecord = { phone: '', emergency: '', links: '', notes: '' };

export default function SettingsPage() {
  return <AuthGate><SettingsContent /></AuthGate>;
}

function SettingsContent() {
  const { me, refreshMe, logout } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState(() => !me?.totpEnabled ? 'security' : 'profile');
  const [profile, setProfile] = useState({ name: me?.name ?? '', college: me?.college ?? '', city: me?.city ?? '', skills: (me?.skills ?? []).join(', '), bio: me?.bio ?? '' });
  const [prefs, setPrefs] = useState<UserSettings | null>(me?.settings ?? null);
  const [busy, setBusy] = useState(false);

  const saveProfile = async () => {
    setBusy(true);
    try {
      await api('/users/me', { method: 'PATCH', body: { ...profile, skills: profile.skills.split(',').map((s) => s.trim()).filter(Boolean) } });
      await refreshMe(); toast('Profile updated');
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not save', 'error'); }
    finally { setBusy(false); }
  };

  const updatePref = async <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setPrefs((p) => p ? { ...p, [key]: value } : p);
    try { await api('/users/me/settings', { method: 'PATCH', body: { [key]: value } }); await refreshMe(); }
    catch { toast('Could not save preference', 'error'); }
  };

  if (!me) return <Loading rows={4} />;

  return (
    <div className="space-y-6">
      <div className="glass relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-violet/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan to-violet text-2xl font-extrabold text-[#04121a]">{me.name.slice(0, 1)}</div>
          <div className="min-w-0 flex-1"><Badge tone="cyan"><ShieldCheck size={11} /> Account & security</Badge>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white">{me.name}</h1>
            <p className="mt-1 text-sm text-slate-400">{me.email} · {me.college || 'Add your college'} · joined {fmtDateTime(me.createdAt)}</p></div>
          <div className="flex flex-wrap gap-2"><Badge tone={me.emailVerified ? 'lime' : 'amber'}>{me.emailVerified ? 'Email verified' : 'Email pending'}</Badge><Badge tone={me.totpEnabled ? 'lime' : 'rose'}>{me.totpEnabled ? '2FA enabled' : '2FA off'}</Badge><Badge tone="violet">{me.aal2 ? 'MFA session' : 'Standard session'}</Badge></div>
        </div>
      </div>

      {!me.totpEnabled && <div className="rounded-xl border border-amber/30 p-4 text-sm text-amber">Set up two-factor authentication to access your workspace and settings.</div>}
      {me.totpEnabled && <Tabs tabs={[
        { id: 'profile', label: 'Profile' }, { id: 'preferences', label: 'Preferences' },
        { id: 'security', label: 'Security' }, { id: 'vault', label: 'Private vault' }, { id: 'data', label: 'Your data' },
      ]} active={tab} onChange={setTab} />}

      {tab === 'profile' && (
        <Card className="p-6"><SectionHeader eyebrow="Public profile" title="How teammates see you" subtitle="Visible according to your privacy setting. Used for teammate matching." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} maxLength={80} /></Field>
            <Field label="College / organisation"><Input value={profile.college} onChange={(e) => setProfile({ ...profile, college: e.target.value })} maxLength={120} /></Field>
            <Field label="City"><Input value={profile.city} onChange={(e) => setProfile({ ...profile, city: e.target.value })} maxLength={80} /></Field>
            <Field label="Skills" hint="Comma separated"><Input value={profile.skills} onChange={(e) => setProfile({ ...profile, skills: e.target.value })} placeholder="React, Python, Figma" /></Field>
          </div>
          <Field label="Short bio" className="mt-4"><Textarea value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} maxLength={500} /></Field>
          <div className="mt-5 flex justify-end"><Button variant="primary" loading={busy} onClick={() => void saveProfile()}>Save profile</Button></div>
        </Card>
      )}

      {tab === 'preferences' && prefs && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-6"><SectionHeader eyebrow="Notifications" title="How we nudge you" />
            <div className="divide-y divide-white/[.05]">
              <Toggle checked={prefs.notifyInApp} onChange={(v) => void updatePref('notifyInApp', v)} label="In-app notifications" hint="Unified inbox and live badge" />
              <Toggle checked={prefs.notifyPush} onChange={(v) => void updatePref('notifyPush', v)} label="Browser / push reminders" hint="Works with the installed PWA" />
              <Toggle checked={prefs.notifyEmail} onChange={(v) => void updatePref('notifyEmail', v)} label="Email digest" hint="Requires a mail provider in production" />
              <Toggle checked={prefs.weeklyDigest} onChange={(v) => void updatePref('weeklyDigest', v)} label="Weekly opportunity digest" hint="Fresh hackathons matching your skills" />
              <Toggle checked={prefs.showJourneyTips} onChange={(v) => void updatePref('showJourneyTips', v)} label="Journey tips" hint="Food, fuel and rest stops on your route" />
            </div>
            <Field label="Default reminder offsets" className="mt-5"><Select value={String(prefs.reminderOffsets[0])} onChange={(e) => void updatePref('reminderOffsets', [Number(e.target.value), 120])}>
              <option value="10080">7 days before</option><option value="1440">1 day before</option><option value="120">2 hours before</option>
            </Select></Field>
          </Card>
          <Card className="p-6"><SectionHeader eyebrow="Appearance & privacy" title="Your workspace" />
            <Field label="Theme"><Select value={prefs.theme} onChange={(e) => void updatePref('theme', e.target.value as UserSettings['theme'])}>
              <option value="nebula">Nebula (cyan)</option><option value="aurora">Aurora (lime)</option><option value="midnight">Midnight (violet)</option>
            </Select></Field>
            <Field label="Profile visibility" className="mt-4" hint="Controls how other builders can discover you"><Select value={prefs.profileVisibility} onChange={(e) => void updatePref('profileVisibility', e.target.value as UserSettings['profileVisibility'])}>
              <option value="public">Public to signed-in builders</option><option value="team-only">Only my teams</option><option value="private">Private</option>
            </Select></Field>
            <div className="mt-6 rounded-xl border border-cyan/20 bg-cyan/[.05] p-4 text-xs leading-relaxed text-slate-400"><Palette size={14} className="mb-2 text-cyan" />Theme and privacy changes are persisted server-side and applied instantly across your session.</div>
          </Card>
        </div>
      )}

      {tab === 'security' && <SecurityTab me={me} refreshMe={refreshMe} logout={logout} />}
      {tab === 'vault' && <VaultTab />}
      {tab === 'data' && <DataTab logout={logout} />}
    </div>
  );
}

/* ── 2FA + sessions ─────────────────────────────────────────────────────── */
function SecurityTab({ me, refreshMe, logout }: { me: Me; refreshMe: () => Promise<Me | null>; logout: () => Promise<void> }) {
  const { toast } = useToast();
  const sessions = useApi<{ items: Array<{ id: string; userAgent: string; createdAt: number; expiresAt: number; current: boolean }> }>('/auth/sessions');
  const [setup, setSetup] = useState<{ qr: string; secret: string; recoveryCodes: string[] } | null>(null);
  const [code, setCode] = useState('');
  const [disable, setDisable] = useState({ code: '', password: '' });
  const [busy, setBusy] = useState(false);

  const startSetup = async () => {
    setBusy(true);
    try { setSetup(await api('/auth/2fa/setup', { method: 'POST' })); }
    catch (err) { toast(err instanceof Error ? err.message : 'Could not start 2FA setup', 'error'); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true);
    try { await api('/auth/2fa/confirm', { method: 'POST', body: { code } }); await refreshMe(); setSetup(null); setCode(''); toast('Two-factor authentication is now active'); }
    catch (err) { toast(err instanceof Error ? err.message : 'Invalid code', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-6"><SectionHeader eyebrow="Step 2 of login" title="Two-factor authentication" subtitle="Password + TOTP from an authenticator app. Admin access requires an MFA-verified session." />
        {me.totpEnabled ? (
          <div className="space-y-4"><SuccessNote>2FA is active on this account. Your current session is {me.aal2 ? 'MFA-verified' : 'standard'}.</SuccessNote>
            <Field label="Authenticator code"><Input value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value })} placeholder="000000" inputMode="numeric" maxLength={20} /></Field>
            <Field label="Confirm password"><Input type="password" value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} /></Field>
            <Button variant="danger" loading={busy} onClick={async () => { setBusy(true); try { await api('/auth/2fa/disable', { method: 'POST', body: disable }); await refreshMe(); toast('2FA disabled'); } catch (err) { toast(err instanceof Error ? err.message : 'Could not disable', 'error'); } finally { setBusy(false); } }}>Disable 2FA</Button>
          </div>
        ) : setup ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-white/[.07] bg-white p-4"><img src={setup.qr} alt="Authenticator QR code" width={180} height={180} /><span className="text-[11px] font-semibold text-slate-700">Scan with your authenticator app</span></div>
            <div className="flex items-center gap-2 rounded-xl bg-black/30 p-3"><code className="flex-1 break-all font-mono text-[11px] text-cyan">{setup.secret}</code>
              <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(setup.secret); toast('Secret copied'); }}><Copy size={13} /></Button></div>
            <div><div className="label">Recovery codes — store these offline</div><div className="grid grid-cols-2 gap-1.5">{setup.recoveryCodes.map((c) => <code key={c} className="rounded-lg bg-white/[.04] px-2 py-1.5 font-mono text-[11px] text-slate-300">{c}</code>)}</div></div>
            <Field label="Enter the 6-digit code to confirm"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" inputMode="numeric" maxLength={20} /></Field>
            <div className="flex gap-2"><Button variant="primary" loading={busy} onClick={() => void confirm()}><Check size={14} /> Enable 2FA</Button><Button variant="ghost" onClick={() => setSetup(null)}>Cancel</Button></div>
          </div>
        ) : (
          <div className="space-y-4"><div className="rounded-xl border border-white/[.07] bg-white/[.02] p-4 text-xs leading-relaxed text-slate-400"><Fingerprint size={18} className="mb-2 text-cyan" />Add a second step to sign-in with a time-based one-time password. Secrets are encrypted at rest with AES-256-GCM; recovery codes are stored as salted hashes.</div>
            <Button variant="primary" loading={busy} onClick={() => void startSetup()}><KeyRound size={15} /> Set up authenticator</Button></div>
        )}
      </Card>

      <div className="space-y-5">
        <Card className="p-6"><SectionHeader eyebrow="Access" title="Active sessions" subtitle="Short-lived sessions with rotating refresh tokens." />
          {sessions.loading ? <Loading rows={3} /> : <div className="space-y-2">{(sessions.data?.items ?? []).map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl border border-white/[.06] bg-white/[.02] p-3">
              <Laptop size={16} className="text-violet" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-slate-200">{s.userAgent || 'Unknown device'} {s.current && <Badge tone="lime">This device</Badge>}</div><div className="text-[10px] text-slate-500">Started {relative(s.createdAt)} · expires {fmtDateTime(s.expiresAt)}</div></div>
              {!s.current && <Button size="sm" variant="ghost" onClick={async () => { try { await api(`/auth/sessions/${s.id}`, { method: 'DELETE' }); sessions.reload(); toast('Session revoked'); } catch { toast('Could not revoke', 'error'); } }}><LogOut size={13} /></Button>}
            </div>
          ))}</div>}
          <Button variant="danger" className="mt-4" onClick={async () => { try { await api('/auth/logout-everywhere', { method: 'POST' }); await logout(); } catch { toast('Could not sign out everywhere', 'error'); } }}><LogOut size={14} /> Sign out everywhere</Button>
        </Card>
        <Card className="p-6"><SectionHeader eyebrow="Password" title="Login credentials" /><p className="text-xs leading-relaxed text-slate-400">Passwords are hashed with Argon2id (64 MiB, 3 iterations) and a per-user salt. Login is rate-limited and uses a dummy hash for unknown accounts to avoid timing enumeration.</p>
          <div className="mt-4 flex flex-wrap gap-2"><Badge tone="cyan">Argon2id</Badge><Badge tone="violet">HttpOnly cookies</Badge><Badge tone="lime">CSRF tokens</Badge></div></Card>
      </div>
    </div>
  );
}

/* ── Two-step encrypted private vault ───────────────────────────────────── */
function VaultTab() {
  const { toast } = useToast();
  const vault = useApi<{ vault: { salt: string; blob: string; updatedAt: number } | null }>('/users/me/vault');
  const [passphrase, setPassphrase] = useState('');
  const [record, setRecord] = useState<VaultRecord>(EMPTY_VAULT);
  const [unlocked, setUnlocked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async () => {
    if (!vault.data?.vault) { setCreating(true); setUnlocked(true); setRecord(EMPTY_VAULT); return; }
    setBusy(true); setError(null);
    try {
      const key = await deriveVaultKey(passphrase, vault.data.vault.salt);
      const decoded = await decryptVault<VaultRecord>(key, vault.data.vault.blob);
      setVaultKey(key); setRecord({ ...EMPTY_VAULT, ...decoded }); setUnlocked(true);
      toast('Vault unlocked in this browser');
    } catch { setError('That passphrase did not unlock the vault. The encrypted blob is unchanged.'); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      let key = getVaultKey();
      const salt = vault.data?.vault?.salt ?? newVaultSalt();
      if (!key) { key = await deriveVaultKey(passphrase, salt); setVaultKey(key); }
      const blob = await encryptVault(key, record);
      await api('/users/me/vault', { method: 'PUT', body: { salt, blob } });
      setCreating(false); setPassphrase(''); vault.reload(); toast('Saved with two encryption layers');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save vault'); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card className="p-6">
        <SectionHeader eyebrow="Layer 1 · browser / Layer 2 · server" title="Private vault" subtitle="Sensitive notes are encrypted in your browser, then wrapped again with a per-user server key." />
        {!unlocked ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-cyan/20 bg-cyan/[.05] p-4"><LockKeyhole size={20} className="text-cyan" /><p className="text-xs leading-relaxed text-slate-400">{vault.data?.vault ? 'Enter your vault passphrase to decrypt locally. It never leaves this browser.' : 'No vault yet. Choose a passphrase to create your private, double-encrypted store.'}</p></div>
            <Field label="Vault passphrase" hint="Not stored anywhere. If you lose it, the vault cannot be recovered — that is the point."><div className="relative"><Input type={show ? 'text' : 'password'} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} className="!pr-10" placeholder="At least 12 characters" /><button onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" aria-label="Toggle visibility">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></Field>
            {error && <ErrorNote message={error} />}
            <Button variant="primary" loading={busy} onClick={() => void unlock()}><KeyRound size={15} /> {vault.data?.vault ? 'Unlock vault' : 'Create vault'}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {creating && !vault.data?.vault && <SuccessNote>A new vault is ready. Add private details below and save.</SuccessNote>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone number"><Input value={record.phone} onChange={(e) => setRecord({ ...record, phone: e.target.value })} placeholder="+91 …" /></Field>
              <Field label="Emergency contact"><Input value={record.emergency} onChange={(e) => setRecord({ ...record, emergency: e.target.value })} placeholder="Name & number" /></Field>
            </div>
            <Field label="Private links" hint="Submission links, drive folders, portfolio drafts"><Textarea value={record.links} onChange={(e) => setRecord({ ...record, links: e.target.value })} /></Field>
            <Field label="Personal notes"><Textarea value={record.notes} onChange={(e) => setRecord({ ...record, notes: e.target.value })} /></Field>
            {error && <ErrorNote message={error} />}
            <div className="flex flex-wrap justify-between gap-2"><Button variant="ghost" onClick={() => { setUnlocked(false); setVaultKey(null); setPassphrase(''); }}>Lock vault</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Encrypt & save</Button></div>
          </div>
        )}
      </Card>
      <div className="space-y-4">
        <Card className="p-5"><div className="flex items-center gap-2 text-xs font-bold text-white"><ShieldCheck size={15} className="text-cyan" /> Two-step encryption</div>
          <div className="mt-4 space-y-3">{[
            { n: '01', title: 'Browser layer', text: 'PBKDF2-SHA256 (210k) derives a key from your passphrase; AES-256-GCM encrypts the data.' },
            { n: '02', title: 'Server layer', text: 'AES-256-GCM envelope with a per-user HKDF key from a KMS-managed master secret.' },
          ].map((s) => <div key={s.n} className="rounded-xl bg-white/[.02] p-3"><div className="font-mono text-[10px] text-cyan">{s.n}</div><div className="mt-1 text-xs font-semibold text-slate-200">{s.title}</div><p className="mt-1 text-[11px] leading-relaxed text-slate-500">{s.text}</p></div>)}</div>
          <p className="mt-3 text-[11px] text-slate-500">A database leak alone yields ciphertext wrapped in ciphertext. Neither layer can be read without the other.</p></Card>
        <Card className="p-5"><div className="text-xs font-bold text-white">Status</div><div className="mt-3 space-y-2 text-[11px]"><div className="flex justify-between"><span className="text-slate-500">Vault</span><span className={vault.data?.vault ? 'text-lime' : 'text-amber'}>{vault.data?.vault ? 'Created' : 'Not created'}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Last written</span><span className="text-slate-300">{vault.data?.vault ? fmtDateTime(vault.data.vault.updatedAt) : '—'}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">In browser memory</span><span className={unlocked ? 'text-lime' : 'text-slate-500'}>{unlocked ? 'Unlocked' : 'Locked'}</span></div></div></Card>
      </div>
    </div>
  );
}

/* ── Export / delete ────────────────────────────────────────────────────── */
function DataTab({ logout }: { logout: () => Promise<void> }) {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-6"><SectionHeader eyebrow="Portability" title="Export your data" subtitle="A JSON export of your profile, settings, applications, calendar, notifications and public device keys." />
        <div className="rounded-xl border border-white/[.07] bg-white/[.02] p-4 text-xs leading-relaxed text-slate-400">Your vault is included only as double-encrypted ciphertext — the export is safe to store, but cannot reveal vault contents without your passphrase and the server key.</div>
        <a href="/api/v1/users/me/export" download className="btn btn-primary mt-5"><Download size={15} /> Download my data</a>
        <div className="mt-5 flex flex-wrap gap-2"><Badge tone="cyan">No password hashes</Badge><Badge tone="violet">No other users' private data</Badge></div>
      </Card>
      <Card className="border-rose/20 p-6"><SectionHeader eyebrow="Danger zone" title="Delete account" subtitle="Permanently removes your applications, calendar, teams, chats, vault and profile PII." />
        <Field label="Confirm with your password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button variant="danger" className="mt-4" loading={busy} onClick={async () => {
          if (!password) { toast('Enter your password first', 'error'); return; }
          setBusy(true);
          try { await api('/users/me', { method: 'DELETE', body: { password } }); toast('Account deleted'); await logout(); }
          catch (err) { toast(err instanceof Error ? err.message : 'Could not delete account', 'error'); }
          finally { setBusy(false); }
        }}><Trash2 size={15} /> Delete my account</Button>
        <p className="mt-3 text-[11px] text-slate-500">Audit entries are retained in pseudonymised form for security investigations.</p>
      </Card>
    </div>
  );
}
