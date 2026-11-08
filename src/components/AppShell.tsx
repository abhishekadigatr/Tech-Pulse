'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity, Bell, Bookmark, CalendarDays, ChevronDown, Compass, Inbox, KeyRound,
  LayoutDashboard, LogOut, Map, Menu, MessageSquare, Search, Settings, ShieldCheck,
  Sparkles, Trophy, Users, X, Zap, Sun, Moon, Palette,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api-client';
import { useAuth, useSocket, useToast } from './providers';
import { Avatar, Badge, Button, LiveClock, cn } from './ui';
import type { Hackathon, Me, Notification, PublicUser } from '@/lib/types';
import { relative } from '@/lib/format';

const NAV = [
  { group: 'Discover', items: [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/hackathons', label: 'Hackathons', icon: Compass },
    { href: '/saved', label: 'Saved', icon: Bookmark },
    { href: '/learn', label: 'Playbook', icon: Sparkles },
  ] },
  { group: 'Workspace', items: [
    { href: '/inbox', label: 'Inbox', icon: Inbox },
    { href: '/collaborate', label: 'Collaborate', icon: Users },
    { href: '/chat', label: 'Secure chat', icon: MessageSquare },
    { href: '/calendar', label: 'Calendar', icon: CalendarDays },
    { href: '/journey', label: 'Journey', icon: Map },
  ] },
  { group: 'Account', items: [
    { href: '/settings', label: 'Settings & vault', icon: Settings },
    { href: '/admin', label: 'Admin', icon: ShieldCheck, admin: true },
  ] },
] as const;

const MOBILE = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/hackathons', label: 'Explore', icon: Compass },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/collaborate', label: 'Teams', icon: Users },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
];

const TITLES: Record<string, string> = {
  '/': 'Dashboard', '/hackathons': 'Hackathon discovery', '/saved': 'Saved opportunities',
  '/learn': 'Hackathon playbook', '/inbox': 'Your inbox', '/collaborate': 'Collaborate',
  '/chat': 'Secure conversations', '/calendar': 'Calendar & reminders', '/journey': 'Journey planner',
  '/settings': 'Settings & security', '/admin': 'Admin console', '/about': 'About',
  '/privacy': 'Privacy & security', '/login': 'Sign in',
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { me, loading, logout } = useAuth();
  const { status } = useSocket();
  const { toast } = useToast();
  const [drawer, setDrawer] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [results, setResults] = useState<{ hackathons: Hackathon[]; people: PublicUser[] }>({ hackathons: [], people: [] });
  const [themeMenu, setThemeMenu] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    if (!me) return;
    try {
      const data = await api<{ items: Notification[]; unread: number }>('/notifications');
      setNotifications(data.items.slice(0, 8));
      setUnread(data.unread);
    } catch { /* silent */ }
  }, [me?.id]);
  useEffect(() => { void loadNotifications(); }, [loadNotifications, pathname]);
  useEffect(() => {
    const handler = () => void loadNotifications();
    window.addEventListener('tp:notifications', handler);
    return () => window.removeEventListener('tp:notifications', handler);
  }, [loadNotifications]);

  useEffect(() => {
    if (!search || search.trim().length < 2) { setResults({ hackathons: [], people: [] }); return; }
    const timer = setTimeout(() => {
      void api<{ hackathons: Hackathon[]; people: PublicUser[] }>(`/search?q=${encodeURIComponent(search.trim())}`)
        .then(setResults).catch(() => setResults({ hackathons: [], people: [] }));
    }, 220);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const title = pathname.startsWith('/hackathons/') ? 'Hackathon details'
    : pathname.startsWith('/chat/') ? 'Encrypted conversation'
      : TITLES[pathname] ?? 'Tech Pulse';

  const setTheme = async (theme: Me['settings']['theme']) => {
    document.documentElement.dataset.theme = theme;
    setThemeMenu(false);
    try { await api('/users/me/settings', { method: 'PATCH', body: { theme } }); } catch { /* local-only fallback */ }
  };

  const navItem = (item: { href: string; label: string; icon: typeof Compass; admin?: boolean }) => {
    if ('admin' in item && item.admin && !(me?.role === 'admin' && me.aal2)) return null;
    const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
    const Icon = item.icon;
    return (
      <Link key={item.href} href={item.href} onClick={() => setDrawer(false)}
        className={cn('group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
          active ? 'bg-white/[.07] text-white' : 'text-slate-400 hover:bg-white/[.04] hover:text-slate-200')}>
        {active && <span className="absolute left-0 top-2 h-[calc(100%-16px)] w-[3px] rounded-r-full bg-gradient-to-b from-cyan to-violet" />}
        <Icon size={17} className={cn('shrink-0 transition', active ? 'text-cyan' : 'text-slate-500 group-hover:text-slate-300')} />
        <span className="flex-1">{item.label}</span>
        {item.href === '/chat' && status === 'open' && <span className="h-1.5 w-1.5 rounded-full bg-lime shadow-[0_0_8px_#b8f34a]" />}
      </Link>
    );
  };

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar */}
      <aside className={cn('fixed inset-y-0 left-0 z-50 flex w-[252px] flex-col border-r border-white/[.06] bg-[#080d18]/95 backdrop-blur-2xl transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
        drawer ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-[72px] items-center gap-3 px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan to-violet text-[#04121a] shadow-glow">
              <Zap size={19} fill="currentColor" />
              <span className="absolute inset-0 animate-ping-soft rounded-xl bg-cyan/30" />
            </span>
            <span>
              <span className="block text-[15px] font-extrabold leading-4 tracking-tight text-white">Tech Pulse</span>
              <span className="block text-[10px] font-medium uppercase tracking-[.18em] text-cyan/70">Hackathon OS</span>
            </span>
          </Link>
          <button className="ml-auto text-slate-400 lg:hidden" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18} /></button>
        </div>

        <nav className="hide-scroll flex-1 overflow-y-auto px-3 pb-4">
          {NAV.map((group) => (
            <div key={group.group} className="mb-5">
              <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-600">{group.group}</div>
              <div className="space-y-0.5">{group.items.map((item) => navItem(item))}</div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/[.06] p-3">
          <div className="glass-soft mb-3 p-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-cyan"><ShieldCheck size={13} /> Security on</div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">Two-step data encryption · E2EE chat · CSRF + rate limits</p>
          </div>
          <div className="flex items-center justify-between px-2 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5"><Activity size={12} className={status === 'open' ? 'text-lime' : 'text-slate-600'} />{status === 'open' ? 'Realtime live' : 'Offline'}</span>
            <LiveClock />
          </div>
        </div>
      </aside>
      {drawer && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setDrawer(false)} />}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[72px] items-center gap-3 border-b border-white/[.06] bg-[#070c17]/85 px-4 backdrop-blur-xl sm:px-6">
          <button onClick={() => setDrawer(true)} className="btn btn-ghost !px-2 lg:hidden" aria-label="Open menu"><Menu size={20} /></button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-white sm:text-base">{title}</h1>
            <p className="hidden text-[11px] text-slate-500 sm:block">Your hackathon command centre</p>
          </div>

          {/* Global search */}
          <div ref={searchRef} className="relative ml-auto hidden w-full max-w-[340px] md:block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)} placeholder="Search hackathons, skills, people…"
              className="input !py-2 !pl-9 !text-xs" aria-label="Search" />
            {searchOpen && search.trim().length >= 2 && (
              <div className="glass absolute right-0 top-[calc(100%+8px)] max-h-[340px] w-[420px] overflow-y-auto p-2 shadow-2xl">
                {results.hackathons.length === 0 && results.people.length === 0 && <div className="px-3 py-6 text-center text-xs text-slate-500">No matches for “{search}”</div>}
                {results.hackathons.length > 0 && <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Hackathons</div>}
                {results.hackathons.map((h) => (
                  <Link key={h.id} href={`/hackathons/${h.slug}`} onClick={() => { setSearchOpen(false); setSearch(''); }}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[.06]">
                    <span className="h-8 w-1 rounded-full" style={{ background: `hsl(${h.hue},80%,60%)` }} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm text-slate-200">{h.name}</span><span className="block truncate text-[11px] text-slate-500">{h.organizer} · {h.domain}</span></span>
                  </Link>
                ))}
                {results.people.length > 0 && <div className="mt-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">People</div>}
                {results.people.map((p) => (
                  <Link key={p.id} href="/collaborate" onClick={() => { setSearchOpen(false); setSearch(''); }}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[.06]">
                    <Avatar name={p.name} hue={p.avatarHue} size={30} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm text-slate-200">{p.name}</span><span className="block truncate text-[11px] text-slate-500">{p.skills.slice(0, 3).join(' · ')}</span></span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Theme */}
          <div className="relative hidden sm:block">
            <Button variant="ghost" size="icon" aria-label="Theme" onClick={() => setThemeMenu((v) => !v)}><Palette size={17} /></Button>
            {themeMenu && (
              <div className="glass absolute right-0 top-[calc(100%+8px)] z-40 w-36 p-1.5">
                {(['nebula', 'aurora', 'midnight'] as const).map((t) => (
                  <button key={t} onClick={() => void setTheme(t)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs capitalize text-slate-300 hover:bg-white/[.07]">
                    {t === 'nebula' ? <Sparkles size={13} /> : t === 'aurora' ? <Sun size={13} /> : <Moon size={13} />}{t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Notifications */}
          {me && (
            <div className="relative">
              <Button variant="ghost" size="icon" aria-label="Notifications" onClick={() => { setNotifOpen((v) => !v); void loadNotifications(); }}>
                <Bell size={17} />{unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose px-1 text-[9px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
              </Button>
              {notifOpen && (
                <div className="glass absolute right-0 top-[calc(100%+10px)] z-40 w-[340px] p-2 shadow-2xl">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Notifications</span>
                    <button className="text-[11px] text-cyan hover:underline" onClick={async () => {
                      try { await api('/notifications/read-all', { method: 'POST' }); await loadNotifications(); toast('All caught up'); } catch { /* ignore */ }
                    }}>Mark all read</button>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto">
                    {notifications.length === 0 && <div className="px-3 py-8 text-center text-xs text-slate-500">Nothing new yet.</div>}
                    {notifications.map((n) => (
                      <Link key={n.id} href={n.link || '/inbox'} onClick={() => setNotifOpen(false)}
                        className={cn('block rounded-lg px-2.5 py-2.5 hover:bg-white/[.05]', !n.readAt && 'bg-cyan/[.04]')}>
                        <div className="flex items-start gap-2">
                          <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', n.readAt ? 'bg-slate-600' : 'bg-cyan')} />
                          <div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-200">{n.title}</div><div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">{n.body}</div></div>
                        </div>
                        <div className="mt-1 pl-3.5 text-[10px] text-slate-600">{relative(n.createdAt)}</div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Account */}
          {loading ? <div className="skeleton h-9 w-9 rounded-xl" /> : me ? (
            <div className="relative">
              <button onClick={() => setUserMenu((v) => !v)} className="flex items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.03] py-1 pl-1 pr-2 hover:border-white/20">
                <Avatar name={me.name} hue={me.avatarHue} size={30} />
                <ChevronDown size={13} className="text-slate-500" />
              </button>
              {userMenu && (
                <div className="glass absolute right-0 top-[calc(100%+10px)] z-40 w-56 p-2">
                  <div className="px-2 py-2"><div className="text-sm font-semibold text-white">{me.name}</div><div className="truncate text-[11px] text-slate-500">{me.email}</div></div>
                  <div className="divider my-1" />
                  <Link href="/settings" onClick={() => setUserMenu(false)} className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-300 hover:bg-white/[.06]"><Settings size={14} /> Settings & vault</Link>
                  <Link href="/settings" onClick={() => setUserMenu(false)} className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-300 hover:bg-white/[.06]"><KeyRound size={14} /> {me.totpEnabled ? '2FA active' : 'Enable 2FA'}</Link>
                  <div className="divider my-1" />
                  <button onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-rose hover:bg-rose/10"><LogOut size={14} /> Sign out</button>
                </div>
              )}
            </div>
          ) : (
            <Link href="/login" className="btn btn-primary !py-2 !text-xs">Sign in</Link>
          )}
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-24 pt-6 sm:px-6 lg:pb-10">{children}</main>

        <footer className="hidden border-t border-white/[.06] px-6 py-5 text-[11px] text-slate-600 lg:flex lg:items-center lg:justify-between">
          <span>© {new Date().getFullYear()} Tech Pulse · Built for student builders</span>
          <div className="flex items-center gap-5"><Link href="/about" className="hover:text-slate-300">About</Link><Link href="/privacy" className="hover:text-slate-300">Privacy & security</Link><span className="flex items-center gap-1.5"><ShieldCheck size={12} /> End-to-end encrypted chat</span></div>
        </footer>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-white/[.08] bg-[#080d18]/95 px-2 py-2 backdrop-blur-xl lg:hidden">
        {MOBILE.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} className={cn('flex flex-col items-center gap-1 rounded-lg px-3 py-1 text-[10px] font-medium', active ? 'text-cyan' : 'text-slate-500')}><Icon size={18} />{item.label}</Link>;
        })}
      </nav>
    </div>
  );
}

/** Consistent sign-in gate for private workspace pages, with one-click demo. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { me, loading, refreshMe } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (loading) return <div className="mx-auto max-w-2xl py-16"><div className="skeleton h-40 w-full" /><div className="skeleton mt-4 h-24 w-full" /></div>;
  if (me) return <>{children}</>;
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-16 text-center">
      <div className="relative mb-6">
        <div className="absolute -inset-8 rounded-full bg-cyan/10 blur-3xl" />
        <div className="glass relative flex h-20 w-20 items-center justify-center rounded-3xl text-cyan"><ShieldCheck size={36} /></div>
      </div>
      <Badge tone="cyan">Private workspace</Badge>
      <h2 className="mt-4 text-3xl font-bold tracking-tight text-white">Sign in to continue</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">Your applications, reminders, vault and encrypted conversations are tied to your account. Everything here is protected by session cookies, CSRF tokens and two-step encryption.</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/login" className="btn btn-primary">Go to sign in</Link>
        <Button loading={busy} onClick={async () => {
          setBusy(true);
          try {
            const hint = await api<{ demo: { email: string; password: string } }>('/auth/dev-hint');
            const result = await api<{ me: Me }>('/auth/login', { method: 'POST', body: hint.demo });
            void result;
            await refreshMe();
            toast('Welcome to the demo workspace');
            router.refresh();
          } catch { toast('Could not start the demo session', 'error'); }
          finally { setBusy(false); }
        }}><Trophy size={15} /> Enter demo workspace</Button>
      </div>
    </div>
  );
}
