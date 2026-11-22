# Implementation acceptance report

**Current November 20 results:** see [conversation-first workflow acceptance](acceptance-v3.md) and [exact run commands / shortest demo](workflow.md). Real Gemini text and browser voice evidence now supersede the earlier credential-unavailable status below. Historical observations remain preserved.

Local testing update requested by the owner: email authentication is bypassed for one existing local test profile. A fresh Chromium session with no cookies entered directly, uploaded the three course files through real local services, created a verified histogram and resumed it after reload. Five targeted authentication/regression tests and type checking passed. No paid generation was needed. Production/public bypass settings are rejected; normal authentication remains available when the flag is off. Google sign-in is deferred. This development convenience does not satisfy the pilot authentication or consent gates.

November 19 addition: the optional klein9B illustration adapter and lesson UI are implemented. All 116 unit/contract checks passed, all nine offline browser scenarios passed, all three real local SQL suites passed, the original real-services test passed 9/9, and the new real Auth/Storage/Postgres illustration test passed 8/8 with a synthetic provider. After funding, actual BFL generation succeeded in 4.329 seconds and the corrected real browser journey passed 6/6 checks, with a 4.621-second image-load proxy, private storage/reload and deletion. An earlier browser run's cleanup failure is retained. Visual accuracy review, model comparison and invoice reconciliation remain open; the original voice/human release gates remain open. See [illustration implementation and evidence](illustrations.md). Original November 15–16 evidence below remains historical.

Observed on Windows x64, Node 22.16.0, Python 3.12.12, Chromium through Playwright Test 1.65.1, November 15–16, 2026. This is a local development handoff, **not authorization to launch a paid pilot**. No real student data or paid provider generation was used.

## Revision and scope

Phase 1 passed: the supplied revision-2 archive has SHA-256 `3079fa9efdc074aef62673a5d8bf8a5a56ab7abb3c1957328d8bc6877746b646`. All **15/15** manifest-listed files match exactly; no intentional specification differences, nested project or unrelated-file removal. See [synchronization evidence](handoff-sync.md).

Implemented the M0–M6 application and independent verification work: Next.js interface, Fastify authenticated API/voice relay/tool boundary, separate locked Python worker, Supabase Auth/private Storage/Postgres migrations and RLS, versioned source citations, deterministic histogram/regression/conditional-probability boards, practice and assistance ledger, interruption/resume, screen preview with stale-frame protection, locally approved JupyterLab companion, usage reservations, disabled-by-default Stripe Checkout/webhook integration, deletion/purge, operational controls, CI and deployment definitions. Release exits that need credentials, real devices or participants remain open below. M0 and M3 live acceptance are not complete merely because the relay code exists.

Both required project skills are installed and pinned in `.agents/skills.lock.json`: Google `87fb0173d36fea4f87de4c3fbd0678cf929c0588`; Supabase `c9be0e931b7930f7d02126d04774d904c381e7d7`. Canonical product/teaching/interface specifications remain unchanged. The setup script is invoked as `pnpm run setup` because `pnpm setup` is pnpm's built-in shell command.

## Observed passing evidence

| Check | Observed result | Evidence and limits |
|---|---|---|
| Revision integrity | 15/15 exact hashes | `pnpm verify:handoff` |
| Types / production web bundle | Passed | `pnpm typecheck`, `pnpm build`; no deployed-container claim |
| Unit and contract suites | 82/82 passed | 56 TypeScript tests, 3 collector tests, 11 companion authority tests, 9 Python parser tests, 3 tokenizer contract tests; `evals/results/unit-log.txt` |
| Chromium student journeys | 5/5 passed | `evals/browser`, final run November 16; original and renamed unseen ordinary PDF/notebook/CSV uploads, exact rendered PDF physical page 2, five-bin patch, independent attempt and reload; mobile/outage, two-tab deletion and keyboard citation focus |
| Numerical cross-check | 6/6 passed | `evals/results/numeric-oracle.json`; independent NumPy/SciPy comparisons, four histogram cases and two regression cases including billion-offset and constant x |
| Real local database security | Both SQL suites passed | `supabase/tests/rls.sql`, `domain.sql`; actual Postgres 17.11, forced RLS, scoped FTS/vector, owner/course/version joins, immutable attempt/action receipts, browser privilege denial and purge constraints |
| Real local Auth/Storage/worker | 9/9 passed | `evals/results/supabase-service.json`; actual Mailpit code/session, private uploads/index, normalized board/provenance, first independent response versus assisted retry, replay deduplication, unavailable provider, source revocation and account purge; no external SMTP or tutoring provider |
| Real local BGE retrieval | Lexical 12/12, hybrid 12/12 recall@4; forbidden citations 0/24; cross-owner disclosures 0/1 | `evals/results/retrieval.json`; 12 developer-authored synthetic labels, **not** instructor-reviewed held-out support accuracy |
| Retrieval timing | Lexical SQL p50 0.88 ms / p95 2.06 ms; hybrid SQL p50 1.90 ms / p95 7.98 ms | 12 local SQL queries per strategy; document embedding batch 10.27 s, 12-query batch 5.15 s including cold process/model; no end-to-end tutoring latency claim |
| Actual JupyterLab host | 18/18 passed; lost-ack case wrote once | `extensions/jupyterlab/evals/output/real-host.json`; JupyterLab 4.6.6, actual service/WS, local Apply/reject, native undo, elapsed expiry, cell navigation, Stop/switch/rename/reload and forced disconnect after write; **0 human approvals** |
| Automated accessibility | No axe violations in tested lesson; keyboard citation test and 360 px layout passed | Narrow automated evidence; real screen reader, zoom and full manual interaction audit remain open |

The repeatable unit/contract suites cover math invariants, permissions, stale revision/epoch, idempotency, untrusted source data, upload replacement and lease races, practice ownership, provider outages, audio lifecycle with injected transport, cost holds and missing usage, normalized projection, metrics redaction, retrieval, companion authority and parsers. Fixture transport tests never count as real Google audio. Current test summaries are recorded separately in `evals/results/unit-log.txt` when present.

The browser screenshots `original-workspace.png`, `unseen-workspace.png`, recaps and `mobile-workspace.png` under `evals/results/` are synthetic. Histogram rendering was inspected: bars start at zero, count/density labels and data table share the current computed revision. These screenshots do not measure speech-to-visible latency. Playwright paint callbacks are scheduling proxies.

## Open gates and exact missing inputs

| Gate | Current denominator / blocker | Needed to close |
|---|---|---|
| Google smoke and 20-minute lesson | **0/1 sessions; 0/1200 seconds**, credential absent | Authorized Gemini key/project, confirmed text/live model access and terms, reviewed modality prices and ceilings, actual mic/output/browser, screen frame, tool call, interruption and forced reconnect |
| Audio/chart/interruption latency and cost | Useful audio, correct visible chart, interruption latency, provider usage and invoice cost **unmeasured** | Reviewer marks and real provider traces; 30 conversational turns, 50 visual requests on two devices, 20 interruption scenarios, invoice reconciliation and full-pass cost projection |
| Grounding and teaching | Instructor-reviewed release set **0/30**; teaching review **0/12** | Qualified reviewer writes/reviews frozen topic-balanced cases and scores support/locators, abstention and teaching scenarios |
| Screen/device/accessibility | Actual chooser/Stop and screen-reader sessions **0** | Manual Windows and second supported OS capture/stop/denial checks; real screen reader, keyboard, zoom and device audio checks |
| Companion human approval | Actual-host automation 18/18; human approvals **0** | Adult learner explicitly compares, applies/rejects and undoes a diff in their paired notebook |
| Usability and learning | Volunteers **0/5**; recruited pilot **0/15** | Moderated adult tasks, delayed independent attempts and denominators defined in `docs/09-evaluation.md`; no learning or conversion claim |
| Billing and operated deployment | Stripe external test deliveries **0**; staging deployments/restore drills **0** | Test account/webhook, external invite SMTP, support/refund policy, HTTPS/WSS deployment, backup/restore and deletion/retention drill, owner review of paid caps |

Unknown model usage/prices deny paid work; a failed/unconfigured provider gives an honest unavailable state. Raw audio/screens are not retained, and live transcript retention defaults off. Source deletion revokes new application reads immediately; backup/provider erasure windows remain unverified. Local single-replica ticket/admission control must be replaced with shared atomic coordination before scaling replicas.

## Reproduce

Exact clean-checkout, real local services, optional embeddings, live evaluation and companion commands are in [SETUP.md](../../SETUP.md). The shortest demo is sign in with local fixture code → upload the three files → ask the histogram question → open physical page 2 → ask for five bins → record independent practice → reload. This path was repeated with unseen data in Chromium. Paid live behavior, human outcomes and public production readiness are explicitly unverified.
