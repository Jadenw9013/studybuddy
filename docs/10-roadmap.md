# Future scope and decision triggers

Keep the MVP independent of future integrations. The full vision is a trusted tutor that can study, converse, see a selected task, demonstrate safely and help a student manage coursework. Each expansion below has its own evidence requirement.

## Specialized support for learners with disabilities

**Future product focus explicitly requested by the founder.** Deliver baseline accessibility now: keyboard and screen-reader access, text/voice choice, adjustable pace, captions, simple layouts, reduced motion and alternatives to drawing. The MVP may serve individual learners who choose it; it makes no diagnosis, clinical or specialist outcome claim.

Before specializing, recruit and compensate learners with lived experience and accessibility specialists as co-designers. Choose one concrete unmet task with them, such as losing one's place in a long multi-step explanation. Prototype user-controlled accommodations: pin the current step, show one instruction at a time, read-aloud with synchronized highlight, persistent scratch notes or caption timing controls. These are candidates, not assumptions about what any disability group needs. Test usefulness and accessibility with participants, including those who decline personalization. Let settings be selected, edited, exported and deleted without disclosing a diagnosis. Do not infer a disability or collect medical records to customize a lesson. Establish appropriate expertise, privacy and outcome evaluation before claiming specialized benefits.

## Assignment planning and reminders from email and Canvas

**Future product focus explicitly requested by the founder.** The intended experience is similar to how the founder currently uses Meta Muse: review school email and Canvas, notice upcoming assignments or changes, and avoid missed deadlines. This is a separate opt-in planning experience. The MVP does not ask for inbox, Canvas, calendar or notification access.

Candidate sequence once live tutoring shows repeat use:

1. Interview students who use multiple sources. Establish which system is authoritative for each course, their timezone and what kinds of reminders they actually want.
2. Read assignments from an authorized Canvas integration using published APIs and school-approved OAuth or supported feed. Start with read-only scopes. No password collection or automated browser login as a stand-in for consent. Some schools require administrator approval; test on a willing pilot institution.
3. With separate consent, add Gmail or Microsoft email for selected courses, senders or labels. Extract potential changes into a review queue with a source link and confidence. Minimize retained message content. A message cannot direct the system to grant or expand access.
4. Normalize a due item by provider, course and assignment ID; use content hash + source timestamps for duplicates/updates. Preserve original timezone, date-only ambiguity, per-student extensions, cancellation and conflicting deadlines. Do not silently choose between an email and an LMS date. Present the conflict to the student.
5. Let the student approve, edit or dismiss inferred items and choose digest timing, channels, quiet hours and snooze. Handle OAuth revocation, expired tokens, late jobs, retries and duplicate notifications. A disabled connector or missed sync must be visibly stale. After trust is demonstrated, offer opt-in auto-acceptance for well-defined source types.

Success: correct deadlines against student-verified ground truth, low duplicate/false reminder rate, measured reduction in missed deadlines and transparent failures. No email sending, assignment submission or writing to calendars without separate product decisions.

## Other expansions

| Candidate | Revisit when | Work required first |
|---|---|---|
| Parent-funded AP Statistics | Parents show real purchase intent AND teens want the learning experience. | Select provider/deployment terms compatible with the actual under-18 use, age and consent design, device restrictions, teen privacy, content/quality review. Parent reports should communicate learning outcomes without exposing private conversations by default. |
| General browser or native desktop help | Target students repeatedly cannot finish a valued task with web previews and scoped Jupyter. | Compare a browser extension, host-specific integration and signed OS companion. Test persistent stop controls, app boundaries, device permissions and conflict recovery. A web app cannot control native desktop software from screen sharing alone. |
| More subjects / languages | A new cohort shows recurring demand and the current subject passes transfer and reliability gates. | Add verified representations, subject experts, source parsing and held-out tasks. Evaluate embeddings and voice in the new language. |
| Original images or short video | Students regularly ask for explanations that a source figure or structured drawing cannot provide. | A/B test learning or clarity, visual correctness, time to useful output, licensing and unit costs. Keep numeric labels anchored to computed data. |
| Custom models | Traces identify a repeated, expensive failure in a narrow task. | Compare a small trained board-operation model against the direct tool-call baseline on held-out assignments. Establish permission for training data, license compatibility, quality/cost gains and rollback. |
| School contracts, broad LMS sync, parent dashboards, avatars | Evidence of paying demand and operational capacity. | Separate procurement, data-sharing, institutional access, support and deployment work. No speculative SDK integrations in M0–M6. |

Maintain a decision log when promoting an item: observed problem, evidence, alternatives, scope owner, acceptance gate, data permissions and release impact.
