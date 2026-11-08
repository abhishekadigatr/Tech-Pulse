/** Shared CSP policy builder — pure code, safe in both Node and Edge runtimes. */
export function buildCsp(nonce: string, production: boolean): string {
  const scriptSrc = production
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `'self' 'unsafe-inline' 'unsafe-eval'`;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    // The Arena preview embeds the app in an iframe. Remove this on a
    // self-hosted deployment and add X-Frame-Options: DENY instead.
    "frame-ancestors 'self' https://*.e2b.app",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    ...(production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}
