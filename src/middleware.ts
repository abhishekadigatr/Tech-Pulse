import { NextRequest, NextResponse } from 'next/server';
import { buildCsp } from '@/lib/csp';

/**
 * Security headers for every response. Production uses a per-request CSP nonce;
 * the custom server injects the same nonce into the raw request headers so
 * Next.js attaches it to every script tag it renders. Development relaxes
 * script rules for HMR only.
 */
export function middleware(request: NextRequest): NextResponse {
  const production = process.env.NODE_ENV === 'production';
  const injected = request.headers.get('x-nonce');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const fallback = btoa(String.fromCharCode(...bytes));
  const nonce = production ? (injected || fallback) : '';
  const csp = buildCsp(nonce, production);

  const requestHeaders = new Headers(request.headers);
  if (production) {
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  if (production) response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|sw.js|manifest.webmanifest).*)'],
};
