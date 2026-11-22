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

Only the public API URL belongs in the frontend's proxy configuration. Keep Gemini, BFL, database, Supabase service-role, worker/ticket and Stripe secrets on the backend. The app exposes the Supabase publishable key through its authorized configuration response; the service key must never become a browser key. Configure Supabase Auth for the actual frontend URL and invited pilot accounts. Google sign-in remains deferred; production does not use the local authentication bypass.

## Prepared container deployment

The root [production environment template](../../.env.production.example) contains placeholders and disabled provider/billing switches. Copy it to a private `.env.production` on the API host, fill the real hosted endpoints and secrets, then review the desired feature switches and provider cost policy. Git and Docker build contexts exclude private environment files. The application's $7.60 model ceiling does not cover hosting charges.

The root [Compose file](../../compose.production.yml) runs only the API and worker. It does not start or publish a database. The API's host port is bound to `127.0.0.1`; the host's TLS edge must proxy to it. The worker uses the private Compose service address. Named volumes hold private API state/operational data and optional model cache; do not put them in a frontend static-output directory.

Configuration can be validated with the placeholder template, without starting containers or contacting providers. On PowerShell:

```powershell
$env:STUDYBUDDY_PRODUCTION_ENV_FILE = '.env.production.example'
docker compose --env-file .env.production.example -f compose.production.yml config --quiet
Remove-Item Env:STUDYBUDDY_PRODUCTION_ENV_FILE
```

After a host, its billing and the real private environment have been approved/configured, the operator can run:

```sh
docker compose --env-file .env.production -f compose.production.yml config --quiet
docker compose --env-file .env.production -f compose.production.yml up --build -d
docker compose --env-file .env.production -f compose.production.yml ps
```

The Compose health check establishes API liveness, not successful database access, worker publication, model access or a complete lesson. Worker jobs already use API-owned leases and fenced publication; an interrupted parse is retried through that existing pipeline.

## Hosted database and release gates

An operator must verify the target hosted database and review the existing migrations before applying them. From a checkout with the correct private production environment, the migration entry point is:

```sh
node --env-file=.env.production scripts/migrate.mjs
```

This is an operator command, not something this setup runs automatically. Preserve the `tutor_api` role, per-transaction subject setting, owner-scoped data, source-version constraints and private storage policies. Never substitute a browser service-role key or disable RLS to bypass a deployment error. Run synthetic permission and lifecycle checks against staging before using real participant files.

Production remains open until actual hosted sign-in, private upload/worker publication, citation retrieval, text, interrupted/reconnected voice, paired-notebook approvals and the metered 20-minute lesson have been observed. A successful frontend build or liveness check does not close those gates. Existing fixture and local-service observations remain separate from production measurements.

## Current Vercel backend options

Vercel now supports WebSockets with Fluid Compute and detects the existing Fastify-style `src/index.ts`/`.listen()` entrypoint. Its documentation warns that separate requests/reconnects can reach different instances. The current API keeps voice tickets, active-learner coordination and companion pairs/sockets in process memory, so the unchanged pilot uses one persistent API process. A distributed Vercel Function deployment needs shared coordination and explicit reconnect testing. [WebSocket support and state](https://vercel.com/docs/functions/websockets), [Fastify deployment](https://vercel.com/docs/frameworks/backend/fastify).

Hobby Functions have a 300-second maximum, including an open WebSocket. Pro/Enterprise support 800 seconds, or up to 1,800 seconds with explicit supported-runtime beta configuration. Hobby's standard request-body limit is 4.5 MB, below this app's 25 MB files. These facts prevent treating a default Hobby Function as an unchanged, uninterrupted 20-minute upload-and-voice deployment. [Function limits](https://vercel.com/docs/functions/limitations), [duration configuration](https://vercel.com/docs/functions/configuring-functions/duration).

Vercel Daemons can run the worker's continuous Docker process. They are public beta on all plans; Hobby provides 5 Active CPU-hours and 420 GB-hours of provisioned memory monthly, then stops daemons at either limit. Idle instances still consume memory quota. Daemons do not accept inbound API traffic or persist local disks. Pro/Enterprise daemon usage is billed, so no paid hosting plan or always-on worker is enabled by this setup. [Daemon support](https://vercel.com/docs/daemons), [quotas and unsupported features](https://vercel.com/docs/daemons/limits).

The concrete missing inputs are the chosen persistent API/worker host and its approved resources, hosted Supabase configuration, the real API/frontend origins and operated authentication setup. Their secrets belong in that host's private settings, not Git or chat.
