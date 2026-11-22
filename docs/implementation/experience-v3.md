# Conversation-first experience

The November 20, 2026 user request supersedes the original cream/teal visual direction. Canonical revision-2 specifications remain intact; this records the implementation decision.

## Research and decisions

- [Nielsen Norman Group: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) supports keeping frequent actions visible and moving specialized tools into a secondary workspace. The primary task is asking a question; file management, illustration settings and notebook pairing do not precede it.
- [OpenAI: Voice in chat](https://help.openai.com/en/articles/20001274-chatgpt-voice) demonstrates continuity between speech, text and conversation history. Our voice and text paths retain the same lesson, board revisions, citations and learner attempts.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) supplies accessibility criteria, not an aesthetic preference. Use visible keyboard focus, text alternatives, explicit labels, sufficient contrast, responsive reflow and reduced motion. Aim for 44px primary touch controls; do not rely on color or dragging alone.
- [W3C status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) recommends announcing important changes without moving focus. Announce concise completed/waiting/error states, rather than every streamed token.
- [Material 3 color roles](https://m3.material.io/styles/color/the-color-system) informs paired surface/content tokens. Dark mode is a chosen art direction, not a claim that it is universally more accessible or more premium.

## Design plan, reviewed before implementation

**Color.** Blue graphite background #10131C, quieter rail #0B0E15, panel #191F2D, elevated controls #232B3D. Main text #F1F4FA, secondary text #AAB7CA, accent #8BAAFF. Primary buttons use pale accent with dark text for contrast; focused controls receive a contrasting visible outline. Avoid ornamental gradients and glow on text.

**Type.** Segoe UI Variable / system sans for a familiar, crisp interface, 16px body with generous line height. Restrained semibold headings, tabular numeric results, KaTeX with accessible MathML for mathematical expressions. Code uses a local monospace font. No externally fetched fonts.

**Layout.** A compact course/history rail, a flexible central conversation with a reachable composer, and an optional adjacent workspace. Workspace tabs are Materials, Visuals and Practice. On small screens, conversation/workspace switching preserves drafts and controls; no horizontal page overflow. Long notebooks scroll by cell instead of pushing the conversation below the document.

**Hierarchy.** Upload or ask immediately; create the private course/lesson when necessary. Existing courses and saved lessons remain reachable. The actual question and source context replace hardcoded histogram headings. Show supported file types and processing state near attachments. Ready sources remain usable during other uploads.

**Accuracy.** Trusted typed operations compute histogram, regression, conditional probability and vector geometry. Generated raster illustrations are labeled separately and never presented as numerical proof. A missing provider is an explicit unavailable state. Numeric visual edits preserve IDs, revisions and undo; paired notebook edits still require single-use local approval.

**Voice.** One voice control beside the composer, visible stop/interrupt controls during a session, captions and a text alternative. Never advertise a connected voice session before the provider handshake. Preserve the lesson on reconnect. Keep fixture evidence separate from live measurements.

**Review.** This plan meets the requested familiar conversational flow and premium technical direction without introducing a marketing page or replacing coursework with generic chat. Accessibility and usability are verified with automated checks, keyboard/mobile browser scenarios and screenshot review. A human usability study and complete live audio lesson remain independent gates until actually observed.

## Validation record

Implementation and measured results will be recorded in the acceptance report. Automated accessibility checks do not establish full WCAG conformance or human usability.
