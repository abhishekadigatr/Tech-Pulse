'use client';

import { useMemo, useState } from 'react';
import { Filter, Search, SlidersHorizontal, X, Compass, RotateCcw } from 'lucide-react';
import { useApi } from '@/lib/api-client';
import { HackathonCard } from '@/components/HackathonCard';
import { Badge, Button, Card, EmptyState, Loading, SectionHeader, cn } from '@/components/ui';
import { useAuth } from '@/components/providers';
import type { Hackathon, Paged } from '@/lib/types';

export default function HackathonsPage() {
  const { me } = useAuth();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('');
  const [city, setCity] = useState('');
  const [tag, setTag] = useState('');
  const [status, setStatus] = useState('open');
  const [sort, setSort] = useState('deadline');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const facets = useApi<{ cities: string[]; tags: string[]; domains: string[]; modes: string[] }>('/facets');
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (mode) p.set('mode', mode);
    if (city) p.set('city', city);
    if (tag) p.set('tag', tag);
    if (status) p.set('status', status);
    p.set('sort', sort);
    p.set('page', String(page));
    p.set('pageSize', '12');
    return p.toString();
  }, [q, mode, city, tag, status, sort, page]);
  const result = useApi<Paged<Hackathon>>(`/hackathons?${query}`);

  const reset = () => { setQ(''); setMode(''); setCity(''); setTag(''); setStatus('open'); setSort('deadline'); setPage(1); };
  const active = [mode, city, tag, status !== 'open' ? status : ''].filter(Boolean).length;
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 12));

  return (
    <div className="space-y-6">
      <div className="glass relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-cyan/10 blur-3xl" />
        <div className="relative">
          <Badge tone="cyan"><Compass size={11} /> Discovery engine</Badge>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Find your next <span className="glow-text">build weekend.</span></h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">{total} opportunities match your view. Every card links directly to the organiser’s official page.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search by name, organiser, domain or tag…" className="input !py-3 !pl-11" aria-label="Search hackathons" />
              {q && <button onClick={() => { setQ(''); setPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white" aria-label="Clear search"><X size={15} /></button>}
            </div>
            <Button variant={showFilters ? 'primary' : 'outline'} onClick={() => setShowFilters((v) => !v)} className="!py-3">
              <SlidersHorizontal size={15} /> Filters {active > 0 && <span className="rounded-full bg-black/20 px-1.5 text-[10px]">{active}</span>}
            </Button>
          </div>
        </div>
      </div>

      {showFilters && (
        <Card className="animate-slide-up p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><Filter size={15} className="text-cyan" /> Refine results</div>
            <button onClick={reset} className="flex items-center gap-1 text-xs text-slate-400 hover:text-cyan"><RotateCcw size={12} /> Reset</button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="label">Format</span>
              <div className="flex flex-wrap gap-1.5">{['', 'online', 'offline', 'hybrid'].map((m) => (
                <button key={m} onClick={() => { setMode(m); setPage(1); }} className={cn('chip', mode === m && 'chip-active')}>{m || 'All'}</button>))}</div>
            </div>
            <div><span className="label">City</span>
              <select value={city} onChange={(e) => { setCity(e.target.value); setPage(1); }} className="input !py-2">
                <option value="">All locations</option>{(facets.data?.cities ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><span className="label">Status</span>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="input !py-2">
                <option value="open">Open deadlines</option><option value="closed">Closed</option>
                {me && <option value="saved">Saved only</option>}{me && <option value="applied">Applied only</option>}<option value="">All hackathons</option>
              </select>
            </div>
            <div><span className="label">Sort by</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="input !py-2">
                <option value="deadline">Deadline (soonest)</option><option value="latest">Event date</option><option value="prize">Prize pool</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <span className="label">Popular tags</span>
            <div className="flex flex-wrap gap-1.5">{(facets.data?.tags ?? []).slice(0, 16).map((t) => (
              <button key={t} onClick={() => { setTag(tag === t ? '' : t); setPage(1); }} className={cn('chip', tag === t && 'chip-active')}>{t}</button>))}
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {[q && `“${q}”`, mode, city, tag, status === 'closed' && 'Closed'].filter(Boolean).map((label) => (
            <span key={String(label)} className="chip chip-active">{String(label)}</span>
          ))}
          <span className="text-xs text-slate-500">{total} result{total === 1 ? '' : 's'}</span>
        </div>
        <div className="text-[11px] text-slate-500">Page {page} of {pages}</div>
      </div>

      {result.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-[360px] rounded-2xl" />)}</div>
      ) : result.error ? <EmptyState title="Could not load hackathons" description={result.error} action={<Button onClick={result.reload}>Try again</Button>} />
        : (result.data?.items.length ?? 0) === 0 ? <EmptyState icon={<Compass size={24} />} title="No hackathons match those filters" description="Try clearing a tag or switching the status back to open deadlines." action={<Button onClick={reset}>Clear filters</Button>} />
          : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{result.data!.items.map((h) => <HackathonCard key={h.id} hackathon={h} onChange={result.reload} />)}</div>
              {pages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button size="sm" disabled={page <= 1} onClick={() => { setPage((p) => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Previous</Button>
                  {Array.from({ length: pages }).slice(0, 6).map((_, i) => (
                    <button key={i} onClick={() => { setPage(i + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      className={cn('h-9 w-9 rounded-xl border text-xs font-semibold transition', page === i + 1 ? 'border-cyan/50 bg-cyan/10 text-cyan' : 'border-white/10 text-slate-400 hover:bg-white/[.05]')}>{i + 1}</button>
                  ))}
                  <Button size="sm" disabled={page >= pages} onClick={() => { setPage((p) => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Next</Button>
                </div>
              )}
            </>
          )}
      <div className="divider" />
      <p className="text-center text-[11px] text-slate-600">Listings are curated or ingested from an approved HTTPS feed. Apply links are validated server-side as HTTPS-only before redirect.</p>
    </div>
  );
}
