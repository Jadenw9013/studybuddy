# StudyBuddy implementation status

The app has a notebook library, source selection, cited chat, saved notes, study guides, flashcards, quizzes, computed visuals and live voice. Read [setup](SETUP.md) for the pinned tools, local services and environment configuration.

The latest checks passed **281 automated cases**, including **20 voice-relay regressions**, plus type checking and the production build. Earlier checks passed 25 fixture browser cases, an eight-case affected-journey rerun and seven local Postgres suites. The 15 original handoff files retain their manifest hashes. The machine-readable summary is [current acceptance](evals/acceptance/current.json).

The [production build correction](docs/implementation/production-build.md) fixes the development-mode build crash, prepares the PDF worker and supplies the Vercel web-workspace configuration. The [hosted service setup](docs/implementation/production-hosting.md), production environment template and Compose configuration prepare the separate API/worker deployment. Hosted Supabase, API/worker hosting and real hosted integration checks remain required; a successful web build alone does not make those services operational.

**The complete live DSA voice journey remains open.** The most recent approved live trial completed BFS ready, BFS next and DFS ready, then safely rejected an invalid create operation during the tree switch. A final correction removes creation from connections that already contain a board and retains replacement/patch operations; its deterministic tests pass, but it has not received another paid live test. Earlier trials observed spoken tree/BST switches. Those observations are not a passing repeatable nine-turn journey. Human microphone/device acceptance, the 20-minute lesson and instructor review also remain open. See [voice results](docs/implementation/dsa-voice-switching.md).

For a local fixture demo without paid providers, after installing the prerequisites in [setup](SETUP.md):

```powershell
pnpm install --frozen-lockfile
pnpm run setup
pnpm seed:demo
pnpm exec playwright install chromium
pnpm dev:fixture
```

For the configured live local workspace, start Docker, run `pnpm db:start`, apply the configured database migrations with `pnpm db:migrate`, then run `pnpm dev`. To import the synthetic DSA course, run `pnpm seed:dsa` and open its printed lesson URL. Try BFS, Next step, DFS, inorder and BST search for 7. Manual visual controls remain available without a model call.

API keys, local course uploads, raw live evidence, private one-use maintenance and generated screenshots/logs are excluded from Git. Fixture results remain separate from provider measurements. Google sign-in is deferred; the opt-in local sign-in bypass is restricted to development and loopback access.
