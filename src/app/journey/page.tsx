'use client';

import { useSearchParams } from 'next/navigation';
import {
  Check, ChevronRight, Coffee, Compass, Fuel, Landmark, MapPin, Navigation, Plus,
  Route, ShieldCheck, Star, Utensils, Wallet,
} from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { directionsUrl, placeSearchUrl } from '@/lib/map-links';
import { api, useApi } from '@/lib/api-client';
import { AuthGate } from '@/components/AppShell';
import { useToast } from '@/components/providers';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, Progress, SectionHeader, Select, cn } from '@/components/ui';
import { fmtShort, hueColor } from '@/lib/format';
import type { Hackathon, JourneyPlace, Paged, Trip } from '@/lib/types';

const PLACE_ICON = { food: Utensils, fuel: Fuel, rest: Coffee, atm: Wallet } as const;
const PLACE_TONE = { food: 'text-amber', fuel: 'text-cyan', rest: 'text-lime', atm: 'text-violet' } as const;

export default function JourneyPage() {
  return <Suspense fallback={<div className="skeleton h-64 w-full rounded-2xl" />}><AuthGate><JourneyContent /></AuthGate></Suspense>;
}

function JourneyContent() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const trips = useApi<{ items: Trip[] }>('/trips');
  const catalog = useApi<Paged<Hackathon>>('/hackathons?pageSize=48');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [type, setType] = useState('');
  const [maxDetour, setMaxDetour] = useState(20);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ hackathonId: searchParams.get('hackathon') ?? '', origin: '', mode: 'car' as Trip['mode'] });

  const list = trips.data?.items ?? [];
  const selected = list.find((t) => t.id === selectedId) ?? list[0];
  const suggestions = (selected?.suggestions ?? []).filter((p) => (!type || p.type === type) && p.detourMin <= maxDetour);

  const create = async () => {
    if (!form.hackathonId || form.origin.trim().length < 2) { toast('Choose a hackathon and your starting city', 'error'); return; }
    setBusy(true);
    try {
      const result = await api<{ trip: Trip }>('/trips', { method: 'POST', body: form });
      toast('Route built with local journey tips'); setCreateOpen(false); await trips.reload(); setSelectedId(result.trip.id); setChecked(new Set());
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not build route', 'error'); }
    finally { setBusy(false); }
  };

  const toggleSave = async (place: JourneyPlace) => {
    if (!selected) return;
    try {
      await api(`/trips/${selected.id}/suggestions/${place.id}/save`, { method: 'POST', body: { saved: !place.saved } });
      trips.reload();
      toast(place.saved ? 'Removed from your stops' : 'Saved to your route');
    } catch { toast('Could not update stop', 'error'); }
  };

  const mapPoints = useMemo(() => {
    if (!selected) return { path: '', points: [] as Array<{ x: number; y: number; place: JourneyPlace }> };
    const lats = selected.route.map((r) => r.lat);
    const lngs = selected.route.map((r) => r.lng);
    const minLat = Math.min(...lats) - .06, maxLat = Math.max(...lats) + .06;
    const minLng = Math.min(...lngs) - .06, maxLng = Math.max(...lngs) + .06;
    const project = (lat: number, lng: number) => ({
      x: 30 + ((lng - minLng) / Math.max(.001, maxLng - minLng)) * 540,
      y: 20 + (1 - (lat - minLat) / Math.max(.001, maxLat - minLat)) * 260,
    });
    const projected = selected.route.map((r) => project(r.lat, r.lng));
    const path = projected.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const points = suggestions.slice(0, 10).map((place) => ({ ...project(place.lat, place.lng), place }));
    return { path, points };
  }, [selected, suggestions]);

  if (trips.loading) return <div className="mx-auto max-w-3xl"><Loading rows={5} /></div>;

  return (
    <div className="space-y-6">
      <div className="glass relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-amber/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div><Badge tone="amber"><Navigation size={11} /> Journey intelligence</Badge>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white">Get there ready to <span className="glow-text">ship.</span></h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Plan the route, find great food and rest stops along the way, and pack exactly what you need for a 48-hour build.</p>
          </div>
          <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> Plan a route</Button>
        </div>
      </div>

      {list.length === 0 ? <EmptyState icon={<Route size={24} />} title="No journeys planned yet" description="Pick a hackathon and your starting city. We'll map the route and surface places worth stopping for." action={<Button variant="primary" onClick={() => setCreateOpen(true)}>Plan your first route</Button>} /> : (
        <>
          <div className="hide-scroll flex gap-2 overflow-x-auto pb-1">
            {list.map((t) => (
              <button key={t.id} onClick={() => { setSelectedId(t.id); setChecked(new Set()); }}
                className={cn('flex min-w-[220px] items-center gap-3 rounded-xl border px-4 py-3 text-left transition',
                  selected?.id === t.id ? 'border-cyan/40 bg-cyan/[.07]' : 'border-white/[.07] bg-white/[.02] hover:border-white/20')}>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: hueColor(t.hackathon.hue, 60, 22), color: hueColor(t.hackathon.hue) }}><MapPin size={16} /></span>
                <span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-200">{t.origin} → {t.hackathon.city}</span><span className="block truncate text-[11px] text-slate-500">{t.distanceKm} km · {Math.round(t.durationMin / 60)}h · {t.mode}</span></span>
              </button>
            ))}
          </div>

          {selected && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  { label: 'Distance', value: `${selected.distanceKm} km`, icon: Route },
                  { label: 'Travel time', value: `${Math.round(selected.durationMin / 60)}h ${selected.durationMin % 60}m`, icon: Navigation },
                  { label: 'Recommended stops', value: selected.suggestions.length, icon: Utensils },
                  { label: 'Event starts', value: fmtShort(selected.hackathon.startAt), icon: Compass },
                ].map((s) => (
                  <Card key={s.label} className="p-4"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{s.label}</span><s.icon size={15} className="text-cyan" /></div><div className="mt-2 text-xl font-bold text-white">{s.value}</div></Card>
                ))}
              </div>

              <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
                {/* Route map */}
                <Card className="overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/[.06] px-5 py-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-white"><MapPin size={14} className="text-cyan" /> {selected.origin} → {selected.hackathon.venue}</div>
                    <div className="flex items-center gap-2"><Badge tone="cyan">{selected.mode}</Badge>{selected.mode !== 'flight' && <a className="text-xs text-cyan underline" href={directionsUrl({ origin: selected.origin, destination: selected.hackathon.address || selected.hackathon.venue || selected.hackathon.city, travelmode: selected.mode === 'car' ? 'driving' : 'transit' })} target="_blank" rel="noopener noreferrer">Open route in Google Maps</a>}</div>
                  </div>
                  <div className="map-grid relative h-[330px] bg-[#080e1b]">
                    <svg viewBox="0 0 600 300" className="h-full w-full">
                      <defs>
                        <linearGradient id="routeG" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#35e6d0" /><stop offset="1" stopColor="#9b7bff" /></linearGradient>
                        <filter id="glow"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                      </defs>
                      <path d={mapPoints.path} fill="none" stroke="url(#routeG)" strokeWidth="12" opacity=".18" filter="url(#glow)" />
                      <path d={mapPoints.path} fill="none" stroke="url(#routeG)" strokeWidth="3" strokeLinecap="round" strokeDasharray="8 6" className="animate-dash" />
                      {selected.route.map((r, i) => {
                        const pts = mapPoints.path.match(/[-\d.]+ [-\d.]+/g) ?? [];
                        const xy = pts[i]?.split(' ') ?? ['0', '0'];
                        return <g key={i}><circle cx={Number(xy[0])} cy={Number(xy[1])} r={i === 0 || i === selected.route.length - 1 ? 7 : 4} fill={i === 0 ? '#35e6d0' : i === selected.route.length - 1 ? '#9b7bff' : '#1c2740'} stroke="#0b1120" strokeWidth="2" />
                          <text x={Number(xy[0]) + 9} y={Number(xy[1]) - 7} fill="#8fa0bd" fontSize="10">{r.name}</text></g>;
                      })}
                      {mapPoints.points.map(({ x, y, place }, i) => (
                        <g key={place.id}><circle cx={x} cy={y} r="9" fill="#0b1120" stroke={place.saved ? '#b8f34a' : '#ffc46b'} strokeWidth="2" />
                          <text x={x} y={y + 3.5} textAnchor="middle" fill={place.saved ? '#b8f34a' : '#ffc46b'} fontSize="9" fontWeight="bold">{i + 1}</text></g>
                      ))}
                    </svg>
                    <div className="absolute bottom-3 left-3 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-[10px] text-slate-400 backdrop-blur">Illustrative route · curated local stops ranked by rating, detour &amp; opening hours</div>
                  </div>
                  <div className="flex flex-wrap gap-2 p-4">{selected.route.map((r, i) => <span key={i} className="chip !text-[10px]">{r.name} <span className="text-slate-600">{r.km} km</span></span>)}</div>
                </Card>

                {/* Suggestions */}
                <Card className="p-5">
                  <SectionHeader eyebrow="Along the way" title="Good stops" subtitle="Ranked for a smooth hackathon journey." />
                  <div className="mb-4 flex flex-wrap gap-2">
                    <Select value={type} onChange={(e) => setType(e.target.value)} className="!w-auto flex-1 !py-2">
                      <option value="">All stop types</option><option value="food">🍜 Food</option><option value="fuel">⛽ Fuel</option><option value="rest">☕ Rest</option><option value="atm">🏧 ATM</option>
                    </Select>
                    <Select value={maxDetour} onChange={(e) => setMaxDetour(Number(e.target.value))} className="!w-auto !py-2">
                      <option value={5}>≤ 5 min detour</option><option value={10}>≤ 10 min</option><option value={20}>≤ 20 min</option><option value={60}>Any detour</option>
                    </Select>
                  </div>
                  <div className="hide-scroll max-h-[420px] space-y-2 overflow-y-auto pr-1">
                    {suggestions.length === 0 && <EmptyState title="No stops in range" description="Widen the detour limit or switch the stop type." />}
                    {suggestions.map((p, i) => {
                      const Icon = PLACE_ICON[p.type];
                      return (
                        <div key={p.id} className={cn('rounded-xl border p-3 transition', p.saved ? 'border-lime/35 bg-lime/[.05]' : 'border-white/[.06] bg-white/[.02]')}>
                          <div className="flex items-start gap-3">
                            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[.05]', PLACE_TONE[p.type])}><Icon size={16} /></span>
                            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><a href={placeSearchUrl(`${p.name} ${p.address}`)} target="_blank" rel="noopener noreferrer" className="truncate text-xs font-bold text-slate-200 hover:text-cyan">{i + 1}. {p.name}</a><span className="flex items-center gap-0.5 text-[10px] text-amber"><Star size={10} fill="currentColor" />{p.rating}</span></div>
                              <div className="mt-0.5 text-[10px] text-slate-500">{p.address} · {p.price} · +{p.detourMin} min</div>
                              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{p.note}</p></div>
                            <button onClick={() => void toggleSave(p)} className={cn('shrink-0 rounded-lg border px-2 py-1 text-[10px] font-semibold transition', p.saved ? 'border-lime/40 bg-lime/10 text-lime' : 'border-white/10 text-slate-400 hover:border-cyan/40 hover:text-cyan')}>
                              {p.saved ? <Check size={12} /> : <Plus size={12} />}
                            </button>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5"><Badge tone={p.openNow ? 'lime' : 'rose'}>{p.openNow ? 'Open now' : 'Check hours'}</Badge><Badge tone="neutral">{p.type}</Badge></div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>

              {/* Checklist */}
              <div className="grid gap-5 lg:grid-cols-[1fr_.6fr]">
                <Card className="p-5">
                  <SectionHeader eyebrow="Before you leave" title="Travel checklist" subtitle={`${checked.size} of ${selected.checklist.length} packed`} />
                  <Progress value={(checked.size / Math.max(1, selected.checklist.length)) * 100} tone="lime" />
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">{selected.checklist.map((item) => (
                    <button key={item.id} onClick={() => setChecked((prev) => { const next = new Set(prev); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })}
                      className={cn('flex items-start gap-2.5 rounded-xl border p-3 text-left transition', checked.has(item.id) ? 'border-lime/30 bg-lime/[.05]' : 'border-white/[.06] bg-white/[.02] hover:border-white/15')}>
                      <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border', checked.has(item.id) ? 'border-lime bg-lime text-[#04121a]' : 'border-white/20')}>{checked.has(item.id) && <Check size={11} />}</span>
                      <span><span className={cn('block text-[11px] leading-relaxed', checked.has(item.id) ? 'text-slate-500 line-through' : 'text-slate-300')}>{item.label}</span><span className="mt-1 block text-[9px] uppercase tracking-wider text-slate-600">{item.category}</span></span>
                    </button>
                  ))}</div>
                </Card>
                <Card className="p-5">
                  <SectionHeader eyebrow="Good to know" title="Journey tips" />
                  <div className="space-y-3">{[
                    { icon: ShieldCheck, title: 'Share your route', text: 'Send the live route to a teammate or family member before a late-night drive.' },
                    { icon: Coffee, title: 'Eat before check-in', text: 'Registration queues are long. A proper meal near the venue saves your first build hours.' },
                    { icon: Landmark, title: 'Arrive a day early for offline events', text: 'You get time to explore the city, meet mentors and sleep before the sprint.' },
                  ].map((t) => <div key={t.title} className="flex gap-3 rounded-xl bg-white/[.02] p-3"><t.icon size={15} className="mt-0.5 shrink-0 text-cyan" /><div><div className="text-xs font-semibold text-slate-200">{t.title}</div><div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{t.text}</div></div></div>)}</div>
                </Card>
              </div>
            </>
          )}
        </>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Plan your journey" description="We'll build a route and surface food, fuel, rest and cash stops along the way.">
        <div className="space-y-4">
          <Field label="Hackathon"><Select value={form.hackathonId} onChange={(e) => setForm({ ...form, hackathonId: e.target.value })}>
            <option value="">Choose a hackathon…</option>{(catalog.data?.items ?? []).map((h) => <option key={h.id} value={h.id}>{h.name} · {h.city}</option>)}
          </Select></Field>
          <Field label="Starting from" hint="City or campus name"><Input value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} placeholder="Mysuru" maxLength={80} /></Field>
          <Field label="Travel mode"><Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as Trip['mode'] })}>
            {['car', 'train', 'bus', 'flight'].map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
          </Select></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void create()}>Build route</Button></div>
        </div>
      </Modal>
    </div>
  );
}
