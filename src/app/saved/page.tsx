'use client';

import Link from 'next/link';
import { Bookmark, Compass } from 'lucide-react';
import { AuthGate } from '@/components/AppShell';
import { useApi } from '@/lib/api-client';
import { HackathonCard } from '@/components/HackathonCard';
import { EmptyState, SectionHeader } from '@/components/ui';
import type { Hackathon, Paged } from '@/lib/types';

export default function SavedPage() {
  return <AuthGate><SavedContent /></AuthGate>;
}

function SavedContent() {
  const result = useApi<Paged<Hackathon>>('/hackathons?status=saved&pageSize=24');
  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Your shortlist" title="Saved opportunities" subtitle="Bookmarked hackathons stay here until you apply, track them, or remove them."
        action={<Link href="/hackathons" className="btn btn-outline !py-2 !text-xs"><Compass size={13} /> Discover more</Link>} />
      {!result.data ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-[360px] rounded-2xl" />)}</div>
        : result.data.items.length === 0 ? <EmptyState icon={<Bookmark size={24} />} title="Nothing saved yet" description="Tap the bookmark icon on any hackathon card to keep it here." action={<Link href="/hackathons" className="btn btn-primary">Browse hackathons</Link>} />
          : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{result.data.items.map((h) => <HackathonCard key={h.id} hackathon={h} onChange={result.reload} />)}</div>}
    </div>
  );
}
