# Tech Pulse — Hackathon OS

A complete, runnable hackathon workspace: **discover** verified events → **apply** through a direct official link → **track** applications in an inbox → **find teammates** → **chat end-to-end encrypted over WebSockets** → **get reminded** on a calendar → **plan the journey** with route-aware food, fuel and rest tips.

Built as **one Next.js 15 full-stack application**. There is no separate API server, no duplicate data layer and no external service required to run it.

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000  (binds 0.0.0.0 for previews)
```

That is it. On first boot the app creates `.data/tech-pulse.db` (SQLite via Node's built-in `node:sqlite`), applies the schema, seeds 14 hackathons and 23 journey places, and starts the reminder worker.

Other useful commands:

| Command | Purpose |
| --- | --- |
| `npm run dev:host -- --port 3001` | Bind to `0.0.0.0` on a custom port (also accepts `npm run dev:host -- 3001`) |
| `npm run build && npm start` | Production build + custom server |
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | Runtime-hazard ESLint rules (`tsc` covers the rest) |
| `npm test` | Unit tests for crypto, validation, CSRF and rate limiting |
| `npm run e2e` | Full API/flow smoke test against a running server |
| `npm run db:reset` | Wipe and re-seed the local database |
| `npm run audit` | Production dependency audit |

### Demo accounts (development only)

Demo users are disabled by default and are never seeded in production. To opt in for a fresh development database, set `SEED_DEMO=1` and set `DEMO_EMAIL`, `DEMO_PASSWORD`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in `.env.local` to disposable values. The development-only hint endpoint exposes these credentials to local clients, so do not enable this on a public server. Both users must enroll in 2FA through Settings before accessing the workspace; no TOTP code is displayed by the server. Existing databases are not automatically reseeded or scrubbed: remove old demo accounts and rotate any previously published credentials before deploying an existing database.

---

## What was fixed

The repository originally contained **only a README** describing a Next.js + Supabase app — none of the referenced source, migrations, routes or tests existed. Everything described below was implemented from scratch as a single coherent codebase, with the security gaps in the original concept closed rather than documented as future work.

---

## Architecture

```
Browser (Next.js App Router, React 19, Tailwind)
   │  HTTPS REST  /api/v1/*  (same-origin, CSRF-protected)
   │  WSS         /ws        (one-time ticket, one shared socket)
   ▼
Custom Node server (server.ts) ── next() handler + ws hub + reminder worker
   │
   ├─ /api/v1/[[...path]]  → one router with Zod validation, auth, rate limits
   ├─ src/server/routes/*  → auth, users, catalog, applications, social, planning, admin
   ├─ src/server/db.ts     → SQLite schema + idempotent curated seed
   ├─ src/server/crypto.ts → Argon2id, AES-256-GCM, HKDF, TOTP, signed tokens
   └─ src/lib/client-crypto.ts → WebCrypto E2EE + 2-step vault (browser side)
```

**Why one app:** the spec suggested a Next.js + NestJS + Postgres + Redis + BullMQ monorepo. That is appropriate at scale, but here it would mean two servers, two type surfaces and infrastructure that cannot run in this environment. A single Next.js app with a custom server for WebSockets delivers every feature with zero redundancy: one shared type file (`src/lib/types.ts`), one API router, one encrypted-message write path (`src/server/messages.ts`) shared by WebSocket and REST, one realtime connection per browser, one SQLite database with FK-enforced relations.

### Data model

`users`, `user_settings`, `vaults`, `devices`, `sessions`, `refresh_tokens`, `ws_tickets`, `audit_log`, `hackathons`, `bookmarks`, `apply_clicks`, `applications`, `teams`, `team_members`, `team_requests`, `seekers`, `conversations`, `conversation_members`, `messages`, `calendar_events`, `reminders`, `notifications`, `push_subscriptions`, `trips`, `trip_saved_places`, `journey_places`, `ingest_log`.

---

## Features

1. **Auth & 2FA** — Argon2id passwords, email verification, TOTP setup with QR + recovery codes, MFA-gated admin, 15-minute sessions with rotating refresh tokens, session list/revoke, password reset, audit log.
2. **User settings & 2-step encrypted storage** — profile, notification/privacy/theme preferences, data export, account deletion. Private vault data is encrypted **in the browser** (PBKDF2-SHA256 210k → AES-256-GCM) and then **again on the server** (AES-256-GCM with a per-user HKDF key). New application and calendar notes use browser-side AES-GCM with a random per-user key wrapped by a separate PBKDF2 passphrase. Existing server-sealed notes remain readable and are re-encrypted on edit. If the notes passphrase is lost, the server cannot recover these new notes.
3. **Hackathons** — search, filters (format, city, tag, status, sort), pagination, facets, detail pages, bookmarks, and a logged `/apply-link` that validates HTTPS before a 302 redirect to the organiser.
4. **Inbox / applications** — "I applied" tracking with four statuses, encrypted notes, unified inbox of applications, notifications and team requests; auto-adds deadline + event dates to the calendar.
5. **Collaborate** — team listings per hackathon, skill-matched seekers, join requests, accept/reject, member removal with chat-key rotation, and automatic encrypted conversation creation on acceptance.
6. **Secure chat over WebSockets** — non-extractable P-256 device key in IndexedDB, ECDH→HKDF wrapping of a random AES-256-GCM conversation key per member, fresh nonce per message, typing, presence, read receipts, cursor pagination, key rotation, and a ciphertext-only REST fallback. The server stores **only ciphertext**.
7. **Calendar & reminders** — month grid, study/apply/hackathon/travel blocks, configurable 7d/1d/2h offsets, idempotent server-side reminder worker, in-app + browser notifications and a subscribable ICS feed.
8. **Journey tips** — trip creation, generated route with distance/time, ranked food/fuel/rest/ATM stops (rating, detour, open-now), saved stops, an SVG route map and a travel checklist.
9. **Admin & ingestion** — MFA-gated console with stats, audit trail, manual CRUD, reminder sweep and an optional HTTPS JSON feed (validated, `approval_status=approved` only, deduplicated by URL, 5-minute cache).

### Routes

`/` · `/hackathons` · `/hackathons/[slug]` · `/saved` · `/inbox` · `/collaborate` · `/chat` · `/chat/[conversationId]` · `/calendar` · `/journey` · `/learn` · `/settings` · `/login` · `/admin` · `/about` · `/privacy`

### API (`/api/v1`)

All resources from the concept are implemented behind a single catch-all router: `auth/*` (register, login, refresh, logout, verify-email, forgot/reset, 2fa setup/confirm/verify/disable, sessions, ws-ticket), `users/me` (+ settings, vault, devices, public-keys, export), `hackathons` (+ bookmark, apply-link), `applications`, `inbox`, `teams`, `seekers`, `team-requests`, `conversations` (+ messages, keys, rotate-key, read), `calendar` (+ sync-hackathon, ics), `notifications`, `push/subscribe`, `trips` (+ route, suggestions, checklist, save), `facets`, `search`, `health`, `admin/*`. Responses share one error shape `{ error, code?, details? }`.

---

## Security

| Area | Implementation |
| --- | --- |
| Passwords | Argon2id (64 MiB, t=3, p=1), per-user salt, dummy hash for unknown accounts |
| Sessions | Opaque random tokens stored hashed, HttpOnly + SameSite=Lax + Secure-in-prod cookies, rotation revokes the previous refresh token |
| CSRF | Same-origin check **plus** session-bound double-submit token on every write |
| WebSocket | One-time 30-second ticket (never a session cookie in a URL), cross-origin handshake rejection, per-socket rate limit, heartbeat |
| Input | Zod schemas, 32 KB body cap, strict URL validation, parameterised SQL everywhere |
| Headers | CSP with per-request nonce in production (dev relaxes only for HMR), COOP, CORP, Referrer-Policy, Permissions-Policy, HSTS, nosniff; `frame-ancestors` allows the Arena preview iframe |
| Encryption | AES-256-GCM envelopes, HKDF per-user data keys, encrypted TOTP secrets, hashed recovery codes, E2EE chat |
| Authorisation | Every private route re-checks the session; admin additionally requires `role=admin` **and** `aal2`; no role-update endpoint exists |
| Limiting | Sliding-window in-process limiter on auth, writes, clicks and the global API |
| Audit | Login failures, MFA events, admin actions, vault writes, apply clicks, account deletion |

Production requires SMTP credentials and the secrets below. Configure a VAPID push provider separately, store secrets securely, and use a durable SQLite volume and backups. The optional SQLite rate-limit store survives restarts.

### Environment

Copy `.env.example` → `.env.local`. All values are optional in development.

| Variable | Meaning |
| --- | --- |
| `DATA_ENCRYPTION_KEY` | 32-byte hex master key for server-side AES-256-GCM / HKDF (required in prod) |
| `AUTH_SIGNING_KEY` | 32-byte hex key for MFA challenges and short-lived tokens (required in prod) |
| `NEXT_PUBLIC_SITE_URL`, `HOST`, `PORT` | Public origin and bind address |
| `OPPORTUNITIES_SHEET_FEED_URL` | Optional HTTPS JSON feed of hackathon rows |
| `OSRM_BASE_URL`, `OVERPASS_BASE_URL` | Reserved for live routing/places providers |
| `SEED_DEMO`, `DEMO_EMAIL`, `DEMO_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Opt-in disposable development accounts; ignored in production |
| `SMTP_URL`, `MAIL_FROM` | SMTP provider URL and sender; required in production |
| `RATE_LIMIT_STORE` | `memory` (default) or `sqlite` for persistent rate limits |
| `TRUSTED_PROXY` | Set to `1` only when a trusted proxy strips and rewrites X-Forwarded-For |
| `APP_ORIGIN` | Canonical public origin for CSRF checks; required in production |
| `FRAME_ANCESTORS` | CSP framing sources; defaults to `'self'`. For Arena preview use `'self' https://*.e2b.app`; external sources omit X-Frame-Options |

SMTP uses TLS (STARTTLS for `smtp:`). Verification/reset codes expire after 15 minutes, allow five attempts and have a 60-second resend cooldown. Existing unverified accounts must request a new verification code after upgrading.

Generate secrets with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

---

## Tests & CI

`npm test` covers AES-GCM round-trip and tamper detection, per-user key isolation, Argon2id, RFC 6238 TOTP vectors, signed-token expiry, CSRF/same-origin rejection, Zod validation, body caps, HTTPS redirect validation, rate limiting and mapping defaults. `npm run e2e` exercises the complete register → verify → apply → inbox → calendar → trip → encrypted message → logout flow against a live server. GitHub Actions runs typecheck, lint, unit tests and a production build.

---

## Assumptions (sensible defaults, no questions asked)

1. **Zero-infrastructure runtime.** SQLite via `node:sqlite` and an in-process reminder worker replace Postgres/Redis/BullMQ so the app runs immediately. The interfaces are isolated so swapping them is a one-file change.
2. **No third-party credentials.** Without SMTP, verification/reset codes appear in the UI only in development. Production requires SMTP_URL and MAIL_FROM; configure a provider such as Brevo. Web push uses browser notifications + stored subscriptions rather than a live push service.
3. **Journey data is curated and offline.** The sandbox has no access to Google Places/OSRM, so routes and food/fuel/rest suggestions come from a local seeded dataset with deterministic geo-projections. Provider URLs are reserved in `.env.example`.
4. **P-256 ECDH instead of X25519** for device keys, because P-256 is universally supported by WebCrypto today; HKDF-SHA256 and AES-256-GCM are unchanged.
5. **Demo seed accounts** are opt-in and restricted to development; credentials come from the environment.
6. **Framing and origins.** Framing defaults to same-origin. Set `FRAME_ANCESTORS` to explicitly allow external embedding and `APP_ORIGIN` to the public origin for preview or reverse-proxy deployments. Development defaults to `http://localhost:<port>`. Restart the custom server after changing these values.
7. **Chat key recovery.** A lost device loses its history — the honest consequence of real E2EE. An encrypted key backup would require a passphrase escrow design and was intentionally left out of this build.
8. **Admin promotion stays manual SQL.** No public role-update path exists, matching the original security note: `update public.profiles set role = 'admin' ...` becomes `update users set role='admin' where id='<verified-user-id>'`.
