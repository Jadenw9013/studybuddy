# Production hosting for the existing tutor

The prepared production architecture uses a Vercel Next.js frontend, one persistent API process, a separate Python ingestion worker, and hosted Supabase. These files prepare that deployment; they do not provision a host, migrate a remote database, change credentials, enable paid providers or establish production acceptance.

The frontend alone cannot provide uploads, saved notebooks, chat or voice. `127.0.0.1` in a cloud environment points to that cloud process, not the developer's laptop. The local `.env` also contains a development-only sign-in bypass and a Windows Python path; it must not be imported wholesale into production.

## Services and configuration

| Service | Required configuration |
|---|---|
| Vercel frontend | Root Directory `apps/web`, Next.js preset, files outside the root included, and the repository's build command. Set `API_INTERNAL_ORIGIN` to the real public HTTPS API origin. Keep `NODE_ENV=production` or remove a manual development override. |
| Persistent API container | Run `Dockerfile.api` as **one instance** for this pilot. Use `NODE_ENV=production`, `APP_MODE=live`, `DEV_AUTH_BYPASS=false`, and `API_HOST=0.0.0.0` inside its private container network. Configure hosted Supabase and the private API secrets here. |
| Public API edge | Terminate HTTPS/WSS at the host's reverse proxy. Route `/api/*`, `/live` and `/companion` to the API. Preserve WebSocket upgrades and permit the application's 25 MB file limit. Do not expose `/internal/*` publicly. |
| Python worker | Run `Dockerfile.worker` continuously. Point its `API_INTERNAL_ORIGIN` to the private API address, such as `http://api:3001`, and use the same private `INTERNAL_WORKER_SECRET` as the API. It needs no public inbound port or direct model/database credentials. |
| Hosted Supabase | Supply the actual project URL, publishable key, server-only service key and TLS-enabled Postgres connection string. Use the existing migrations and owner/RLS boundaries; keep original-file storage private. |

`WEB_ORIGIN` is the exact public frontend HTTPS origin and remains the origin checked for browser mutations and socket upgrades. `API_PUBLIC_ORIGIN` is the bare public API HTTPS origin; the API uses it for browser voice and companion socket addresses. Browser HTTP requests continue through the frontend's `/api` proxy, while the signed voice ticket permits the direct WSS connection. Neither origin includes a path or a trailing slash. The worker's private URL is a separate value, even though its variable is also named `API_INTERNAL_ORIGIN`.

Only the public API URL belongs in the frontend's proxy configuration. Keep Gemini, BFL, database, Supabase service-role, worker/ticket and Stripe secrets on the backend. The app exposes the Supabase publishable key through its public configuration response; the service key must never become a browser key. Google sign-in remains deferred; production does not use the local authentication bypass.

The supplied images support lexical retrieval. Keep `ENABLE_HYBRID=false`: the worker image does not install the optional embedding dependencies or weights, and the API image has no Python environment for query embeddings. A cache volume alone does not enable semantic retrieval. The existing [storage notes](storage.md) describe the separately prepared local embedding environment.

## Prepared container deployment

The root [production environment template](../../.env.production.example) contains placeholders and disabled provider/billing switches. Copy it to a private `.env.production` on the API host, fill the real hosted endpoints and secrets, then review the desired feature switches and provider cost policy. Git and Docker build contexts exclude private environment files. The application's $7.60 model ceiling does not cover hosting charges.

The root [Compose file](../../compose.production.yml) runs only the API and worker. It does not start or publish a database. The API's host port is bound to `127.0.0.1`; the host's TLS edge must proxy to it. The worker uses the private Compose service address. Named volumes hold private API state/operational data and optional model cache; do not put them in a frontend static-output directory.

Configuration can be validated with the placeholder template, without starting containers or contacting providers. On PowerShell:

```powershell
$env:STUDYBUDDY_PRODUCTION_ENV_FILE = '.env.production.example'
docker compose --env-file .env.production.example -f compose.production.yml config --quiet
Remove-Item Env:STUDYBUDDY_PRODUCTION_ENV_FILE
```

The VM needs a complete checkout, Docker Engine with Compose, outbound access to the configured hosted services, and Caddy installed from its [official package](https://caddyserver.com/docs/install). API and worker images install their pinned dependencies themselves; the VM does not need a separate Python environment. From the repository root, after the host, its billing and the real private environment have been approved/configured, first validate and build:

```sh
docker compose --env-file .env.production -f compose.production.yml config --quiet
docker compose --env-file .env.production -f compose.production.yml build api worker
```

Complete the reviewed migration and authentication setup below before starting the API/worker for learners. Do not run the development `setup` or `seed:dsa` scripts on the production VM: they target development environments and the DSA seed explicitly requires the loopback sign-in bypass. For a hosted DSA notebook, sign in, create a notebook and upload the five original synthetic files in `fixtures/dsa/` through the normal Sources flow (at most three files per upload).

## HTTPS and WebSocket edge on one VM

The supplied [Caddy configuration](../../deploy/Caddyfile.example) assumes Caddy runs directly on the VM and connects to the API's loopback port. Replace its hostname with the host in `API_PUBLIC_ORIGIN`, then install that reviewed configuration at `/etc/caddy/Caddyfile`. Point the hostname's A/AAAA records to the VM and permit public inbound TCP ports 80 and 443. Keep port 3001 private. Incorrect AAAA records must not point somewhere else. Caddy needs its normal persistent, writable certificate state directory. Its [automatic HTTPS](https://caddyserver.com/docs/automatic-https) issues and renews certificates when these requirements are met.

The configuration permits only `/api/*`, `/live` and `/companion`; `/internal/*` receives 404. It preserves request paths and browser Origin, lets the application's own upload limits apply, and uses Caddy's built-in [WebSocket upgrade handling](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy). There is no proxy stream timeout shorter than a lesson. Config reloads allow existing streams another 25 minutes; restarting the proxy or API still requires the tested reconnect path. Do not enable access logs containing signed socket-ticket query strings or pair URLs.

On the configured VM, validate before reloading its existing Caddy service:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

These are operator commands; no public DNS, certificate issuance or proxy service is configured by checking in this example. The example passed `caddy adapt --validate` in the official Caddy image with networking disabled, a read-only configuration mount and no host ports. The VM's actual hostname, certificate issuance and live proxy routing remain operated checks.

## Hosted database and release gates

An operator must verify the target hosted database and review the existing migrations before applying them. Use the Supabase-provided TLS connection string for a connection that can assume `tutor_api`; the existing migrations grant that role to `postgres`. A dedicated runtime login needs its own reviewed role membership. The migration connection also needs the privileges required by the existing role, extension, storage and schema setup. Review this in staging rather than changing policies to get around a permission error.

The API image deliberately does not include migration scripts or SQL. After building it, the operator can run the checked-out migration entry point with those two directories mounted read-only. This uses the API service's private environment, overrides its normal server command, and starts no API/worker dependency or published port:

```sh
docker compose --env-file .env.production -f compose.production.yml run --rm --no-deps \
  --volume ./scripts:/app/scripts:ro \
  --volume ./supabase/migrations:/app/supabase/migrations:ro \
  api node scripts/migrate.mjs
```

This writes to the reviewed target database and is not something this setup runs automatically. The first existing migration creates the private `course-originals` bucket and restrictive browser-storage policy; do not replace it with a public bucket. Preserve the `tutor_api` role, per-transaction subject setting, owner-scoped data, source-version constraints and private storage policies. Never substitute a browser service-role key or disable RLS to bypass a deployment error. Run synthetic permission and lifecycle checks against staging before using real participant files. An alternative host-Node migration requires Node 22 and the frozen repository dependencies installed first; merely copying the API image does not provide `scripts/migrate.mjs`.

In hosted Supabase Auth, configure the exact frontend Site URL and approved redirects, enable email sign-in, and pre-create/invite the authorized adult pilot users. The app uses `shouldCreateUser: false`, so an unknown email cannot register itself. Its sign-in screen accepts a code, not a magic-link callback: configure the **Magic Link** email template to include `{{ .Token }}`. Verify actual delivery and code verification with an invited external mailbox. A custom SMTP sender is required for unrestricted external delivery; Supabase's default sender is restricted to project-team addresses. See [email OTP configuration](https://supabase.com/docs/guides/auth/auth-email-passwordless) and [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp). This is a required operator setup step, not an Auth policy change made by these files.

New live accounts start with **zero voice seconds**. Adding a Gemini key and enabling live mode does not grant minutes. The existing production grant path is authenticated Stripe Checkout plus verified, server-retrieved webhook fulfillment of the approved pass; billing and its external test deliveries remain unverified. A separate non-purchase production pilot grant requires an explicitly approved, audited implementation before a hosted voice test. `scripts/dev-allowance.mjs` refuses production and must not be repurposed to bypass this gate. No minutes or purchases are created by this setup.

Provider calls also stay unavailable until the operator supplies approved model access, a current versioned `MODEL_UNIT_PRICES_JSON` table and finite per-modality `MODEL_UNIT_LIMITS_JSON`, then explicitly enables the desired switches. Keep the configured $7.60 ceiling and 1,200-second session maximum; do not copy a local one-test allowance into production or infer provider rates from a funded key. BFL additionally needs its separately reviewed per-image price/version. The template deliberately leaves these values unconfigured rather than inventing live measurements or authorizing spending.

After the migration, authentication, edge and intended feature gates are configured, start the two long-running services:

```sh
docker compose --env-file .env.production -f compose.production.yml up -d
docker compose --env-file .env.production -f compose.production.yml ps
```

The Compose health check establishes API liveness, not successful database access, worker publication, model access or a complete lesson. Worker jobs already use API-owned leases and fenced publication; an interrupted parse is retried through that existing pipeline. Check public `/api/health`, public denial of `/internal/jobs/claim`, sign-in through the frontend, a real private upload becoming ready, exact citations and browser voice before declaring the deployment usable.

Production remains open until actual hosted sign-in, private upload/worker publication, citation retrieval, text, interrupted/reconnected voice, paired-notebook approvals and the metered 20-minute lesson have been observed. A successful frontend build or liveness check does not close those gates. Existing fixture and local-service observations remain separate from production measurements.

Deployment preparation observed on 2026-11-21: placeholder-only `docker compose config --quiet` passed, actual API and worker image builds both passed with frozen dependency installs, and the Caddy example passed isolated adaptation/validation with official image digest `sha256:4851e54a46b206517c574821bb5cc67f170d2156041e9fbc4c9193b45e84a75b`. No production services, migrations, Auth changes, provider calls or hosted acceptance tests were started. Building the images does not verify the hosted database or close the entitlement and SMTP gates above.

## Current Vercel backend options

Vercel now supports WebSockets with Fluid Compute and detects the existing Fastify-style `src/index.ts`/`.listen()` entrypoint. Its documentation warns that separate requests/reconnects can reach different instances. The current API keeps voice tickets, active-learner coordination and companion pairs/sockets in process memory, so the unchanged pilot uses one persistent API process. A distributed Vercel Function deployment needs shared coordination and explicit reconnect testing. [WebSocket support and state](https://vercel.com/docs/functions/websockets), [Fastify deployment](https://vercel.com/docs/frameworks/backend/fastify).

Hobby Functions have a 300-second maximum, including an open WebSocket. Pro/Enterprise support 800 seconds, or up to 1,800 seconds with explicit supported-runtime beta configuration. Hobby's standard request-body limit is 4.5 MB, below this app's 25 MB files. These facts prevent treating a default Hobby Function as an unchanged, uninterrupted 20-minute upload-and-voice deployment. [Function limits](https://vercel.com/docs/functions/limitations), [duration configuration](https://vercel.com/docs/functions/configuring-functions/duration).

Vercel Daemons can run the worker's continuous Docker process. They are public beta on all plans; Hobby provides 5 Active CPU-hours and 420 GB-hours of provisioned memory monthly, then stops daemons at either limit. Idle instances still consume memory quota. Daemons do not accept inbound API traffic or persist local disks. Pro/Enterprise daemon usage is billed, so no paid hosting plan or always-on worker is enabled by this setup. [Daemon support](https://vercel.com/docs/daemons), [quotas and unsupported features](https://vercel.com/docs/daemons/limits).

The concrete missing inputs are the chosen persistent API/worker host and its approved resources, hosted Supabase configuration, the real API/frontend origins and operated authentication setup. Their secrets belong in that host's private settings, not Git or chat.
