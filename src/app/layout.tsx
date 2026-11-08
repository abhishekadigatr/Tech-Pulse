import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProviders } from '@/components/providers';
import { RootChrome } from '@/components/RootChrome';

export const metadata: Metadata = {
  title: { default: 'Tech Pulse — Hackathon OS', template: '%s · Tech Pulse' },
  description: 'Discover hackathons, apply through official links, track applications, find teammates, chat end-to-end encrypted, and plan your journey with reminders.',
  applicationName: 'Tech Pulse',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, themeColor: '#060912',
};

// A per-request CSP nonce cannot be baked into statically generated HTML.
// Dynamic rendering keeps every script tag nonce-bearing in production.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="nebula" suppressHydrationWarning>
      <body>
        <AppProviders>
          <RootChrome>{children}</RootChrome>
        </AppProviders>
      </body>
    </html>
  );
}
