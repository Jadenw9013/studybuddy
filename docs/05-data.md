# Durable data and course evidence

## Schema to implement

IDs are opaque UUIDs. Index foreign keys. Use database constraints or composite keys to enforce the same owner/course across joins. Object storage uses private owner/course-prefixed keys. Use expiring upload grants for quarantine writes. Deliver source and normalized-data reads through an authenticated API route that checks live ownership, course membership and tombstones for every request, including PDF byte ranges. Keep underlying storage private and enforce matching storage policies. Return private, no-store headers.

| Entity | Required fields and invariants |
|---|---|
| profiles / entitlements | Auth subject, adult-pilot admission, retention preferences, quota period, purchased allowance, consumed/reserved seconds. One active entitlement per period. Never infer age. |
| courses / sources / source_versions | Owner ID, course title; source logical ID, current-version pointer; content hash, MIME, original name, storage key, version, indexing state, failure reason. Source replacement never silently changes an existing citation. |
| ingest_jobs / passages | Version ID, state, lease expiry, retry count, unique (version, parser revision); passages include heading, text, source locator, hash, FTS vector and 384-dimensional embedding for chosen BGE model. |
| datasets | Source version, typed columns and units if known, row count, missing/invalid counts, dataset fingerprint and protected normalized data key. Require explicit user confirmation for ambiguous units/columns. |
| lessons / messages | Owner, course or provisional private course, active problem, mode, current turn, board revision, compact recap, last activity. Typed chat history is persistent and erasable; live transcript is transient by default. |
| board_objects / action_events | Lesson, stable object ID, object type, structured props, revision; event IDs, request ID, status, turn, prior/new revision and minimal receipt. One commit per (lesson, action ID). Sensitive external source text is not a telemetry field. |
| attempts | Lesson/skill, item variant, provenance, first response, hints before attempt, outcome, rubric version and follow-up. Never overwrite a first response with a later retry. |
| grants / usage | Actor, target, scope, expiry, revoke time and pairing nonce digest; metering event ID, provider/model, duration, token categories, estimated cost, reason for session close. No secrets in rows sent to the browser. |

RLS applies to every student-owned row and object. Use authenticated owner-scoped retrieval, including vector and text search. Server credentials that bypass RLS must not perform student-originated searches without explicit ownership checks. Validate both source and lesson membership for citations and action inputs. A lesson can access only its linked course even when the same student owns two courses. Re-link a provisional lesson explicitly; invalidate old source context and grants.

## Ingestion path

Pilot caps (configurable): 25 files/course, 25 MB/file, 200 PDF pages/file, CSV up to 100,000 rows and 100 columns. Stream upload to quarantine, sniff type and reject mismatches; enforce byte, row, page, parse-time and memory ceilings. Supported inputs: selectable-text PDF (export slides to PDF), UTF-8 CSV, plain text and .ipynb v4. Never run uploaded notebooks, load external resources or render arbitrary notebook HTML/JS. Strip active outputs; permit sanitized text and explicitly supported static images. Formulas in imported CSV are text. No automatic fetch of pasted links.

1. Hash bytes, create a version and leased job, return visible status. A retry of the same upload must not duplicate billable embedding work in the same owner/course.
2. PDF: preserve page boundaries and physical page index; store printed label when available. Keep the original for the preview. Do not convert a visually aligned PDF table into authoritative numeric data without validating row/column structure. Ask for CSV or student confirmation. For scanned pages with little/no extractable text mark skipped pages; paste text, attach a region or re-export a searchable PDF.
3. Notebook: preserve ordered cells and stable IDs when available; use version + ordinal + source hash for older files. Associate visible outputs with cells and mark them as saved snapshots; they can disagree with current code. CSV: infer schema with a reviewable preview; count missing/invalid values and preserve original units.
4. Chunk by heading/page/cell; initial setting 450 tokens, 60 overlap, never lose the original locator. Embed normalized text and retain metadata, independent of model conversation. Retry transient failures up to three times; classify unsupported/corrupt files so they are not repeatedly queued.
5. Atomically publish a ready version. While a replacement indexes, continue serving the prior ready version with its version label. Once new version becomes current, mark older links “Earlier version” and cite them accurately. Explicit deletion removes access to all versions.

## Retrieval and citations

Pin active assignment, current source selection and dataset IDs. For a course question, combine full-text ranking and nearest passage search constrained by owner, course and allowed versions. Start with top 10 from each, reciprocal-rank fusion (k=60), deduplicate, then add up to four passages / ~2,000 tokens. Ask the user to choose between similarly named datasets or conflicting instructions. Similarity alone is insufficient support for an exact answer. Text directly visible on a shared screen may support a screen-sourced observation but must not be relabeled as an uploaded lecture quotation.

A citation is a server-resolved tuple such as **sourceVersionId + PDF pageIndex + passageId**, **notebook cellId**, or **CSV column and row interval**. The UI validates every supplied reference before rendering, opens the exact location, and shows filename and version. For an instructor-specific assertion, verify the retrieved text/figure actually supports the claim. If support is weak, widen retrieval once, then ask for the source or offer a clearly labeled general explanation. For calculations, attach dataset version, column and transformation in addition to any lecture citation. Distinguish ability to open a citation from correctness of its claim in evaluations.

## Data lifecycle

The authoritative files/index for this web release are privately hosted. The browser can cache the current lesson in memory; clear on sign-out or expiry. Explain that relevant excerpts, audio and selected frames may be sent to named providers. Default to no stored raw audio/screen frames. For a permanently attached screenshot, require an explicit “Save to course” action. Learners can delete an individual source, lesson, course or account.

Deny access immediately on delete, revoke active streams/grants, and enqueue idempotent purge of originals, normalized data, versions, chunks, vectors, caches and derived course recaps that expose them. Render old links as “Source removed.” For a source-only deletion, purge or redact copied source excerpts from retained chats/boards. Log completion without recording content. Specify actual hosting backup expiry and provider retention before external release; never promise immediate erasure from third-party or backup systems without verification.

## Retrieval, deletion and background jobs

Preserve exact page text, code identifiers, symbols and units beside the searchable representation. Inspect the embedding tokenizer's actual limit including special tokens, and keep a page/cell mapping across splits. Promote hybrid retrieval only on measured gains or a verified reduction in missed citations at acceptable latency and cost. If lexical-only wins under the existing release rubric, retain that measured configuration. A highlighted bounding box needs a real text-to-page mapping; otherwise open the correct page and show the supported excerpt.

Recheck version and ownership at job publish. Claim jobs atomically with a lease and a new fencing token (an identifier unique to that lease). Only the current holder can publish. A delete or replacement can win while a worker is running; stale output stays inaccessible and is purged. Link derived board values, recaps, and copied excerpts to their source version so individual-source deletion can invalidate or redact them. New reads fail as soon as a deletion is committed. Close active lessons' affected streams where possible. Bytes already received by a device cannot be recalled. Verify the direct storage path cannot bypass the application read policy.
