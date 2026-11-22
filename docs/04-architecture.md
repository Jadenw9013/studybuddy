# Architecture and technical decisions

## System topology

~~~mermaid
flowchart TD
  Web["Web app: course, audio, preview and board"] <--> API["Authenticated session service"]
  API <--> DB["Private course and lesson storage"]
  DB --> Worker["Ingestion worker"]
  Worker --> DB
  API <--> Voice["Live or typed model"]
  API --> Gate["Typed tool gateway"]
  Gate <--> DB
  Gate <--> Web
  Gate <--> Lab["Optional paired JupyterLab"]
~~~

The browser renders a working chart using data already authorized for the current student. The server authorizes tools and commits state. The local Jupyter integration independently verifies its grant and cell revision before applying an edit. Uploaded files and model replies never set policy. Plain explanations can stream directly; an evidence-dependent claim waits for retrieval, and a claim about the visible board waits for its render receipt.

## Selected stack

| Part | Default | Reason / boundary |
|---|---|---|
| Web UI | Next.js App Router, React, TypeScript, CSS tokens; accessible primitives | One responsive website. Browser APIs for mic/screen, AudioWorklet for audio scheduling. Render charts and equations locally. |
| Session service | TypeScript Fastify service on **a long-lived WebSocket-capable container**, same region as database | Owns authenticated HTTP commands and duplex audio relay, tool validation, receipts and provider keys. Default to one regional replica for the pilot. Avoid deploying the relay on short-lived request functions. |
| Persistence | Supabase Auth (invite-only email OTP), private Storage, Postgres with RLS, full-text and pgvector | Per-owner course files, evidence, attempts, board and resumable lessons. Admin/service role confined to worker and narrowly scoped operations. |
| Ingestion | Python worker, pypdf for text PDFs, nbformat, Python CSV, sentence-transformers BGE-small-en-v1.5 | Start with one worker process. Changed passages only. Use a database job table, leases and retry limits; no external queue is necessary for the pilot. Browser PDF preview via PDF.js. |
| Tutor | Paid Gemini Developer API. Candidate defaults gemini-3.8-live and gemini-3.8-flash for text, provided available to the project | Keep model IDs, API versions and usage mapping in configuration. Capability-test them with the actual account during M0. Voice is streamed, text chat reuses lesson state. No model training in v1. |
| Board | Vega-Lite for plots, KaTeX for equations, first-party SVG for probability trees / annotated diagrams | A local statistics module computes exact values; chart specs are constructed by the app. Only trusted diagram primitives and bounded numeric transforms. |
| Outside our app | Browser display capture for seeing a shared window. Optional prebuilt JupyterLab 4 extension for cooperative control. | Ordinary web users need no install. A generic Chrome extension, Playwright agent or hosted browser does not implement v1 control. Use Playwright Test for repeatable app checks. Its interactive CLI is optional. |
| On-demand illustration | Optional FLUX.2 [klein] 4B adapter, disabled by default | A separate product experiment. Run asynchronously; show generated status and attach only to its current turn. No image model in numerical or geometric truth paths. |

Use current supported stable runtime versions, pin exact resolved versions and commit lockfiles in M0. Pin embedding weights/revision to keep indexing reproducible. Do not change an embedding model without a versioned re-index. Keep the existing model adapter contract small: open/close live stream, send context/activity/audio and tool results, normalize events and usage, stream text completions. Cross-provider evaluation can reuse recorded tasks; a second provider is not needed for the first release.

## Example request

1. A course chat already has the current assignment, selected PDF page, selected cell, allowed tool names and board revision. Starting live loads the same identifiers plus a compact recap, then opens a server-to-provider voice session.
2. The browser streams mic audio over TLS to the authenticated relay. The relay keeps only transient buffers, forwards to the provider in its supported format, and streams tutor audio/events back. For typed chat use the text adapter against the same state.
3. “Show my histogram” resolves to a specific dataset and column. If either is ambiguous, ask the student. The service checks ownership and produces a typed board operation; a ready dataset can stay in the browser as an authorized cache.
4. Render the chart, announce it accessibly, send a receipt with the computed result and revision; then explain its heights. A screenshot lookup or remote image call must not block a ready chart.
5. “Use five bins” is a patch on one board object. A student dragging the slider bypasses the model and sends a student-authored board revision. Feed the new revision to the conversation.
6. Save durable lesson state at acknowledged changes. If the relay is lost, reopen from the last durable revision, not from unplayed speech. Reconnection does not renew edit grants.

## Deployment and failure boundaries

Run web, relay and worker separately, even if deployed together behind one TLS origin at first. Route /api and /live to Fastify. Use short-lived signed WS tickets minted via authenticated HTTP, scoped to session/user and consumed once. Validate Origin and account entitlement on upgrade. Separate read-only shared preview from content mutation. Avoid duplicating authority in Next.js routes.

The API has an idempotent command handler, not a general autonomous browser agent. Approved mutations are committed transactionally and broadcast in revision order. For external edits the local editor is authoritative; reconcile using action ID and the returned new source hash. If an external acknowledgement is lost, show “Checking edit” and query status; never blindly retype.

Secrets, storage, budgets and incident behavior are in [operations](07-operations.md); object permissions, access tests and purge semantics are in [course data](05-data.md).

## Pilot defaults after the two tool reviews

Keep the hosted voice relay, private database, direct board tools and zero-install web flow as the implementation baseline. M0 records a full 20-minute voice session with interruptions, a frame question, a tool call and reconnect. A short initial capability probe can precede it. Attach provider usage per turn and measure what is remembered after context compression. Compare a matched alternative if a gate fails. Compare Postgres lexical-only and hybrid retrieval on the same held-out questions before tuning the embedding model. Numeric board tools run trusted application code. External edits use the paired notebook's local transaction. [Stack comparison](../tutor-stack-audit.md) · [Tool-by-tool decisions](12-tool-audit.md)
