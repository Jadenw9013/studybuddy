# Live Tutor · greenfield build handoff

**Product decision, November 16, 2026.** Build a web tutor for U.S. adults learning introductory statistics after work. A student brings a lecture, an assignment and an attempt. The tutor can find the relevant source, talk through it, draw on a shared board, point into a shared preview, and hand the problem back. A student can start without installing software or uploading an entire course.

The first session should answer a concrete question: **“Why does my histogram look different from my professor’s?”** By the end, the student should be able to interpret a different histogram without help. The release must also handle probability and regression tasks the team did not design the interface around.

## Start building

**Handoff revision 2 · 2026-11-16.** When upgrading an earlier extracted folder, put the revised ZIP beside the existing AGENTS.md or attach it to Codex. Use [the checksum manifest](HANDOFF-MANIFEST.md) to reconcile only the listed files. Preserve local edits. A fresh checkout can extract the revised archive directly at its root.

**First assignment for Codex:** synchronize and verify the handoff, then implement M0 through M6. Read AGENTS.md, the two audits, and docs/08-build.md. Start the normal upload-to-histogram lesson alongside the real voice feasibility test. Continue independently when a provider key or human participant is unavailable. Keep those acceptance gates open. Return run commands, a demo route and observed results.

| Read | Use it to decide |
|---|---|
| [Technology comparisons](tutor-stack-audit.md) · [tool and operations audit](docs/12-tool-audit.md) | Alternatives, actual measurements, pilot defaults and integration tests |
| [AGENTS.md](AGENTS.md) | Repository rules, first tasks, definition of done |
| [01 · Product and pilot](docs/01-product.md) | Buyer, promise, release scope, pricing experiment |
| [02 · How the tutor teaches](docs/02-teaching.md) | Tutor moves, worked examples, feedback and transfer |
| [03 · Website and interaction design](docs/03-experience.md) | Screens, layout, wording, accessibility and usability tasks |
| [04 · Architecture](docs/04-architecture.md) | Deployable units, provider choices, trust boundaries |
| [05 · Course data and retrieval](docs/05-data.md) | Data model, citations, indexing, access and deletion |
| [06 · Live sessions and tools](docs/06-live-tools.md) | Events, actions, interruptions, screen sharing and co-editing |
| [07 · Operations and privacy](docs/07-operations.md) | Consent, budgets, observability, failures and launch setup |
| [08 · Build sequence](docs/08-build.md) | Repository layout, environment, milestones and release evidence |
| [09 · Evaluation and fixtures](docs/09-evaluation.md) | Reproducible input/output, gates and pilot decision rules |
| [10 · Future product decisions](docs/10-roadmap.md) | Learning-disability focus, email/Canvas planner, native desktop |
| [11 · Research and technical references](docs/11-evidence.md) | Basis, limits and official reference links |

**Two release labels matter.** The core web MVP passes M0–M4 and the applicable M6 gates. It tests whether students learn and pay without an install. The complete first release also passes M5 and its live Jupyter tests. Only that release can advertise approved edits in a connected external notebook. Unrestricted OS control is a later product. The under-two-second goal is a test target for a prepared chart or highlight. No performance or learning claim has been measured by this documentation.
