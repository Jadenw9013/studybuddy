# Product decisions and pilot

**Promise.** When a learner is stuck on their own assignment, they can point to their work, talk through the discrepancy using the instructor’s materials, and then solve a related problem independently. The product succeeds when the learner returns with the next assignment and becomes more capable without help.

## People and buying decision

| Role | Decision |
|---|---|
| First buyer and learner | U.S., English-speaking adult (18+) working full time and taking a part-time online graduate or professional course using introductory statistics. Recruit people with a real weekly assignment, limited access to office hours at study time, and a laptop. Prior paid study tools are a useful interview question, not an admission requirement. |
| Starting customer group | Invite adult learners through two independent online cohorts. Start with the founder’s Seattle-area university network, then recruit beyond it. Do not imply school endorsement. The learner pays and owns their project. |
| Subject and work surfaces | Histograms and distributions, conditional probability, and simple linear regression. Web workspace with PDFs, CSVs and Python notebook files; first optional external integration is personally controlled JupyterLab 4. |
| Secondary buyer research | Interview parents of AP Statistics students about actual spending, recurring pain and desired learning evidence. Use adult-only interviews or static concept materials. No teen access to the proposed Gemini-backed pilot. A parent payment does not settle provider eligibility. |
| Future markets | Undergraduates, other subjects and learners with disabilities can benefit from the same course/lesson design. Targeted accommodations, minor users and school procurement need their own evidence and rollout decisions. |

The [market sources](11-evidence.md) support testing this audience. A voluntary Brown survey found an existing paid-AI signal in online master’s students. It does not predict conversion for an additional tutor. Separate student, buyer, recruiting channel and decision trigger in interview notes.

## Scope decisions

| Core web MVP · validate demand | Complete first release · add after core | Explicitly later |
|---|---|---|
| Invite-only email-code login, private courses, source status and replacement, cited chat, screen-first entry, interruptible voice, synchronized board, screen-preview pointing, practice and resume | Installable, scoped JupyterLab companion: identify cell, highlight, navigate within paired notebook, preview one text replacement, apply locally, verify, and undo when still safe | General browser/OS takeover, system-wide cursor, LMS or inbox sync, reminders, under-18 accounts, parent reports, specialized disability cohorts, native app, OCR-heavy ingestion, avatar/video lessons, fine-tuning |
| Exact math/diagrams: histogram, scatter/fit line, probability table or tree, equations, highlights, editable labels | Illustrations are an optional experiment behind a flag. Turn on only with an enabled image provider, cost budget and separate evals. Original images never gate a math lesson. | Building a full notebook IDE, executing imported code, grading or submitting assignments, selling unlimited live minutes |

The web app is the client. Start with current desktop Chrome on macOS and Windows for the full pilot. Text, sources and recap should reflow on a phone. Feature-detect capture/audio and offer text when unavailable. Recruit only users on confirmed supported devices for latency claims. Use one shared lesson record; changing modality never creates a second conversation. Private hosted course storage is an explicit web-MVP decision, revising the earlier desktop/local-only proposal. Show this before upload.

## Prove the idea

**Buying trigger:** “I have an assignment due, and the output in my notebook disagrees with the lecture.” Main success event: a correct, source-linked intervention followed by a new attempt made by the learner. Log that event separately from an assistant turn or a chart appearing.

Recruit around 15 eligible adults across two cohorts. For a deliverable pilot, offer a **$19 four-week pass with 80 live minutes** (up to 20 minutes per session) and private course chat subject to the published quota. One short demonstration first. Use a one-time Stripe-hosted Checkout Session created on the server for the signed-in pilot account. Verified fulfillment credits the pass once. Staff can reconcile the same transaction in a documented recovery procedure. Use an explicit renewal purchase. Interview non-purchasers too. Compare against their usual workflow and record whether an existing paid tool was displaced. Prices and counts are experiments. [Measurement rules](09-evaluation.md) define the denominators and expansion decision.

**Deliberate product tradeoff.** In-place pointing on the student’s actual Jupyter notebook needs the companion. On any ordinary shared screen, the pointer appears inside our preview. Show this difference in the UI. Keep watch-only help, editable board and course chat valuable even if nobody installs anything.
