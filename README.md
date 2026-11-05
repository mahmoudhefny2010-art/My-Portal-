# Control Portal

Control Portal is a private Express and EJS workspace for registering and administering a portfolio of independent websites. The portal stores its own users, project metadata, preferences, health measurements, notifications, and audit references in PostgreSQL. It does not copy client operational data or replace a client site's backend.

## Requirements

- Node.js 20 or newer
- A Neon PostgreSQL database
- A `DATABASE_URL` pooled connection string and a `DIRECT_URL` for Prisma migrations

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env`.
3. In Neon, use the pooled hostname (with `-pooler`) for `DATABASE_URL`; use the direct hostname for `DIRECT_URL`. Keep both values private.
4. Generate three independent secrets and set `SESSION_SECRET`, `RATE_LIMIT_SECRET`, and `INTEGRATION_KEY_ENCRYPTION_KEY`. The last value must be 64 hexadecimal characters. Set a stable `PORTAL_ORIGIN` when testing integrations.
5. Apply the database migration with `npm run db:migrate:dev`.
6. Set `PORTAL_OWNER_NAME`, `PORTAL_OWNER_EMAIL`, and `PORTAL_OWNER_PASSWORD` in the local environment, then run `npm run owner:create`. The command refuses to create a public/default account.
7. Remove the bootstrap password from the environment, then run `npm run dev`.

Open `http://localhost:3000`. The app uses persistent database-backed sessions; it intentionally does not fall back to an in-memory session store if PostgreSQL is unavailable.

### Optional Google sign-in

1. Create a Google OAuth client with the Web application type.
2. Add the exact authorized redirect URI `<PORTAL_ORIGIN>/auth/google/callback` in Google Cloud Console. For local development, use `http://localhost:3000/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` (and in the corresponding Vercel environment when deploying).

Google sign-in is available only to active users already created in **Users & Permissions** or by the owner bootstrap command. On first sign-in, the verified Google email must match the provisioned user's email. The portal then stores Google's stable account subject in a separate identity table, so that account can still sign in if its Google email later changes. Google sign-in does not create public accounts or replace password sign-in.

### Optional OneSignal browser push

1. Create a OneSignal Web Push app and configure its website origin. Use a separate OneSignal app for local testing (`http://localhost:3000`) and production.
2. Copy the OneSignal App ID to `ONESIGNAL_APP_ID` and its REST API key to `ONESIGNAL_REST_API_KEY` in `.env`. Add both as server environment variables in Vercel when deploying. Keep the REST API key private; it is only used by the server.
3. Restart the local server or redeploy Vercel. Sign in, open **Settings → Notifications**, enable browser notifications, and allow the browser permission prompt.

The web SDK uses the separate worker at `/push/onesignal/OneSignalSDKWorker.js`, so it does not replace the portal's root PWA worker. The server sends only to active users whose event preference is enabled and whose browser is subscribed. Project online/offline and signed external admin-change events currently produce notifications; other preference categories will send push once their event producers are implemented. Local push requires `allowLocalhostAsSecureOrigin` (already set by the portal SDK integration) and browser support.

## Database and schema

The Prisma schema is in `prisma/schema.prisma`. `npm run db:migrate:dev` creates development migrations; `npm run db:migrate` applies committed migrations in deployment. Do not use `db push` as a production migration strategy. Generated Prisma Client files are created under `node_modules` by Prisma 6.

Operational products, orders, customers, inventory, and other client data remain in their original websites. The portal stores only metadata required for access management, connectivity measurements, signed audit events, and portal operation.

## Authentication and security

- There is no public registration or default credential.
- Passwords are hashed with Argon2id. The first Super Admin is created by `npm run owner:create`.
- Sessions are stored in PostgreSQL, use HTTP-only SameSite cookies, and expire after eight idle hours.
- Login failures are rate-limited using hashed email/network identifiers stored in PostgreSQL.
- All browser form mutations use session CSRF tokens. The external event endpoint uses timestamped HMAC signatures and event-ID deduplication.
- Project permissions are enforced on server queries. Admin and Developer access must be granted by a Super Admin for each project; User can read assigned projects. Existing database role values remain `ADMIN`, `PROJECT_MANAGER`, and `VIEWER`; Super Admin keeps full portal control.
- Add Project accepts public HTTPS URLs only, rejects credentials/query strings, pins the resolved public address for the request, blocks private/reserved network destinations, and revalidates redirect destinations.
- The portal never disables a client's X-Frame-Options or Content-Security-Policy.

## Project integration states

Registering an Admin URL is separate from verifying its integration. A project can be saved while the target is unreachable. HTTP checks report reachability, not authentication or dashboard functionality. Embedding becomes available only after the response policy explicitly allows the portal and an authorized portal manager attests that sign-in, navigation, forms, and an authorized write action worked in a browser.

Signed client audit events can be received after the original application implements the contract in [docs/PORTAL_INTEGRATION.md](docs/PORTAL_INTEGRATION.md). Live data synchronization and optimistic concurrency are specifications for changes required in each original application; the portal marks them pending until a compatible client implementation exists. No client websites are connected in this repository.

## Monitoring

Manual checks are available per project and in batches of up to 20. Vercel Cron is configured for one daily run at 05:00 UTC; each invocation checks up to 20 due projects. A backlog of 50+ projects can take multiple daily runs. Response time and observed availability use real recorded checks only. The dashboard shows `—` until checks exist and reports a sample percentage, not continuous uptime.

The cron function requires `CRON_SECRET`. Vercel runs Cron Jobs on the production deployment. The daily schedule fits the Hobby plan's once-per-day limit; check the current plan limits before choosing a more frequent schedule.

## Tests and checks

- `npm test` runs deterministic unit tests with Node's test runner.
- `npm run build` generates Prisma Client.
- `npm run db:migrate:dev` requires a configured Neon database.
- Browser review requires a configured database, a bootstrap owner, and a reachable local server.

Never report external embedding, synchronization, conflict prevention, or audit ingestion as verified unless a compatible client application has been configured and measured.

## Vercel deployment

Vercel supports Express applications as Node.js functions. The `api/index.js` entry exports the Express app and `vercel.json` routes requests to it. The separate cron function handles scheduled monitoring; no permanent timer or in-memory session state is used.

1. Add this project to the intended Vercel account and repository.
2. Configure `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, `RATE_LIMIT_SECRET`, `INTEGRATION_KEY_ENCRYPTION_KEY`, `CRON_SECRET`, `PORTAL_NAME`, and `PORTAL_ORIGIN` in Vercel for production and preview environments. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to enable Google sign-in.
3. Apply migrations with `npm run db:migrate` against each target database before deploying the new application code. This includes the additive Google identity table migration.
4. Run `npm run build`, then deploy from the intended GitHub repository.
5. Run `npm run owner:create` from a secure environment connected to the production database, or use a documented one-off administrative environment. Remove bootstrap variables immediately afterward.
6. Check `/readyz`, sign in, review the production headers and cookies, and verify the daily cron is registered.

This repository has not been pushed or deployed. No paid service has been purchased.

## Project structure

- `src/app.js`: Express middleware and route setup
- `src/routes/`: portal routes and server-side authorization
- `src/controllers/`: login and signed event handlers
- `src/services/`: project, monitoring, audit, authentication, and secret handling
- `src/views/`: EJS pages and reusable project card
- `public/`: responsive theme, PWA manifest, static asset cache, and offline page
- `prisma/`: schema and migrations
- `docs/`: integration and deployment contracts

The PWA caches only public static assets. It never caches authenticated pages or API responses; offline use shows a generic reconnect page and requires a network connection to sign in or load portal data.
