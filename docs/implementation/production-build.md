# Production web build correction

The failed Vercel build imported the repository as **Other**, with root `./`, and explicitly supplied `NODE_ENV=development`. That environment value was reproduced locally: `pnpm run build` failed while prerendering `/_global-error`, with `Cannot read properties of null (reading 'useContext')` and repeated framework metadata key warnings. Those warnings were an effect of the mismatched build environment; changing application list keys would not fix this failure.

`pnpm run build` now invokes `scripts/build-web.mjs`. The wrapper selects `NODE_ENV=production` for the Next.js child process even if the calling shell or hosting environment supplied development. It also copies the pinned PDF.js worker before compiling, so a clean web deployment does not need the Python ingestion setup just to prepare its browser asset. The repository-root and app-directory build commands use the same wrapper.

`apps/web/package.json` declares the existing exact Next.js, React and React DOM versions, with a workspace lockfile importer. The web package has a Vercel configuration selecting the Next.js adapter. Output-file tracing explicitly includes the repository root for shared packages and dependencies. Docker web/API builds now copy the pinned SDK patch before installing frozen dependencies.

## Vercel project settings

For the web project connected to this repository:

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Framework Preset | Next.js |
| Include files outside Root Directory | Enabled |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm run build` |
| Output Directory | Next.js default, `.next`; no custom override needed |
| Node.js | 22.x |

Remove a manually configured `NODE_ENV` from the hosting settings and let the platform/Next.js select it. The build wrapper still protects against an accidental development value. Do not paste a local `.env` into production: loopback API/database URLs refer to the deployment itself, and the development sign-in bypass is intentionally rejected in production. Configure only the values needed by the deployed component through its hosting environment.

The frontend build correction does not establish an operational deployed API, ingestion worker, hosted database/private storage, production authentication or a real production voice lesson. Those services need their own deployment configuration and observed checks. No production authorization safeguard, paid-provider switch or database schema was relaxed by this change.

## Observed verification

- Before the correction, building with `NODE_ENV=development` reproduced the exact `/_global-error` failure.
- Afterward, the same environment value built successfully from the repository root and from `apps/web`.
- `pnpm install --lockfile-only --offline` added only the web importer; `pnpm install --frozen-lockfile --offline` then passed. No dependency versions or SDK patch contents changed.
- A temporary production server on a separate loopback port returned HTTP 200 for the homepage and the 1,271,915-byte PDF worker. The served worker matched the pinned generated file. This check invoked no tutor provider or backend integration.
- Generated build logs remain local under `.data/`. A successful local production build does not substitute for observing the next hosted deployment and its backend connectivity.
- Both connected Vercel projects (`studybuddy` and `studybuddy-6ozm`) reached **Ready** on commit `c1dc6cc1ae75115a04737c87b791e307bfb728ee` after correcting their root, framework, Node version and environment settings. The public frontend rendered in Chrome. Its API proxy remained unavailable because its target was still the local development address; hosted service integration remains open.
- The shared browser response parser now reports service unavailability for network failures, non-JSON proxy pages and malformed JSON. Explicit backend messages and intentional cancellation remain intact, and no substitute configuration is fabricated. Four focused regressions, all 285 automated cases, type checking and a production build passed after this correction.

Primary references: [Next.js environment selection](https://nextjs.org/docs/app/guides/environment-variables), [Next.js output tracing in monorepos](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [Vercel build and root settings](https://vercel.com/docs/builds/configure-a-build).
