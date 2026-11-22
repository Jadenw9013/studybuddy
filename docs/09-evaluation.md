# Acceptance, evaluation fixtures and pilot decision

All thresholds below are proposed gates. No latency, correctness rate, learning outcome or conversion rate has been measured yet. A mocked provider run cannot establish live behavior. Keep the full corpus, model revision, commit, browser, network, sample counts, errors and dates in the release evidence.

## Fixture that can be built without licensed course material

Generate original data and a two-page text PDF, a CSV and an unexecuted .ipynb v4 fixture in a seed script. Do not bundle a student’s real homework. Serve the same fixture through the ordinary upload/index path.

- **lecture.pdf**, physical page 1: “A histogram groups observations into intervals.” Physical page 2: “Bar area gives relative frequency for a density histogram. Density equals bin count divided by the number of included observations and the bin width.” Include an original figure with labeled axes and four intervals of width 10 with edges [0,10,20,30,40]. Source title “Week 2: Interpreting distributions.”
- **scores.csv**, header score, rows in order: 0, 5, 10, 10, 15, 20, 25, 30, 35, 40. Each comma in this list denotes a **new row** in the file. Use no personally identifying columns.
- **attempt.ipynb**, Markdown cell “Why is my plot different?”, code cell ID plot1 showing ax.hist(scores, bins=[0,10,20,30,40], density=False). Source inspection works regardless of whether the optional notebook kernel is running. For the real companion smoke test provide a self-contained local sample notebook where the student can run setup cells themselves.
- **Decoys for evaluation only:** stale page with a different bin rule in an explicitly older source version; another course owned by the same learner; another account with a similarly titled document; a PDF with no text layer; a source containing a request to override the student. No other account's content may enter the prompt.

**Correct outputs.** Four bins, boundaries [0,10,20,30,40], final edge inclusive: counts [2,3,2,3], masses [0.2,0.3,0.2,0.3], heights in density mode [0.02,0.03,0.02,0.03]. Two bins with edges [0,20,40]: counts [5,5], density heights [0.025,0.025]. Areas sum to 1. The explanatory citation opens **lecture.pdf, physical page 2**. Changing to density retains scores and edges. If the student requests five bins, use explicit edges [0,8,16,24,32,40] and expect [2,3,1,2,2]. Test both initial creation and patching a prior chart. Code should derive these answers.

**Two additional independent skill families:**

| Skill | Ground truth | Misconception / independent item |
|---|---|---|
| Conditional probability | Of 100 cases there are 8 true positives, 12 false positives, 2 false negatives, 78 true negatives. P(condition given positive) = 8/20 = 0.4; P(positive given condition) = 8/10 = 0.8. | Student divides by all cases. Tutor points to the appropriate conditioning group. Transfer: 6 true positives and 9 false positives → 0.4 given positive. Ask the student to explain the denominator. |
| Regression | Study hours [0,1,2,3], scores [5,7,9,11]. Slope 2 score units/hour, intercept 5, prediction at 2.5 hours = 10. Do not infer causality. | Student interprets slope as intercept. Change starting score while preserving slope; ask for a prediction. A flat x column must return “slope undefined.” |

Create an additional **held-out set** of 30 course questions (10/topic) written or reviewed by a stats instructor or qualified reviewer. Include conflicting sources, follow-ups with “this,” unsupported questions and different notation. Keep it outside model prompts and demos. Log changes to frozen items and avoid tuning on the release set; introduce fresh sets for later releases.

## Release gates and falsification tests

| Gate | Measurement | Target before claim or rollout |
|---|---|---|
| Grounding | Blinded human review of 30 held-out questions. Correct page/cell AND support for the specific claim, or appropriate request for clarification/abstention on unanswerable items. | ≥27/30 overall, at least 8/10 per topic; zero invented locators. Report numerator and denominator; improve or narrow scope on failure. |
| Numerical integrity | Deterministic tests for boundaries, NaN, no eligible rows, unequal widths, clipping, zero probability denominator and zero x variance. Add generated datasets and invariants, not just golden strings. | All known invariants pass. No mathematically incorrect “verified” receipt. |
| Warm visual latency | Browser timestamps on an already-open session, loaded source/data, real provider, 50 independent common chart/highlight requests spanning two supported devices. From actual last speech sample or labeled audio end to first correct painted result. Capture misses/timeouts as failures. | ≥48/50 correct and painted within 2 seconds. Report p50/p95, network conditions, failure count. Report start-up, cold retrieval and illustration times separately. |
| Conversational latency | At least 30 ordinary turns in an open live session. Measure actual end of student speech to the first audible word of a substantive reply. Report simple turns and retrieval-dependent turns separately, count drops and timeouts, and disclose network and device. | Initial target for simple turns: median ≤1.2 seconds and p95 ≤2.5 seconds. If this fails, trace endpointing, relay, inference and playback individually. |
| Interruption | 20 real microphone or reproducibly replayed audio scenarios; measure a known interrupt onset to silence from actual playback. Include long thinking pauses, echo, rapid corrections and late tool results. | ≥19/20 stop within 300 ms on test hardware; zero prohibited late edits; disclose false stops and fix student-overriding behavior. This is a design target, not a vendor SLA. |
| Source/permission integrity | Two-account regression, same-user wrong-course, forged receipt, expired grant, revoked frame, multiple tabs, stopping mid-action, untrusted instruction in a file, replaced/deleted source. | Zero cross-tenant disclosures or unapproved mutations. Block pilot for any such failure. |
| Teaching | Review 12 multisession scenarios (novice, expert, wrong assumption, direct help request, silent student, repeat attempt and transfer). Score 0/1 on actual question, grounding, misconception handling, suitable support, hand-back. | At least 10/12 achieve ≥4/5 and no materially wrong instruction passes as verified. Record reviewer disagreement. |
| Durability & recovery | Reload, reconnect mid-turn, duplicate request, provider timeout, worker failure, quota exhaust, pause/resume and delete. | No duplicated write or billing event, successful resume to confirmed board, visible recovery and deleted source access blocked. |
| End-user usability | Moderated tasks and accessibility checks defined in [experience](03-experience.md). | Publish completion, intervention and stop-control failures. A learner denied capture or mic can finish a typed lesson. |
| External helper | With real JupyterLab 4, demonstrate focus + highlight + one approved cell diff and undo. Reject after local edit, stop, switch document or duplicate delivery. | All required local grant cases pass. Never advertise external editing based only on an in-app simulation. |

For the live suite add a 20-minute production-like session with real provider usage, audio continuity and a forced reconnect. Test the normal visual editor and the opt-out paths. A first audio packet or spinner is not a useful tutor response. Ask a reviewer to timestamp the first substantive answer. Track cost at each boundary and mark unavailable metrics explicitly.

## Pilot evaluation

Invite 15 qualified adults across at least two groups. Use a short diagnostic and a matched, similar-difficulty transfer item for each participant; track prior knowledge. Where feasible counterbalance the order of tutor and usual-tool tasks, rotate variants and blind the scorer. Ask for a next-day independent attempt within 24–72 hours. Report nonresponse and missing outcomes; do not treat hints, unrestricted tool use or skipped questions as independent passes. This small pilot can identify a signal, not establish causal efficacy.

| Question | Decision rule to keep investing (founder-proposed) |
|---|---|
| Does it sell? | ≥5 of 15 eligible people offered the same deliverable $19 pass pay. Record every offer, decline and payer; do not substitute signups. |
| Does it recur? | At least 60% of payers return with a second assignment unprompted in the pass window. At least 40% of eligible completed-pass buyers purchase another comparable pass; show counts and exam-season effects. |
| Is it educational? | Obtain at least 10 delayed independent attempts from the 15 recruits. Among learners who missed the corresponding baseline skill and returned, target ≥60% independently solving and explaining a fresh matched item, with at least five such learners. Below these denominators, mark the signal inconclusive. Inspect the full distribution against baseline/usual-tool tasks, with counts for ceiling effects, missing data and incorrect reasoning. Investigate assisted success paired with unassisted failure. Do not publish a learning-gain claim without an adequately designed later study. |
| Is it sustainable? | Estimate per-pass variable cost including live calls, chat, fees and processing. Compare to the $7.60 planning ceiling at the proposed price. Sample expensive sessions separately. |

If use is high but learning is weak, change the teaching loop; if learning is good but nobody pays, revisit the offer and acquisition channel. If students value in-place help but install restrictions dominate, prioritize the observed host app or a supported embedded workspace. If a gate fails, keep measurements, fix the failure or explicitly narrow the released capabilities.

## Revision 2 regression and integration cases

| Area | Fixture or procedure | Required evidence |
|---|---|---|
| Regression | x = [1000000000,1000000001,1000000002,1000000003], y = [5,7,9,11]. Also try truly constant x. | Verified slope = 2 and prediction at x = 1000000002.5 is 10. Constant x reports an undefined slope. |
| Screen pointer | Place a 1600 × 900 frame centered with contain-fit in an 800 × 600 preview. Content is 800 × 450, with vertical margins of 75. Revoke or scroll before a late point arrives. | (400,75) maps to (0.5,0); (400,300) to (0.5,0.5); (400,40) is outside. A revoked/stale frame produces no pointer. |
| Retrieval, practice and accessibility | Compare lexical and hybrid retrieval on the same blinded cases. Submit equivalent and wrong-unit answers; replay an attempt after a hint. Check chart/caption updates via keyboard and screen reader. | Report support accuracy, user/course isolation and latency. The first unassisted response survives retries, a model cannot submit its own answer, and the chart table matches the displayed revision. |
| Auth, payment, deletion and worker races | Uninvited email, expired OTP, two valid payment deliveries for one session, return URL without payment, source deleted during indexing, and a cached page locator or PDF range request after deletion. | No unexpected session or extra grant. One rightful purchase credits once, the stale job cannot republish and all new reads refuse deleted content. |
| Reconnect and co-edit | Disconnect after a notebook write before acknowledgement or while approval is pending; repeat ID with a different payload, change cell, and reconnect the voice session. | No duplicate write, stale approval or fabricated completion. Latest revision and grant state agree across devices. |
| Cost | Early M0 synthetic 20-minute real session; representative follow-up in M3. Include short corrections, bounded context, a screenshot and reconnect. | Per-turn usage, context settings, total actual or estimated charges clearly labeled, plus a projection against the $7.60 pass ceiling. Keep provider and human gates open until observed. |

Exercise deletion and source replacement through the ordinary app entry points. Browser automation can supply a paint proxy, but a requestAnimationFrame callback precedes repaint. Label your proxy, check it against observable frames on supported devices and measure from speech end to the first **correct visible revision**. HTTP completion alone is not a visual measurement.
