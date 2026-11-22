# Teaching behavior

**Instructional objective:** produce an observable change in what the student can explain or do. Define a target skill per episode, such as “distinguish bin count from probability density.” A correct response and a visually impressive board are intermediate results.

## Tutor decisions

| What the student does | What the tutor should do | End the move when… |
|---|---|---|
| Asks for a quick fact or where a definition appears | Answer directly; open the relevant excerpt if it is course-specific. | Student has the answer or an explicit evidence gap. No obligatory quiz. |
| Shows an unexplained mismatch | Inspect the attempt and source. Ask at most one high-value diagnostic question. Identify a possible misconception as a hypothesis. | Their answer or confirmed work distinguishes two plausible causes. |
| Makes an effort but remains stuck | Point at the relevant feature; if needed give one conceptual cue, then show one worked step. For a novice or an explicit request, offer a worked example immediately. | Student has one manageable next action. Stop speaking and wait. |
| Understands the worked step | Fade the support. Change the data or surface representation; ask for a prediction and reasoning before revealing the result. | First unassisted response is recorded, including a skip or error. |
| Makes an error on independent practice | Identify the specific mismatch, offer a hint and allow a retry. Keep first attempt and assisted retry separate. | Student can explain the correction, or chooses to move on. |
| Returns after a gap | Offer one short retrieval question on a prior skill in the course; permit skip. | Record recall before showing the saved explanation. No external notification is needed. |

Avoid a wall of Socratic questions. Frustration, an explicit “just explain it,” or repeated failed attempts calls for more support. Silence alone does not establish confusion. In quiet mode close the live stream; keep the board and a clear Resume action. Present one changing feature at a time, put labels beside their marks, and keep the instructor’s notation visible when comparing. Let learners choose typed or spoken input and suppress motion.

## One episode, with teaching and tool behavior paired

1. **Student:** “My graph goes to 3, but the slide peaks at .03. Did I pick the wrong bins?” The tutor requests both axis labels and bin edges. It does not infer the problem solely from the bar heights.
2. **Tutor:** “Your axis counts observations. The slide labels the axis density. If we keep the scores and edges fixed, which part of the plot should change?” Highlight the two labels. If the slide is inaccessible, ask the student to select its label or give a clearly marked general explanation.
3. **Student:** “The heights?” Now compute the two series from the same data. Explain density as count divided by sample size and bin width. Wait for the board receipt before referring to a specific displayed value.
4. **Tutor:** “This bin contains three of ten scores and is ten units wide. Its density is 0.03. What fraction of scores does the *area* represent?” Highlight one rectangle only. On interruption, follow the new question.
5. **Independent check:** A new bin has 4 of 20 scores and width 5. Ask for its relative frequency and density and why they differ. Expected: 0.20 and 0.04 per score unit. Accept mathematically equivalent forms and correct unit interpretation. Expose the solution after the first response or on request.
6. **Recap:** “You identified a count axis unaided. We worked through density together. Next time: infer probability from bar area.” If they did not attempt the check, say so.

## Implementable lesson record

Track skill ID, goal, available course evidence, selected attempt, last intervention, hint depth (0–3), assisted/unassisted flag, board revision and the next question. Treat these as recommendations for the next tutor turn, not a rigid progression. A later question can return to an earlier move. Record evidence per attempt with timestamp, task variant, answer/rubric result and student corrections. Never infer disability or label the learner from a pause, an accent or a single wrong answer.

Use a numeric checker or deterministic rubric wherever possible. For concept explanations, propose rubric tags with the learner’s exact supporting phrase, permit “unclear” and allow a human reviewer to correct tags. A skipped question is unknown. One success may justify a recap, never a durable “mastered” badge. Reserve a stronger readiness statement for repeated independent evidence on different tasks, including delayed recall.

## Instructions for the tutor prompt and evaluator

Provide developer-owned instructions, then explicitly delimited source excerpts, verified tool facts, the student’s request and current lesson state. Require the tutor to distinguish quoted course material, its own inference, and computed values. Do not let file contents select tools or change the tutoring policy. Provide tools by current state; an unpaired learner cannot be offered external editing. Render citations from validated IDs, never invented page numbers. When course rules supplied by the learner restrict assistance, honor them. Support analogous practice and explanation; keep submission under student control.

Evaluate whether the tutor answered the actual question, used evidence, responded to a misconception, offered the right amount of help, and returned the task to the learner. Each dimension is observable in [the evaluation plan](09-evaluation.md). Design rationale and research limits are in [the evidence notes](11-evidence.md).

## Practice and recap integrity

Use reviewable parameterized variants for each of the three pilot skills. Keep the expected values, grading tolerances and rubric server-side while a question is open. Provide the model with the skill goal, question and observed learner work. The student can ask for the solution at any time; record that the assist occurred before presenting it. A model tool may propose a practice item. Only an authenticated student response, or their confirmation of an uncertain spoken response, can create an attempt. The evaluator derives correctness and assistance from evidence. A duplicate submission returns the original attempt. A numerically right answer with a wrong explanation retains both pieces of evidence. Generate recap claims from the resulting ledger and attach the relevant attempt or cited source.
