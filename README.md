# Tech Pulse

Tech Pulse is a Next.js 15 + TypeScript student opportunity platform backed by Supabase.

## Local setup

1. Copy `.env.example` to `.env.local`. The app runs with local demo opportunities when Supabase is absent.
2. Run the migration in `supabase/migrations/001_initial.sql` using the Supabase CLI or SQL editor.
3. Install and start: `npm install`, `npm run dev`.

For another device on the same network, use `npm run dev:host` and open the Network URL printed by Next. To select a port, both `npm run dev:host -- --port 3001` and `npm run dev:host -- 3001` are supported. For a production server, use `npm run build` followed by `npm run start:host`.

All public listing and team content is read from Supabase. Admin role changes must be performed manually in SQL; the application never exposes a role update path. Enable Supabase Auth email verification and MFA before production use.

### Google Sheets feed

Hackathon details can be maintained by a Google Apps Script published as a JSON web app. Set `OPPORTUNITIES_SHEET_FEED_URL` to the HTTPS deployment URL. The endpoint may return either an array of opportunity objects or `{ "opportunities": [...] }`; rows with `approval_status` other than `approved` are ignored. The server fetches the feed with a five-minute cache, validates required identifiers/URLs before rendering, and never exposes a sheet credential to the browser.

Each row should include `id`, `slug`, `name`, `organizer`, `description`, `domain`, `mode`, `deadline` (ISO timestamp), and `official_url`; optional fields match `Opportunity` in `src/lib/types.ts`.

## Security notes

RLS is enabled on every table, admin pages re-check the database role and MFA state, state-changing submission requests validate strict Zod schemas, enforce HTTPS URLs, check origin, and cap bodies. Production should configure an Upstash-backed rate limiter and Turnstile verification at the edge, plus a CSP nonce middleware (the static CSP header is intentionally conservative and should be replaced with request nonces before deployment).

The application includes local fallbacks for rate limiting and Turnstile verification. Production should configure Supabase MFA/email settings, Upstash Redis, Cloudflare Turnstile, KMS-compatible key management, storage policies, Vercel environment variables, and a managed secrets scanner. No service-role key is used by this application.

## Routes

Public: `/`, `/hackathons`, `/hackathons/[slug]`, `/about`, `/saved`, `/calendar`, `/learn`, `/community`, `/compare`, `/submit`, `/privacy`.

The product flow also includes `/inbox` for applied events, `/collaborate` for teammate discovery, and `/chat/[conversationId]` for encrypted realtime conversations over Supabase Realtime WebSockets. The calendar workspace supports private study/travel/event blocks and city-aware journey tips; admins can publish food, travel and event guidance in `journey_tips`.

Admin: `/login`, `/admin`, `/admin/team`, `/admin/audit`. Admin access requires a database `profiles.role = 'admin'` row and an MFA-authenticated (`aal2`) Supabase session. Promotion is manual SQL only.

To promote an already verified account, run a reviewed SQL statement in Supabase:

```sql
update public.profiles set role = 'admin' where id = '<verified-auth-user-uuid>';
```

## Tests and checks

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`, and `npm run audit`. The CI workflow runs these checks plus secret scanning. `npm run lint` intentionally uses the strict TypeScript check because the legacy Next ESLint bridge is incompatible with the installed flat-config toolchain; production builds skip that bridge and still run Next type validation.

## Vercel

Set the variables in `.env.example`, including `NEXT_PUBLIC_SITE_URL`, Supabase, Turnstile, Upstash, KMS, and OAuth flags. Configure exact Supabase OAuth redirect URLs to `${NEXT_PUBLIC_SITE_URL}/auth/callback`. Deploy with a committed lockfile and run migrations before opening traffic.
