'use client';

import { clsx } from 'clsx';
import {
  AlertCircle, CheckCircle2, Info, Loader2, X, ArrowUpRight, Clock,
} from 'lucide-react';
import {
  useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { countdown, hueColor, initials } from '@/lib/format';

export const cn = (...parts: unknown[]): string => clsx(parts);

/* ── Button ─────────────────────────────────────────────────────────────── */
type Variant = 'primary' | 'outline' | 'ghost' | 'danger';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
}
export function Button({ variant = 'outline', size = 'md', loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={cn('btn', variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : variant === 'ghost' ? 'btn-ghost' : 'btn-outline',
        size === 'sm' && 'px-3 py-1.5 text-xs', size === 'lg' && 'px-6 py-3 text-base', size === 'icon' && 'h-9 w-9 p-0', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ── Surfaces ───────────────────────────────────────────────────────────── */
export function Card({ className, children, hover, ...rest }: { className?: string; children: ReactNode; hover?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('glass', hover && 'transition-all duration-300 hover:-translate-y-1 hover:border-white/20', className)} {...rest}>{children}</div>;
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'cyan' | 'violet' | 'lime' | 'amber' | 'rose'; className?: string }) {
  const tones = {
    neutral: 'border-white/10 bg-white/[.04] text-slate-300',
    cyan: 'border-cyan/25 bg-cyan/10 text-cyan',
    violet: 'border-violet/25 bg-violet/10 text-violet',
    lime: 'border-lime/25 bg-lime/10 text-lime',
    amber: 'border-amber/25 bg-amber/10 text-amber',
    rose: 'border-rose/25 bg-rose/10 text-rose',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', tones[tone], className)}>{children}</span>;
}

export function Avatar({ name, hue = 190, size = 36, className }: { name: string; hue?: number; size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-xl font-bold text-[#06111b] ring-2 ring-white/10', className)}
      style={{ width: size, height: size, fontSize: size * 0.34, background: `linear-gradient(135deg, ${hueColor(hue, 85, 72)}, ${hueColor(hue + 45, 80, 60)})` }}
      aria-label={name}
    >
      {initials(name)}
    </span>
  );
}

export function SectionHeader({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.2em] text-cyan/80">{eyebrow}</div>}
        <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">{title}</h2>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone = 'cyan' }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode; tone?: 'cyan' | 'violet' | 'lime' | 'amber' }) {
  const glow = { cyan: 'from-cyan/20', violet: 'from-violet/20', lime: 'from-lime/20', amber: 'from-amber/20' }[tone];
  const text = { cyan: 'text-cyan', violet: 'text-violet', lime: 'text-lime', amber: 'text-amber' }[tone];
  return (
    <Card className="relative overflow-hidden p-4">
      <div className={cn('pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-gradient-to-br to-transparent blur-2xl', glow)} />
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        {icon && <span className={text}>{icon}</span>}
      </div>
      <div className="mt-2 text-3xl font-bold tracking-tight text-white">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

/* ── Form controls ──────────────────────────────────────────────────────── */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('input', className)} {...rest} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('input min-h-[92px] resize-y', className)} {...rest} />;
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('input appearance-none pr-8', className)} {...rest}>{children}</select>;
}
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <div className="text-sm font-medium text-slate-200">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition', checked ? 'border-cyan/40 bg-cyan/30' : 'border-white/10 bg-white/[.06]')}
      >
        <span className={cn('absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all', checked ? 'left-[23px] bg-cyan' : 'left-0.5 bg-slate-400')} style={{ height: 18, width: 18 }} />
      </button>
    </div>
  );
}

/* ── Overlays & feedback ────────────────────────────────────────────────── */
export function Modal({ open, onClose, title, description, children, width = 'max-w-lg' }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('glass animate-slide-up relative max-h-[88vh] w-full overflow-y-auto p-6', width)}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">{title}</h3>
            {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X size={17} /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: Array<{ id: string; label: string; count?: number }>; active: string; onChange: (id: string) => void }) {
  return (
    <div className="hide-scroll flex gap-1 overflow-x-auto rounded-xl border border-white/[.06] bg-black/20 p-1">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" onClick={() => onChange(tab.id)}
          className={cn('flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition',
            active === tab.id ? 'bg-white/[.09] text-white shadow-sm' : 'text-slate-400 hover:text-slate-200')}>
          {tab.label}
          {tab.count !== undefined && <span className={cn('rounded-full px-1.5 py-0.5 text-[10px]', active === tab.id ? 'bg-cyan/20 text-cyan' : 'bg-white/[.06] text-slate-500')}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-20 w-full" />)}</div>;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[.02] px-6 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[.04] text-cyan/70">{icon ?? <Info size={24} />}</div>
      <h3 className="text-base font-semibold text-slate-200">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-rose/25 bg-rose/[.07] px-4 py-3 text-sm text-rose">
      <AlertCircle size={17} className="shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && <button onClick={onRetry} className="font-semibold underline underline-offset-2">Retry</button>}
    </div>
  );
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 rounded-xl border border-cyan/25 bg-cyan/[.07] px-4 py-3 text-sm text-cyan"><CheckCircle2 size={16} />{children}</div>;
}

export function Progress({ value, tone = 'cyan' }: { value: number; tone?: 'cyan' | 'violet' | 'lime' }) {
  const colors = { cyan: 'from-cyan to-violet', violet: 'from-violet to-rose', lime: 'from-lime to-cyan' }[tone];
  return <div className="h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-700', colors)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

/* ── Live countdown ─────────────────────────────────────────────────────── */
export function Countdown({ deadline, compact }: { deadline: number; compact?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  void now;
  const state = countdown(deadline);
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-mono text-xs font-semibold',
      state.expired ? 'text-slate-500' : state.urgent ? 'text-amber' : 'text-cyan', compact && 'text-[11px]')}>
      <Clock size={compact ? 11 : 13} />{state.label}
    </span>
  );
}

export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span className="font-mono text-xs tabular-nums text-slate-400">{now ? now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--:--:--'}</span>;
}

export function LinkArrow({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1 text-cyan">{children}<ArrowUpRight size={14} /></span>;
}
