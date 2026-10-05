# Scouting Website Quickscan

Laravel 12 + React 19, with the exact Neobrutalism.com r4GW theme. Public Dutch
one-pager; SOL 3.0 OpenID Connect is mandatory to submit scans or read reports.
One Docker image runs the web app and its database queue worker. The bundled
TypeScript/Playwright scanner runs locally from Laravel jobs; there is no separate
scanner host, Fastify API, Redis service, or Vite server in production.

See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) for the production review,
remaining acceptance gates, monitoring, backups and rollback procedure.

## Docker Setup

Docker and Docker Compose are the only host prerequisites. From the repository
root, create the app environment once and generate its persistent key:

```powershell
if (-not (Test-Path apps/web/.env)) { Copy-Item apps/web/.env.example apps/web/.env }
docker compose run --rm quickscan php artisan key:generate
```

Set `APP_URL=http://localhost:8000` in `apps/web/.env`, then build and start the
single container:

```sh
docker compose up --build
```

Open http://localhost:8000. Startup runs migrations; the named Docker volume
persists the SQLite database, Laravel state, and private scan artifacts. The
container runs one scan job at a time. No host Node.js, Composer, Redis, or
Playwright installation is needed.

## SOL 3.0 Configuration

Register a confidential authorization-code client with the organization. Do not
invent an issuer URL or rely on email domains. Add these values to the Laravel
environment, never to frontend code:

```dotenv
OIDC_ISSUER=https://your-organization-issuer.example
OIDC_CLIENT_ID=registered-client-id
OIDC_CLIENT_SECRET=configure-directly-on-server
OIDC_REDIRECT_URI=https://quickscan.example/auth/sol/callback
OIDC_SCOPES="openid profile"
OIDC_MEMBERSHIP_CLAIM=organization.groups
OIDC_MEMBERSHIP_VALUES=scouting-member
```

The claim/value above are illustrative, not known SOL claims. Obtain the actual
membership claim, scopes and accepted values from your SOL administrator. The
membership claim must be present in the **verified ID token**, not just userinfo.
Dot notation supports nested claims. A scalar string or array of strings is
matched strictly against the comma-separated allowed values. Missing configuration,
missing claims and non-members are denied. An email address is not membership proof.

The OIDC library validates token signature/JWKS, issuer, audience, expiration,
state and nonce. S256 PKCE is used when advertised by the provider. Only the
authorization-code callback is accepted. OIDC state uses Laravel's database
session, not a separate native PHP session. Account identity is a hash of issuer
and subject; email is not used to merge identities. Membership is rechecked on
login and the local session expires after two hours; this is not continuous SOL
revocation checking. Logout ends the local app session, not all SOL sessions.

Test a real member, non-member, denied consent, expired token and replayed callback
against the organization's provider before production acceptance.

## Development Without SOL

For local development only, set `APP_ENV=local` and `DEV_SOL_BYPASS=true` in
`apps/web/.env`. Every web request automatically signs in the same Development
account (`development@oidc.invalid`); its scan history persists. It is not an admin
by default. Logout cannot keep you signed out while this mode is enabled.
The bypass is ignored outside the `local` environment and never establishes a
SOL-verified membership session. Keep it disabled on public deployments.

Docker reads `APP_ENV` from `apps/web/.env`. After changing environment values,
recreate the container and clear cached configuration:

```powershell
docker compose up -d --build --force-recreate quickscan
docker compose exec quickscan php artisan config:clear
```

## Admin Accounts

Apply the migration with `php artisan migrate` from `apps/web` (Docker startup
applies migrations automatically). Existing and new accounts default to non-admin.
Grant admin rights to an existing account by its database ID or stored email:

```powershell
docker compose exec quickscan php artisan quickscan:admin <account-id>
docker compose exec quickscan php artisan quickscan:admin <account-id> --revoke
```

Without Docker, run the same Artisan commands from `apps/web`. Find the account ID
in the `users` table; the development account has `oidc_key=development`.
After opening the homepage once, promote the development account with
`php artisan quickscan:admin development@oidc.invalid`.
Admins bypass daily personal/global quotas, the pending-scan limit, and the
submission throttle. Their scans still count toward daily totals. Consent, public
URL validation, SOL authentication outside development, and owner-only report
access remain mandatory. Admin rights cannot be assigned through scan submissions.

## Production Deployment

Use `docker-compose.production.yml` as a standalone Compose file and start from
`apps/web/.env.production.example`, keeping real secrets in `apps/web/.env.production`.
The production file forces safe environment/session defaults, binds only to
localhost, caps resources and enables the Chromium sandbox using the pinned
Playwright seccomp profile. Do not combine it with the local Compose file.
Startup fails on an unsafe environment, missing APP_KEY/SOL settings or an invalid
queue retry window. See the [launch runbook](PRODUCTION_READINESS.md) before publishing.

Set `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL` to the public HTTPS origin,
`SESSION_SECURE_COOKIE=true`, `DEV_SOL_BYPASS=false`, a persistent `APP_KEY`, and the verified SOL settings
in `apps/web/.env`. Put the container behind a TLS reverse proxy, restrict scanner
egress from private, loopback, link-local, and metadata networks, and persist the
`quickscan-storage` volume. Do not publish the repository root, `.env`, or storage.

The image builds the React assets and scanner, installs production PHP/Node
dependencies, and runs Apache plus one database queue worker in the same container.
Reports are owner-protected and rendered from structured results in the database. The
container defaults to SQLite and a single queue worker; use a managed MySQL or
PostgreSQL database if you later need more write concurrency.

## Report Storage

Each scan stores one JSON `results` column: page title/URL, technical statuses,
scores and details, AI criterion scores/explanations/improvements, availability
information and generation time. No rendered HTML, PDF, screenshots or complete
captured pages are stored in this column. Status responses exclude these results.
The React report reuses the existing neobrutalist components; PDF generation and
downloads have been removed. The owner-only JSON export remains available.

Docker startup migrates the database and imports existing JSON reports. For a
non-Docker installation, run from `apps/web`:

```sh
php artisan migrate --force
php artisan quickscan:import-reports
php artisan queue:restart
```

The import is repeatable and removes old HTML/PDF/JSON report files only after
their validated results are saved. Invalid or missing legacy data is reported
and existing files are preserved. Fix those files and rerun the import. Newly
generated temporary report JSON is removed after the job commits its results.
Captured pages and screenshots remain private scan artifacts; apply a separate
retention policy to those files.

### Action Priorities

"Begin hiermee" ranks technical and AI findings together, without another AI
request. Priority is impact weight times score deficit: `(100 - score) / 100`
for technical checks and `(5 - score) / 4` for AI criteria. These are explicit
editorial weights for Scouting websites, not a universal quality standard:

| Weight | Topics |
| --- | --- |
| 100 | Exposed configuration files |
| 95 | HTTPS |
| 90 | Call to action / joining |
| 85 | Mobile usability/experience, accessibility, information architecture |
| 80 | Speed, links/media, contact/privacy |
| 75 | Indexability, volunteer recruitment |
| 70 | Security headers |
| 65 | Freshness, language |
| 50 | SEO basics, imagery; fallback for new topics |
| 40 | CMS version disclosure |
| 25 | Social metadata |
| 20 | Structured data |

Only technical warnings/failures and AI scores below 4 with sufficient evidence
are eligible. Unavailable checks and passing results do not enter the ranking.
Equal priorities use higher impact, then criterion key as deterministic ties.
Technical/AI mobile findings share one topic; only the highest-priority one is
selected. The report shows up to three distinct actions, never fabricated ones
to fill empty slots. Existing reports are ranked on display from their stored
results. Adjust weights in `apps/web/resources/js/report-priorities.ts`.

## Operational Gates

- Optional GEMINI_API_KEY enables AI analysis and GOOGLE_PAGESPEED_API_KEY enables
  PageSpeed. Missing services are reported as unavailable, never as a passing test.
- The container must have an outbound firewall that denies loopback/private,
  link-local, cloud-metadata and reserved networks for both IPv4 and IPv6. URL/DNS
  validation alone is not sufficient protection against DNS rebinding. Isolate
  workers from databases, credentials and the webserver using network policy.
- The queue worker runs as a non-root user; do not use Chromium's no-sandbox flag as a
  workaround for a host without browser sandbox support.
- Set a report retention policy and automate private-artifact and old scan cleanup
  appropriate to your organization's privacy requirements. Back up APP_KEY/database,
  monitor queue:failed and logs, and establish capacity limits before a broad rollout.
- Real SOL login, target-host network policy and production-host acceptance
  remain gates recorded in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

## Verification

```sh
npm run typecheck
npm test
npm run build
cd apps/web
php artisan test
```

The real browser/job integration test is opt-in because it requires installed
Chromium and network access. From the Laravel directory on Windows:

```powershell
$env:RUN_BROWSER_SCAN_TEST = '1'
$env:RUN_BROWSER_SCAN_URL = 'https://example.org'
php artisan test --filter=test_job_can_generate_real_reports_when_smoke_checks_enabled
Remove-Item Env:RUN_BROWSER_SCAN_TEST
Remove-Item Env:RUN_BROWSER_SCAN_URL
```

On Linux, prefix the test command with RUN_BROWSER_SCAN_TEST=1. The smoke test
uses an isolated test database and removes its temporary private artifacts.

Frontend UI source is installed exclusively from Neobrutalism.com's Radix registry;
layout uses semantic HTML, library fonts and Lucide icons. Theme installation:

```sh
npx shadcn@latest add https://neobrutalism.com/r/themes/r4GW.json -c apps/web
```

All 54 standalone components from the component gallery are installed in
apps/web/components/ui. Sidebar's required responsive hook is in
apps/web/resources/js/hooks/use-mobile.ts. The three remaining gallery entries
are guides, not registry packages:

- Data Table composes the installed Table and controls with the installed
  @tanstack/react-table dependency.
- Date Picker composes the installed Calendar, Popover and Button components.
- Typography provides utility-class recipes for semantic HTML; the required
  theme tokens and Archivo Black/Space Grotesk fonts are already configured.

When installing further components, dependency resolution may install plain
shadcn versions of shared controls. Reinstall the affected controls from the
explicit Neobrutalism Radix URLs to retain this application's design system.