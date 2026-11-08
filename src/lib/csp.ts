/** FRAME_ANCESTORS accepts CSP source expressions; reject directive injection. */
export function frameAncestors(configured?: string): string {
  const value = configured?.trim() || "'self'";
  const sources = value.split(/\s+/);
  const valid = sources.every((source) => source === "'self'" || source === "'none'" ||
    /^https?:\/\/(?:\*\.)?[a-zA-Z0-9.-]+(?::\d+)?$/.test(source));
  if (!valid || (sources.includes("'none'") && sources.length !== 1)) throw new Error('Invalid FRAME_ANCESTORS');
  return sources.join(' ');
}
export function frameOptions(configured?: string): 'DENY' | 'SAMEORIGIN' | undefined {
  const ancestors = frameAncestors(configured);
  return ancestors === "'none'" ? 'DENY' : ancestors === "'self'" ? 'SAMEORIGIN' : undefined;
}
/** Shared CSP policy builder — pure code, safe in both Node and Edge runtimes. */
export function buildCsp(nonce: string, production: boolean, ancestors = process.env.FRAME_ANCESTORS): string {
  const scriptSrc = production ? `'self' 'nonce-${nonce}' 'strict-dynamic'` : `'self' 'unsafe-inline' 'unsafe-eval'`;
  return [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "form-action 'self'",
    `frame-ancestors ${frameAncestors(ancestors)}`,
    `script-src ${scriptSrc}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "font-src 'self' data:", "connect-src 'self' ws: wss:", "worker-src 'self' blob:",
    "manifest-src 'self'", "media-src 'self' blob:", ...(production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}
