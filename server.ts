import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { parse } from 'node:url';
import next from 'next';
import nextEnv from '@next/env';
import { db, seedAccounts } from './src/server/db.ts';
import { attachWebSocketHub } from './src/server/ws-hub.ts';
import { startScheduler } from './src/server/scheduler.ts';
import { buildCsp, frameAncestors } from './src/lib/csp.ts';

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
// Validate once at startup; middleware and the custom server use the same policy.
frameAncestors(process.env.FRAME_ANCESTORS);

/* CLI: npm run dev:host -- --port 3001  ·  npm run dev:host -- 3001 */
const argv = process.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
};
const positionalPort = argv.find((a) => /^\d{2,5}$/.test(a));

const dev = process.env.NODE_ENV !== 'production';
const hostname = flagValue('--host') || process.env.HOST || '0.0.0.0';
const port = Number(flagValue('--port') || positionalPort || process.env.PORT || 3000);
// Local development works without configuration; preview/public hosts must set APP_ORIGIN.
if (dev && !process.env.APP_ORIGIN) process.env.APP_ORIGIN = `http://localhost:${port}`;

async function main(): Promise<void> {
  db();                 // schema + curated catalogue
  await seedAccounts(); // demo accounts only outside production

  const app = next({ dev, hostname, port, dir: process.cwd() });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer((req, res) => {
    // Overwrite any client-supplied value; used only for local session introspection.
    req.headers['x-tp-internal-auth-origin'] = `http://127.0.0.1:${port}`;
    if (!dev) {
      // Next reads the CSP from the raw request headers to attach the nonce
      // to its bootstrap scripts. Middleware reuses this exact value for the
      // response header, so the policy and the emitted tags always agree.
      const nonce = randomBytes(16).toString('base64');
      req.headers['x-nonce'] = nonce;
      req.headers['content-security-policy'] = buildCsp(nonce, true, process.env.FRAME_ANCESTORS);
    }
    void handle(req, res, parse(req.url ?? '/', true));
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  const hub = attachWebSocketHub(server);
  const stopScheduler = startScheduler();

  server.listen(port, hostname, () => {
    console.log(`\n  ✦ Tech Pulse ready  →  http://${hostname}:${port}  (${dev ? 'development' : 'production'})`);
    console.log(`    REST /api/v1  ·  WebSocket /ws  ·  SQLite .data/tech-pulse.db\n`);
  });

  const shutdown = (signal: string): void => {
    console.log(`\n[server] ${signal} received, shutting down…`);
    stopScheduler();
    hub.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[server] failed to start', error);
  process.exit(1);
});
