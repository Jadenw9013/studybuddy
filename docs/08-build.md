# Build sequence

## Repository layout to create

~~~text
apps/web/                     Next.js, accessible course and lesson views
apps/api/                     Fastify HTTP, WS relay, authorization, metering
apps/worker/                  Python ingestion + embeddings
extensions/jupyterlab/        optional local integration; same tool contract
packages/contracts/           versioned event schemas, tool registry and validators
packages/board/               deterministic math, renderers and undo
packages/tutor/               teaching policy, evidence packing and provider adapters
supabase/migrations/          schema, private storage policies and access tests
fixtures/                     original course PDFs, CSVs, notebooks and labeled cases
evals/                        browser scenarios, transcript rubrics and pilot measures
docs/                         product specifications and implementation notes
~~~

Use pnpm workspaces with a pinned supported Node LTS and a locked Python 3.12 environment. Use Supabase local dev for Postgres/Auth/Storage (Docker); seed only synthetic identities locally. Write a root .env.example and wire these command targets by M1: **pnpm setup**, **pnpm dev**, **pnpm seed:demo**, **pnpm test**, **pnpm test:e2e**, **pnpm eval:offline**, **pnpm eval:live**. Treat these as commands to implement, not commands already present. Root setup documents OS-specific mic/loopback and local TLS requirements. Do not expose the local database to public traffic.

Configuration groups: public web origin, public API origin & Supabase publishable key; server-only database URL, scoped worker/storage credentials, WS ticket signing key, paid model project/key, model IDs, provider/fixture mode, capture/companion/image flags, unit-price table, spend ceiling and entitlement defaults. Only enable image provider secret when its feature is on. Add startup configuration validation. Recording flags default off. Local seeded auth/entitlements must be impossible to enable accidentally in production.

## Milestones and exits

| Stage | Deliver | Prove before moving on |
|---|---|---|
| **M0 · Feasibility** | Empty repo → running web, API and worker; signed-in route, DB migration, schema validation, CI. Run a short provider smoke test first, then a 20-minute paid synthetic lesson with barge-in, a shared frame, a real tool call, a chart paint and a forced reconnect. Record per-turn usage and estimated full-pass cost. Verify target accounts, model IDs/availability, SDK and current terms. | Record actual browser/device/network, model versions and raw timing event summaries. Show fail-closed production startup, working text-only mode with mic denied, and distinctly labeled fixture mode. If a key is missing, continue independent work and mark real provider gate open. |
| **M1 · Course to useful board** | Implement both entry paths, private course uploads, job statuses, source preview, retrieval with citations and a deterministic chart. Build the fixture in [evaluation](09-evaluation.md). | From a fresh account, upload the fixture as ordinary files. Ask the initial question via the text provider, open the correct citation, render count and density, then change bin count. Repeat with a renamed unseen dataset. Isolation and replacement tests pass. |
| **M2 · Useful tutoring** | Lesson state, diagnostic move, worked example, hint ladder, independent practice, rubric, quiet mode, return/recap. Cover each supported topic. | A reviewer can explain why a response followed from source, attempt and tool evidence. Test a novice, a correct student, an incorrect student and a student asking for a direct explanation. Only evidenced attempts show in recap. |
| **M3 · Interruptible live** | Production-shaped voice relay, streamed playback/transcript, tool gateway, revisions, cancellation, resume and usage caps. | Overlapping requests for ten bins and then five bins resolve to the latest valid request. Live-to-text handoff keeps the board. Real paid session lasts 20 minutes across at least one forced reconnect. Meter settles once. |
| **M4 · Screen and web polish** | User-selected share, annotated preview, explicit target selection, stopping, crop on demand, accessibility, deletion, learner-friendly error states and deployment. | Verify capture/stop manually with actual browser chooser; synthetic tracks only for CI. Test 360 px layout, keyboard, screen reader, quiet room/no mic, source gaps and permission revocation. Pass core M6 gates before paid pilot. |
| **M5 · Co-work extension** | Paired JupyterLab 4 plugin. Focus, navigate within notebook, highlight and preview/apply/dismiss an edit. Safe undo and stale-target protection. | Real local notebook and human approval; test manual edit during proposal, document switch, disconnect after write, replay, expired grant and restore. Without extension all M4 flows still work. |
| **M6 · Verify and operate** | Release checklist, synthetic and held-out evaluations, measured live traces, rollback/kill switches, incident and data deletion drills. | Publish core report after M4 and companion addendum after M5. Label unavailable live tests unverified. Owner reviews direct measurements before claiming “live,” sub-two-second performance or external control. |

**First issue to give Codex:** scaffold the repo and make a single signed-in learner upload the three original fixture files, open the PDF page, and draw a correct histogram whose bin count can be changed from a chat tool. Run that path in a browser. In parallel with the UI scaffolding, do the M0 live provider capability probe so a polished mock cannot mask a broken integration. Record the next missing milestone, rather than adding marketing pages.

## Deploying the first pilot

Use separate development/staging/production projects, different provider keys and buckets. Deploy versioned DB migrations first, then worker/relay, then web. Reserve an HTTPS/WSS origin pair with proper browser permissions. Health checks distinguish database connectivity, indexer backlog and provider capability. Pin app and model revisions in each evaluation. Back up the schema and verify a restore with synthetic data. Keep app version rollback and independently disable external edits, image calls or live voice. Run an internal real-device smoke test after deployment, including an unauthorized cross-course request. Capture consent and eligibility before sending actual pilot data.

Use Stripe-hosted Checkout in test mode to exercise fulfillment in staging. For real payment choose the product price/pass in [product](01-product.md), tie a completed transaction to the logged-in user, deduplicate receipts and provide a human refund/support contact. Only launch billing once delivery, data handling and caps are verified. Do not silently open a paid external service or public deployment as part of fixture setup.

## Developer setup and release evidence

Install project-local, revision-pinned gemini-live-api-dev and supabase-postgres-best-practices from google-gemini/gemini-skills and supabase/agent-skills. Prefer the existing browser driver for interactive work. Playwright Test owns repeatable end-to-end tests; the Microsoft Playwright CLI skill is optional. Use native Codex subagents for independent work when available. A useful first split is the M0 voice test alongside the M1 upload lesson. The lead owns shared contracts, integration and evidence. Pin the pnpm version and include lockfiles for JS and Python. Run synthetic CI with real local Postgres/RLS, storage and Chromium where the environment supports them. Keep real-provider checks separately metered; no provider or production key in untrusted PR jobs. Treat a missing browser, billing account, student cohort or reviewer as an explicit verification gap while continuing implementable work.
