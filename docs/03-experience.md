# Web experience and interface specification

A student should be able to start from an assignment, ask one question, and see a relevant change without learning a meeting product. Use the familiar controls students expect from a call; give the work itself most of the screen. No video avatar or waiting room.

## Routes and navigation

| Route | First thing the learner sees | Primary action / exit |
|---|---|---|
| / | For returning users, last course and “Continue lesson.” For new users, “What are you working on?” with “Bring an assignment” and “Try a sample.” | Start on a real problem or explore a static sample before sign-in. Live processing requires an eligible account. No empty dashboard of statistics. |
| /courses | Named courses, last problem and last activity. | Create course, open, rename or delete. Confirm deletion with the scope of removal. |
| /courses/:id | Center: ask box and last attempt. A compact Sources drawer exposes upload/status. Header: course name and “Start live.” | Type a question or enter live from that exact thread. Category filters, file count and settings stay secondary. |
| /lessons/:id | One problem, current source or shared preview, and room for an editable board. | Speak or type, point to a region, interrupt, undo a board step, end or pause. The web view returns to the same lesson after a reload. |
| /lessons/:id/recap | “What you practiced,” evidence of any independent attempt, cited pages, and “Try one more.” | Resume the problem, open its source, or go back to course. No score when evidence is insufficient. |
| /settings | Data controls, usage remaining, provider information and account deletion. | Export a recap, manage retention or delete. Include a help link in the lesson for urgent troubleshooting. |

**Screen-first entry:** show “Help with my screen” alongside the assignment entry or in its chooser. On explicit user click, let them choose a window/tab; they can also paste an image. Open an untitled private lesson immediately after sign-in; linking an existing course is optional. If no course is linked, answer from shared evidence or clearly label general knowledge. Do not imply the tutor has read unseen course material.

## Layout

Use an understated study workspace. Warm neutral background, dark ink text, teal for selected/interactive states, amber for grants and edit previews; icons and labels carry the same meaning without color. Use a system sans or locally hosted Inter for controls, a readable math face for equations, and a monospace face for code. Start with 16 px body, 24–32 px view titles, 8 px spacing rhythm, and 44 px comfortable control targets. Use real content in the first screen: sample question, lecture excerpt, and a selected plot. Do not populate a new account with fake progress.

| Surface | Wide desktop | Narrow window or phone |
|---|---|---|
| Course | Compact left navigation; source/citation drawer opens on demand; composer adjacent to the work. | Single column. Courses and sources open as labeled drawers. Return to the same scroll position. |
| Lesson | Show the student's work on the left and comparison board on the right when needed. Before the first visual, grow the work area. Transcript is collapsible. A bottom control strip stays in reach. | Work and Board tabs preserve selection and zoom. New visuals show “View board”; never steal focus while someone is typing. |
| Source citation | Inline chip with filename and page or cell. Opens exact page with evidence highlighted; one action returns to the problem. | Sheet with readable excerpt and “Open page.” Cite PDF page index separately from any printed page label. |
| Control strip | Mic, text input, Share/Stop sharing, Pause tutor, End. Screen share and notebook grant have separate active indicators and local stop controls. | Keep Stop, text and mic visible; secondary controls in a labeled menu. Confirm end only if a pending edit would be discarded. |

## Interaction details worth implementing

- First upload: explain which files are stored privately, what may be sent to the model and how to delete. A file row says “Indexing,” “Ready,” “Ready with skipped pages” or “Needs attention.” The student can use ready materials while another file processes.
- Live states: **Listening**, **Tutor speaking**, **Checking your source**, **Paused**, **Reconnecting**, **Text only**. Announce meaningful changes in an accessible live region. Do not fill silence with repeated acknowledgments. If a file cannot be read, say which one and offer select/paste text.
- Keep a highlighted object and its label in the same coordinate system. A student's click chooses the target; for an ambiguous “that one,” offer a brief clarification. For screen capture say “Pointer appears in this preview.” For a connected notebook say “Pointer appears in your notebook.”
- Change board objects in place. Offer “Undo board change,” keyboard selection and a data-table view. For charts show axis labels, units, dataset name, filter, bin edges/count and an accessible text summary. For equations provide selectable text, not only pixels.
- For notebook actions show a filterable unified diff for the one cell (a plain before/after works for short cells). Buttons: **Apply edit** and **Keep mine**. If the original cell changed, expire the proposal and display “Your cell changed. Compare again.” Never steal the cursor.
- A browser permission denial, exhausted live budget or provider outage leaves the project available. Offer the best working alternative: type instead, paste a region, reopen sources, or continue self-practice. Never fake “listening.”
- Return visits: the current assignment, cited source, last successful board state and next practice question are visible. Store a short recap. Do not replay private audio or assume old sharing permission.

## Accessibility and usability acceptance

Target WCAG 2.2 AA for the main routes. Verify contrast, keyboard-only operation with visible focus, labels on icon buttons, focus restoration after dialogs, 200% zoom, 360 px layout, reduced motion, live text/transcription for spoken replies, and an equivalent text/table path for visuals. Allow typed input from the first screen. A drawing gesture has a keyboard or element-selection alternative. Test with a real screen reader on at least one supported desktop/browser. These are baseline requirements for all users; specialist learning-disability features have a [separate roadmap](10-roadmap.md).

Observe five adult volunteers using their own laptop, without a narrated tour. Give tasks: start from a file, find a citation, interrupt, change a chart, stop sharing, find yesterday's problem. Target at least 4/5 completing each without coaching and 5/5 identifying how to stop sharing. Treat permission confusion or accidental edits as release issues. Record friction and revise labels or routing before adding onboarding.

## Pilot entry and live status checks

Show one email field to invited adults, followed by one paste-friendly code field with resend and expiry recovery. Restore the intended course after verification. Use generic delivery status to protect invitation privacy. A preview-only sample remains available before sign-in. During a live lesson let learners turn captions on and switch to text. Mark provisional transcript words and replace them in place. Avoid announcing every partial token to a screen reader. A chart's table, labels and summary follow the same board revision as the picture. Test with keyboard and a real screen reader, in addition to automated accessibility checks.
