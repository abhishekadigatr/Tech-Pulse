import { NextRequest, NextResponse } from 'next/server';
import { buildCsp, frameOptions } from '@/lib/csp';
import { accessDecision, protectedPage } from '@/lib/access';

/**
 * Security headers for every response. Production uses a per-request CSP nonce;
 * the custom server injects the same nonce into the raw request headers so
 * Next.js attaches it to every script tag it renders. Development relaxes
 * script rules for HMR only.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const production = process.env.NODE_ENV === 'production';
  const injected = request.headers.get('x-nonce');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const fallback = btoa(String.fromCharCode(...bytes));
  const nonce = production ? (injected || fallback) : '';
  const csp = buildCsp(nonce, production);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-tp-internal-auth-origin');
  if (production) {
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);
  }

  let response: NextResponse;
  if (protectedPage(request.nextUrl.pathname)) {
    // Query the authoritative Node/SQLite session. The address is set only by
    // the custom server, never from a request header; failures are closed.
    const internalOrigin = request.headers.get('x-tp-internal-auth-origin');
    try {
      if (!internalOrigin || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(internalOrigin)) throw new Error('Missing local auth service');
      const authResponse = await fetch(`${internalOrigin}/api/v1/auth/me`, {
        headers: { cookie: request.headers.get('cookie') ?? '' }, cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!authResponse.ok) throw new Error('Authentication service unavailable');
      const payload = await authResponse.json() as { me: { totpEnabled: boolean; aal2: boolean } | null };
      const decision = accessDecision(request.nextUrl.pathname, payload.me, request.nextUrl.searchParams.get('enroll') === '2fa');
      if (decision !== 'allow') {
        const target = decision === 'enroll' ? '/settings?enroll=2fa' : decision === 'step-up' ? '/login?stepup=1' : '/login';
        response = NextResponse.redirect(new URL(target, request.url));
      } else response = NextResponse.next({ request: { headers: requestHeaders } });
    } catch { response = new NextResponse('Authentication service unavailable', { status: 503 }); }
  } else response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  const xfo = frameOptions(process.env.FRAME_ANCESTORS);
  if (xfo) response.headers.set('X-Frame-Options', xfo);
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
