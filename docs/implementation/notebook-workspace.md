# Notebook workspace upgrade

## Reference and design

The supplied screenshots guide the charcoal surfaces, rounded notebook library, persistent source list, central conversation and right Studio panel. The product keeps its own Live Tutor identity. Google's [notebook guide](https://support.google.com/gemininotebook/answer/16206563) describes independent source collections and the Sources–Chat–Studio workflow. Its [flashcard and quiz guide](https://support.google.com/gemininotebook/answer/16958963) describes interactive reveal, explanations and saved review progress. These inform the implemented workflow; they are not a claim of feature parity.

The palette is ink `#101011`, charcoal `#1c1c1e`, elevated charcoal `#27272b`, divider `#343438`, primary text `#eeeeF2`, with periwinkle `#bdc7ff` for actions. Subtle blue, mauve and green distinguish Studio tools and file types. Typography uses the local Segoe UI Variable/system sans family; notebook names and conversational content carry hierarchy without decorative uppercase labels. The library uses broad rounded cards; source rows and chat replies remain compact and mostly unboxed.

```text
Library: brand / notebook search / view controls
         notebooks with real source counts and resume actions

Notebook: back / notebook title / controls
          Sources | Chat                     | Studio
          search  | grounded replies         | study tools
          select  | citations + save to note | saved outputs
          files   | composer + live voice    | notes

Mobile:   Sources / Chat / Studio navigation, one panel at a time
```

The reference's layout is appropriate because the content is a source collection. The prominent graphic is the computed explanation when requested. There is no decorative hero, invented featured catalog, nonfunctional sharing, or pretend audio/video generation. Existing source citations, correct board tools, live voice and locally approved notebook edits remain available.

## Functional scope

The upgrade adds a searchable notebook library, source-scoped chat/voice/Studio context, editable saved notes and answer-to-note capture, and persistent cited study guides, flashcards and quizzes. Notebook actions use the current course and learner permissions. Source content remains data; tool boundaries validate source ownership, exact revisions and safe output schemas.

Verification and observed limitations are appended after integration. Fixture outputs remain distinct from real provider measurements. Earlier DSA voice cross-source observations remain in [DSA acceptance](dsa-acceptance.md).

## Observed verification

The notebook library creates, searches, filters, sorts, switches grid/list, renames and resumes real notebooks with actual source counts. Source selection updates immediately, rolls back on failure, persists across reloads and fences pending source-based work. A source selection of zero stays empty rather than reverting to all files. Existing conversations and diagrams remain saved, while deselected derived context is excluded from subsequent model input.

Notes support new drafts, saving a cited answer, editing with revision checks, deletion and Markdown download. Study guides, flashcards and quizzes are saved with their original source/version coverage. Cards reveal answers and remember known items and cursor; quizzes remember responses and show explanations. These self-study records remain separate from the independent-attempt ledger. Studio generation can continue during normal chat; changing its source scope or deleting a dependent source fences or cancels publication.

- **256/256 automated checks passed**: 226 TypeScript checks, 3 metric-collector checks, 11 companion checks, 13 parser checks and 3 embedding checks. A final focused provider-contract run passed **41/41** checks after explicit single-attempt SDK retry configuration.
- **25/25 fixture browser cases passed**, covering the existing original/unseen tutoring journeys and the new notebook, source-selection, saved-note, Studio-progress and mobile keyboard/accessibility journeys. Early failures exposed missing mobile header controls, delayed checkbox feedback and a note-field label association; the product issues were fixed before this passing run.
- **7/7 real local Postgres suites passed**, including the new source-scope, saved-note and Studio/request lifecycle constraints and owner access rules. Migrations `202611210007_notebook_sources_notes.sql` and `202611210008_studio.sql` were applied with existing data retained.
- Build and type checking passed. All **15 canonical revision-2 handoff files** still match their manifest hashes.
- **3/3 real Gemini Studio generations passed on the first run**, using one ordinary uploaded synthetic DSA guide. The study guide had three cited sections, the flashcard set two cited cards, and the quiz three cited questions. All eight item citations matched the supplied passage, current owned source version and locator. Source dialogs opened, content survived reloads, card/quiz progress persisted and the independent-attempt ledger remained empty. There were zero page errors; the test removed only its own course.
- Observed response/UI proxies were **4.652s guide, 3.444s flashcards and 5.627s quiz**. The three calls reported **2,946 tokens total**, with an application estimate of **$0.0055095**. This is one small synthetic trial, not a latency distribution or an invoice.
- Two sample sections/cards/questions per output were inspected by the implementation agent: the sampled BFS queue, DFS depth-first behavior, left-before-right tree convention and quiz answer indices agree with the guide. This is a bounded sample review; independent instructor/learner evaluation remains open.
- The original course still has **six ready sources**, and the DSA playground still has **five**. Counts were read through the real authenticated local API after migration and the live test.

Machine-readable results: `evals/results/notebook-acceptance.json`. Raw bounded live history: `evals/live/results/notebook-studio.json`. Fixture screenshots: `evals/results/notebook-library.png`, `notebook-workspace.png` and `notebook-workspace-mobile.png`. The real-provider screenshot is retained alongside the ignored paid-test history.

## Run and shortest demo

```powershell
pnpm db:start
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000/`. Choose an existing notebook or create one, add files, and use the left checkboxes to choose its evidence. Ask a question, open its citation and choose **Save to note**. In **Studio**, generate a study guide, flip a flashcard or answer a quiz, then reload and resume. Use **Studio home** to return to its tools and **Expand Studio** for a wider reader. On mobile, use **Sources / Chat / Studio**. The DSA playground remains at `http://localhost:3000/lessons/509a2601-41e4-45c2-96b5-2ac97f26b4f9`.

`pnpm test`, `pnpm test:e2e` and `pnpm db:test` reproduce the independent checks. Stop the live app before the fixture browser suite. Real generation is opt-in through `RUN_PAID_NOTEBOOK_STUDIO=true` and `pnpm exec playwright test -c evals/live/notebook-studio.playwright.config.ts`; its paid history has a fixed cap and no automatic retries.

This upgrade implements the core source/chat/study workflow, not complete NotebookLM parity. Audio/video overviews, slide decks, web discovery, collaboration and Google sign-in are not added. The later [voice-switching follow-up](dsa-voice-switching.md) includes scoped successful switches and a failed approved extra trial; the final tool-registry correction still needs live confirmation. Real microphone/device acceptance, the complete voice journey, a 20-minute human lesson, independent teaching-quality evaluation and invoice reconciliation remain open. Those voice observations are separate from this visual/workflow upgrade's original checks.
