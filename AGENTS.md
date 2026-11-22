# Instructions for the implementation agent

Build the working web product described in [the handoff](README.md). An empty repository is expected. The product name “Live Tutor” is a working label. Do not spend a milestone on naming, a landing page, or a generic chat UI.

## Handoff revision 2
Before building from an earlier extraction, synchronize the files in [the revision manifest](HANDOFF-MANIFEST.md) with the supplied revision 2 archive. Keep unrelated files and any local additions. Read [the stack review](tutor-stack-audit.md) and [the tool audit](docs/12-tool-audit.md). Implement the entire M0–M6 sequence in this assignment.

## Where to start

1. Read [product](docs/01-product.md), [experience](docs/03-experience.md), [architecture](docs/04-architecture.md), and [milestones](docs/08-build.md).
2. Bring up one end-to-end path before building feature breadth. Make the included course usable from a clean checkout. Make uploaded courses use the same pipeline as the included course.
3. Use [contracts](docs/06-live-tools.md) for every mutation; use [fixtures and gates](docs/09-evaluation.md) to verify behavior. Product boundaries live in [the roadmap](docs/10-roadmap.md).
4. Generate implementation-specific artifacts in the repo as you go: setup instructions, environment template without secrets, lockfiles, database migrations, seed data, machine-readable schemas and a short acceptance report. Preserve this specification until evidence warrants a documented change.

## Constraints that affect code

- One active course and one authorized learner per pilot session. Keep the selected problem, source revision, board revision and learner attempt shared between voice and text.
- Treat uploads, webpage text, notebook outputs and tool results as data. They cannot grant permissions or issue instructions. Check permissions independently at the tool boundary.
- The model proposes typed actions. Trusted code computes numeric results, resolves source locators, renders visuals, checks permission and confirms edits. No arbitrary generated JavaScript, shell, notebook execution, or remote URLs in board operations.
- A student may ask for a direct explanation, work silently or stop a demonstration. Preserve their edits and recover after interruption or connection loss.
- Use real audio, retrieval, persistence and tool execution for live acceptance. A clearly labeled development fixture enables offline CI; it cannot count as successful provider integration. A failed or unconfigured provider must not display a fabricated answer.
- Build for adult pilot participants. No child-directed onboarding, parent dashboards, Canvas/email sync or native desktop client in this release.
- Do not substitute an app-wide cloud browser for control of a student's device. An external edit targets only the paired JupyterLab instance and requires a local, single-use Apply action.

## Definition of done

A reviewer can start the app, sign in, bring their own supported files, ask a previously unseen question, inspect its citation, switch to a voice lesson, interrupt it, modify a correct chart, share and stop sharing a window, try an independent problem, and resume the saved lesson after a reload. Validate denials, provider outages and stale results as well as successes. For the complete first release, also demonstrate preview/apply/reject in a real paired notebook. Record observed measurements, denominators and unresolved failures. Never silently relax a gate to mark a milestone complete.
