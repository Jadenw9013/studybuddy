# Run Live Tutor

The working application is in this existing project root. The original revision-2 specification is unchanged. See [acceptance evidence](docs/implementation/acceptance.md) for observed results and open release gates.

The current conversation-first interface, voice controls, notebook math and computed vector visuals are described in the [short demo and exact run commands](docs/implementation/workflow.md). Research and the graphite/blue palette decision are recorded in [experience v3](docs/implementation/experience-v3.md).

## Current local test access

Sign-in is currently skipped by `DEV_AUTH_BYPASS=true` in the private `.env`, with `DEV_AUTH_USER_ID` linked to the existing local demo profile. Run `pnpm dev` and open http://localhost:3000 to enter that test workspace directly; no code or email is needed. Actual local Supabase persistence/private storage and configured model integrations still run. The bypass accepts only loopback clients with local services in development/test and is rejected for production/public binding. Set it to false to restore authentication. The example template keeps it false, and the offline fixture runner explicitly disables it so sign-in regressions still run. Google sign-in is planned for later; it is not implemented by this change.

`pnpm exec playwright test --config playwright.local-auth.config.ts` verifies entry without cookies, ordinary uploads, a real chart and reload without requesting a paid model response. Start local Docker/Supabase first. This is development access, not evidence of an authenticated pilot session.

## Local development fixture

Use Node **22.16.0**, Python **3.12.12**, pnpm **10.30.3** and uv **0.13.8**. From PowerShell at `C:\Dev\StudyBuddy`:

```powershell
corepack enable
corepack prepare pnpm@10.30.3 --activate
python -m pip install uv==0.13.8
pnpm install --frozen-lockfile
pnpm run setup
pnpm seed:demo
pnpm exec playwright install chromium
pnpm dev:fixture
```

Open http://localhost:3000. `pnpm run setup` is intentional: `pnpm setup` is pnpm's own shell-setup command. The project script copies `.env.example` only when `.env` is absent, installs the frozen worker environment into root `.venv`, and copies the pinned PDF.js worker. No paid request, public deployment or purchase occurs. `dev:fixture` explicitly selects development fixture mode, which is rejected in production and on a remote web origin. It stores local synthetic state in ignored `.data`; it is not Supabase authentication or a live tutor measurement. Keep this server on loopback.

Shortest demo:

1. Enter a synthetic email; check adult eligibility/consent, send a code, and use **246810**.
2. Choose **Bring an assignment**, upload `fixtures/lecture.pdf`, `fixtures/attempt.ipynb` and `fixtures/scores.csv`. Wait for all three to be ready, then open the lesson. **Try the included course** sends these same files through the same ingestion pipeline.
3. Ask **Why does my histogram peak at 3 instead of 0.03?** Open its **physical page 2** citation. Return to the problem; switch Count/Density and show the data table.
4. Ask **Use five bins**. The existing chart updates to counts **[2,3,1,2,2]**, with edges **[0,8,16,24,32,40]**. Change its title or undo the board change.
5. Start independent practice, enter an answer with reasoning, and record it. Open Recap and reload: the confirmed board and first response persist. Hints and retries remain separately labeled.

Repeat with `fixtures/unseen/` files for changed filenames and data. Fixture responses are visibly labeled and deliberately limited; an unsupported fixture question is not evidence of a general model capability. Live voice honestly reports unavailable in this mode. No browser-wide control is used for tutoring.

## Repeatable checks

```powershell
pnpm verify:handoff
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm eval:offline
pnpm eval:live
```

Run build after stopping the development server/tests. `eval:live` is a credential/model preflight and exits **2** while the real lesson gate is open; that is not a passing live lesson. `pnpm test` combines domain, gateway, relay/client, metering, persistence, retrieval, collector, companion authority and Python parser/tokenizer contract checks. `test:e2e` starts its own local fixture web/API/worker and uses Chromium. `eval:offline` deliberately labels its synthetic results. CI is defined in `.github/workflows/ci.yml`; a hosted CI run has not been observed here.

## Real local Supabase services

Start Docker Desktop. These commands use only the local Supabase stack:

```powershell
pnpm db:start
New-Item -ItemType Directory -Force .data | Out-Null
pnpm exec supabase status --output json | Set-Content .data/supabase-local-status.json
$tutorLocal = Get-Content .data/supabase-local-status.json -Raw | ConvertFrom-Json
$env:DATABASE_URL = $tutorLocal.DB_URL
pnpm db:migrate
pnpm db:test
pnpm test:services
```

Keep the status file private; it includes local service credentials. Migrations backfill typed domain tables and validate source-version foreign keys. The service test provisions and deletes its own synthetic invited identity, receives a real code through local Mailpit, uploads private originals and runs the actual worker. It makes no Gemini call.

To use the local service interactively, set the following process variables (or corresponding private `.env` values), invite an adult test user in local Supabase Studio at http://127.0.0.1:54323, then run `pnpm dev`:

```powershell
$env:APP_MODE = 'live'
$env:SUPABASE_URL = $tutorLocal.API_URL
$env:SUPABASE_PUBLISHABLE_KEY = $tutorLocal.ANON_KEY
$env:SUPABASE_SERVICE_ROLE_KEY = $tutorLocal.SERVICE_ROLE_KEY
$env:WS_TICKET_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:INTERNAL_WORKER_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
pnpm dev
```

Read the actual sign-in code in local Mailpit at http://127.0.0.1:54324. Signup is disabled. `live` means real services; text/audio are unavailable until their separate paid configuration is complete. `pnpm db:stop` stops the local stack and preserves its local backup; do not use a reset on valuable data.

## Optional local embeddings and numerical oracle

Lexical search is the default. To reproduce the real local BGE comparison, with local Supabase running:

```powershell
$env:UV_PROJECT_ENVIRONMENT = "$PWD/.venv"
python -m uv sync --frozen --project apps/worker --python 3.12.12 --extra embeddings
.venv/Scripts/python.exe apps/worker/embeddings.py --prepare
node --import tsx supabase/tests/retrieval-live.ts
pnpm eval:numeric
.venv/Scripts/python.exe evals/numeric-oracle.py
```

Weights are pinned to BGE-small-en-v1.5 revision `5c38ec7c405ec4b44b94cc5a9bb96e735b38267a`, cached in ignored `.data/model-cache`, with remote code disabled. Preparing weights requires a network download; normal indexing loads local weights only. Set `ENABLE_HYBRID=true` for semantic indexing of future uploads. Re-running base setup removes optional Python packages; repeat the optional sync when needed.

## Service keys and optional illustration model

The private `.env` and safe `.env.example` now group Gemini, FLUX.2 klein, Supabase, Stripe, local tools, cost controls and runtime settings. Existing private assignments were preserved. Gemini voice and typed tutoring share `GEMINI_API_KEY`; Supabase has its URL, publishable key, server-only service-role key and database connection string; optional billing uses the three Stripe fields. Configure hosted email SMTP credentials in Supabase Auth rather than adding an unused email-provider key to this app.

The FLUX.2 klein adapter uses `BFL_API_KEY`, `BFL_BASE_URL`, `ILLUSTRATION_MODEL=flux-2-klein-9b`, and `ILLUSTRATION_PROVIDER=bfl`. Start actual services with `APP_MODE=live`, set `ENABLE_ILLUSTRATIONS=true` and `PAID_CALLS_ENABLED=true`, and supply the versioned `ILLUSTRATION_REQUEST_COST_USD`, `ILLUSTRATION_PRICE_VERSION`, and `ILLUSTRATION_DAILY_LIMIT` values shown in `.env.example`. Template defaults leave paid features off. After the account was funded, real klein9B generation and the browser/private-storage journey passed. The current private `.env` enables this local development path, using local Supabase credentials and preserving provider keys. Run `pnpm dev`, sign in as the invited synthetic account **demo@live-tutor.example.test**, and read its actual emailed code in [local Mailpit](http://127.0.0.1:54324). Black Forest Labs documents its [API key setup](https://help.bfl.ai/articles/8446125349-quickstart-guide) and [klein endpoints](https://help.bfl.ai/articles/6122710168-which-flux-2-model-should-i-choose).

In a lesson, use **Optional illustration**, enter a title, description and learning purpose, then choose **Generate illustration**. Each explicit action submits one 768x768 image, asynchronously, without reference uploads or automatic retries. Its cost hold shares the pass budget with speech/text, and the separate daily illustration count survives course deletion. Cancel or interrupt discards late results; the provider may charge for work already accepted. Ambiguous outcomes retain a provision and block further paid work pending reconciliation. The current interface requires this explicit learner action; the model cannot autonomously incur an image charge. Ready images are labeled AI-generated, stored privately and served through the authenticated lesson API. Removing an image revokes reads and purges its bytes; no provider delivery URL reaches the browser. Charts and equations keep using the trusted computed renderers.

Run `pnpm eval:illustration` for an explicit paid synthetic probe (estimated $0.015 per 768px klein9B image, at most three recorded attempts). It never prints keys or delivery URLs. Evidence is `evals/results/illustration-live.json`; the generated synthetic image stays in ignored `.data`. Do not confuse injected-provider browser/HTTP results with a successful BFL generation. See [illustration evidence](docs/implementation/illustrations.md).

`pnpm eval:illustration:browser` is a separate explicitly paid Playwright Test suite, excluded from offline CI. Stop the development app first so ports 3000/3001 are free. With local Supabase available, it signs in through actual local emailed OTP, uploads the course, creates a verified histogram, generates one real image, verifies private reads/reload/removal, and removes the synthetic account. Retries are disabled. It records at most two runs before requiring review of the existing evidence, so it cannot silently run an unbounded paid loop. The first run generated successfully but failed in test cleanup; the corrected second run passed all six checks. Both are retained in `evals/results/illustration-browser.json`.

November 19 configuration decision: use klein 9B as the hosted-API evaluation baseline, updating the handoff's optional 4B candidate without changing the canonical specification. BFL positions 9B as higher quality; its current first-megapixel price is $0.015 versus $0.014 for 4B. Also compare the newer [FLUX 3 Image Klein](https://bfl.ai/models/flux-3-image-klein), currently listed at $0.009 for the 1K tier, and a higher-quality option on identical tutoring prompts. See [provider pricing](https://bfl.ai/pricing). The funded probe took 4.329 seconds end-to-end; the successful browser run took 4.621 seconds from click to loaded image, a load proxy rather than first-visible-paint timing. These individual observations do not establish comparative quality, p95 latency or pedagogical accuracy. Instructor review and invoice reconciliation remain open.

BGE embeddings run locally with pinned weights. JupyterLab uses explicit short-lived pairing and local Apply. Chart rendering, equations, PDF preview/parsing and Playwright do not require paid API credentials. OpenAI, Anthropic, LiveKit and hosted-browser services are alternatives discussed in the handoff, not additional integrated dependencies.

## Real voice and device gates

Configure an authorized Gemini project/key, confirmed model IDs, `PAID_CALLS_ENABLED=true`, `ENABLE_LIVE=true`, a reviewed `MODEL_UNIT_PRICES_JSON`, and bounded `MODEL_UNIT_LIMITS_JSON`. No vendor price is invented. Unknown pricing/usage prevents further paid admission. Keep billing disabled. The preflight and measured lesson procedure are in [evals/live/README.md](evals/live/README.md). Raw audio and screen recording default off; live transcript persistence requires a separate explicit Settings opt-in.

On Windows, enable microphone permission for the chosen browser in Settings → Privacy & security → Microphone. On macOS, allow the browser under Privacy & Security → Microphone and Screen Recording. Select a window through the browser's own chooser; Stop sharing revokes it. Headphones help avoid echo. Shared system audio/loopback differs by browser and OS and is not a prerequisite for a microphone lesson. Remote microphone/capture require HTTPS, and relay/companion require WSS with a trusted certificate. Localhost is the development exception; do not expose loopback services as a production deployment. Actual mic/chooser/Stop and screen-reader tests are still required.

## Paired JupyterLab

Follow [extensions/jupyterlab/README.md](extensions/jupyterlab/README.md) for the pinned host install, federated build and local pairing. The plugin controls only the explicitly paired notebook. A tutor can request focus/highlight or a diff; **Apply edit** exists only in the local Jupyter panel. No cell execution or shell action is available. The actual-host automated run and remaining human approval gate are in [companion evidence](docs/implementation/companion.md).

## Staging and operations

See [operations](docs/implementation/operations.md). Container definitions are supplied but have not been deployed or built here. Separate service/provider projects and HTTPS/WSS, external invite delivery, Stripe test-mode signed webhook/refund checks, backup/restore, device tests and human acceptance are release gates. Billing and provider switches remain off by default. Never put service keys in browser variables or upload private test logs/media into CI artifacts.

## DSA visual playground

With local Supabase, migrations and `pnpm dev` running under the configured local test access, run `pnpm seed:dsa` in a second terminal and open its printed lesson URL. It uploads four synthetic graph/tree/BST datasets and a study guide through the ordinary ingestion pipeline, then creates a computed BFS board without a provider call. Use **Next step**, switch traversal, or search the BST for 7 (present) and 5 (absent). Typed/voice explanations use their separately configured providers. See [DSA formats, traversal rules and demo prompts](docs/implementation/dsa-playground.md); mock imports do not count as live tutoring or independent learner evidence.

## Notebook library and Studio

Apply migrations 007–008 with `pnpm db:migrate`, then run `pnpm dev` and open `http://localhost:3000/`. The library resumes existing notebooks and supports search, filters, grid/list and renaming. In a notebook, choose sources on the left, chat in the middle, and create cited study guides, flashcards or quizzes in Studio. Save useful answers to editable notes. Study progress and source choices persist across reloads. Use Sources / Chat / Studio tabs on smaller screens.

Generation uses the configured Gemini text provider and reviewed spending limits. Fixture generation is labeled as such. See [notebook implementation and acceptance](docs/implementation/notebook-workspace.md) for exact checks, live measurements, run commands and remaining release gates.
