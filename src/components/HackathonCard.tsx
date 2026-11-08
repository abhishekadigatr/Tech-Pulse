'use client';

import Link from 'next/link';
import { Bookmark, ExternalLink, MapPin, Users, Trophy, ArrowRight, Radio, Building2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { useAuth, useToast } from './providers';
import { Badge, Countdown, cn } from './ui';
import { hueColor, modeLabel, statusLabel } from '@/lib/format';
import type { Hackathon } from '@/lib/types';

export function HackathonCard({ hackathon, onChange, compact }: {
  hackathon: Hackathon; onChange?: (next: Hackathon) => void; compact?: boolean;
}) {
  const [item, setItem] = useState(hackathon);
  const [busy, setBusy] = useState(false);
  const { me } = useAuth();
  const { toast } = useToast();
  const accent = hueColor(item.hue);

  const toggleBookmark = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!me) { toast('Sign in to save opportunities', 'info'); return; }
    if (busy) return;
    setBusy(true);
    const next = !item.bookmarked;
    setItem({ ...item, bookmarked: next });
    try {
      await api(`/hackathons/${item.id}/bookmark`, { method: next ? 'POST' : 'DELETE' });
      onChange?.({ ...item, bookmarked: next });
      toast(next ? 'Saved to your list' : 'Removed from saved');
    } catch {
      setItem({ ...item, bookmarked: !next });
      toast('Could not update saved list', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Link href={`/hackathons/${item.slug}`} className="group relative block">
      <div className="glass relative flex h-full flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1.5 hover:border-white/20 hover:shadow-glow">
        {/* Accent banner */}
        <div className="relative h-[86px] overflow-hidden" style={{ background: `linear-gradient(120deg, ${hueColor(item.hue, 70, 22)}, #0b1120 75%)` }}>
          <div className="absolute -right-6 -top-14 h-40 w-40 rounded-full opacity-40 blur-2xl" style={{ background: accent }} />
          <div className="absolute inset-0 opacity-30" style={{ backgroundImage: `radial-gradient(${accent} 1px, transparent 1px)`, backgroundSize: '18px 18px' }} />
          <svg className="absolute -bottom-6 right-2 h-24 w-24 animate-orbit opacity-25" viewBox="0 0 100 100" fill="none">
            <circle cx="50" cy="50" r="44" stroke={accent} strokeWidth="1" strokeDasharray="5 7" />
            <circle cx="50" cy="50" r="28" stroke={accent} strokeWidth="1" />
          </svg>
          <div className="relative flex h-full items-start justify-between px-4 pt-3.5">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="cyan" className="!bg-black/40 !text-white !border-white/20">{item.domain}</Badge>
              <Badge className="!bg-black/40 !text-white !border-white/20">{modeLabel[item.mode]}</Badge>
            </div>
            <button onClick={toggleBookmark} aria-label={item.bookmarked ? 'Remove bookmark' : 'Save hackathon'}
              className={cn('flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-black/35 transition hover:bg-black/60',
                item.bookmarked ? 'text-cyan' : 'text-slate-300')}>
              <Bookmark size={15} fill={item.bookmarked ? 'currentColor' : 'none'} />
            </button>
          </div>
          <div className="absolute bottom-2 left-4 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">
            <Radio size={11} /> {item.source === 'curated' ? 'Verified listing' : item.source}
          </div>
        </div>

        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-white transition group-hover:text-cyan">{item.name}</h3>
            {item.application && <Badge tone={item.application === 'shortlisted' || item.application === 'participating' ? 'lime' : 'violet'} className="shrink-0">{statusLabel[item.application]}</Badge>}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500"><Building2 size={11} />{item.organizer}</p>
          {!compact && <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-slate-400">{item.description}</p>}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.tags.slice(0, compact ? 2 : 3).map((tag) => <span key={tag} className="chip !px-2 !py-0.5 !text-[10px]">{tag}</span>)}
          </div>

          <div className="mt-auto space-y-2.5 pt-4">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="flex items-center gap-1"><MapPin size={11} />{item.city}</span>
              <span className="flex items-center gap-1"><Users size={11} />{item.teamCount ?? 0} teams · {item.seekerCount ?? 0} seekers</span>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-white/[.06] pt-3">
              <div className="min-w-0">
                <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500"><Trophy size={10} /> Prize</div>
                <div className="truncate text-xs font-semibold text-slate-200">{item.prize || 'Recognition'}</div>
              </div>
              <Countdown deadline={item.deadline} compact />
            </div>
            <div className="flex items-center gap-2">
              <span className="btn btn-primary flex-1 !py-2 !text-xs">View & apply <ArrowRight size={13} /></span>
              <button type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(`/api/v1/hackathons/${item.id}/apply-link`, '_blank', 'noopener,noreferrer'); }}
                className="btn btn-outline !px-2.5 !py-2" aria-label="Open official apply link" title="Open official site directly">
                <ExternalLink size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
