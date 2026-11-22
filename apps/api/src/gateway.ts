import { practiceBank, getPracticeItem, gradePractice } from "./practice.ts";
import Ajv from "ajv";
import {
  actionSchema,
  type Action,
} from "../../../packages/contracts/index.ts";
import {
  histogram,
  regression,
  probability,
  numericColumn,
  vectorAnalysis,
  dsaAnalysis,
} from "../../../packages/board/index.ts";
import {
  fail,
  source,
  lesson,
  readyLessonSources,
  uid,
  type State,
  type Board,
  type Lesson,
  type Source,
} from "./store.ts";
const ajv = new Ajv({
  allErrors: true,
  removeAdditional: false,
  strict: false,
});
const valid = ajv.compile(actionSchema);
export function canonical(v: any): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.keys(val)
            .sort()
            .map((k) => [k, val[k]]),
        )
      : val,
  );
}
export function recompute(s: State, b: Board) {
  if(b.kind==='dsa'){
    const head=source(s,b.sourceId!);
    const version=[head,...(head.previous??[])].find(v=>v.versionId===b.sourceVersionId);
    if(!version?.dsa||!['ready','ready_with_skipped_pages'].includes(version.status))fail('target_changed','The structured dataset version is unavailable.');
    b.result=dsaAnalysis(version.dsa,{algorithm:b.algorithm,startNode:b.startNode,stepIndex:b.stepIndex,showFrontier:b.showFrontier,targetValue:b.targetValue});b.result.origin=version.dsaExample?'Imported mock teaching dataset':'Uploaded structured dataset';return;
  }
  if(b.kind==="vectors"){
    if(b.sourceId){const head=source(s,b.sourceId);if(![head,...(head.previous??[])].some(version=>version.versionId===b.sourceVersionId))fail("target_changed","The vector source version is unavailable.");}
    b.result=vectorAnalysis(b.vectorA,b.vectorB);return;
  }
  if (b.kind === "probability") {
    let cells = [3, 9, 6, 2],
      rowLabels = ["Evening", "Day"],
      columnLabels = ["Train", "Other"];
    if (b.sourceId) {
      const head = source(s, b.sourceId);
      const src = [head, ...(head.previous ?? [])].find(
        (x) => x.versionId === b.sourceVersionId,
      );
      if (!src?.dataset || src.dataset.rows.length !== 2)
        fail(
          "invalid_params",
          "Choose a two-row CSV with two numeric count columns.",
          400,
        );
      const x = b.xColumn || src.dataset.numericColumns[0],
        y = b.yColumn || src.dataset.numericColumns[1];
      if (!x || !y || x === y)
        fail("invalid_params", "Choose two different count columns.", 400);
      cells = [
        ...numericColumn(src.dataset.rows, x),
        ...numericColumn(src.dataset.rows, y),
      ];
      cells = [cells[0], cells[2], cells[1], cells[3]];
      columnLabels = [x, y];
      const group = src.dataset.columns.find(
        (c) => !src.dataset!.numericColumns.includes(c),
      );
      rowLabels = group
        ? src.dataset.rows.map((r) => r[group])
        : ["Group 1", "Group 2"];
    }
    b.result = {
      ...probability(cells, b.result.conditioning),
      rowLabels,
      columnLabels,
      origin: b.sourceId ? "Uploaded dataset" : "Reviewed example",
    };
    return;
  }
  const head = source(s, b.sourceId!);
  const src =
    [head, ...(head.previous ?? [])].find(
      (x) => x.versionId === b.sourceVersionId,
    ) ?? fail("target_changed", "The dataset version is unavailable.");
  if (!src.dataset) fail("invalid_params", "Choose a numeric dataset.", 400);
  if (b.kind === "histogram")
    b.result = histogram(numericColumn(src.dataset.rows, b.column!), {
      edges: b.edges,
      binCount: b.binCount,
      mode: b.mode,
    } as any);
  else
    b.result = regression(
      numericColumn(src.dataset.rows, b.xColumn!),
      numericColumn(src.dataset.rows, b.yColumn!),
    );
}
export const practiceQuestions: Record<
  string,
  { prompt: string; solution: string }
> = {
  histogram: {
    prompt:
      "A new bin contains 4 of 20 scores and is 5 score units wide. What are its relative frequency and density? Explain how bar area represents probability.",
    solution:
      "Relative frequency = 4/20 = 0.20. Density = 4/(20 × 5) = 0.04 per score unit. Area = density × width = probability.",
  },
  probability: {
    prompt:
      "Of 12 evening students, 3 commute by train. What is P(train | evening)? State the conditioning group.",
    solution: "3/12 = 0.25. The conditioning group is the 12 evening students.",
  },
  regression: {
    prompt:
      "A fitted line predicts y = 5 + 2x. How much does predicted y change when x increases by 3 units? Explain the slope.",
    solution:
      "Predicted y increases by 6 y units. The slope is 2 y units per x unit.",
  },
};
function grade(skill: string, answer: string) {
  const text = answer.toLowerCase();
  const numbers = (text.match(/\d+\/\d+|\d*\.\d+|\d+%?/g) ?? []).map((x) =>
    x.trim().endsWith("%")
      ? parseFloat(x) / 100
      : x.includes("/")
        ? Number(x.split("/")[0]) / Number(x.split("/")[1])
        : Number(x),
  );
  const has = (n: number) => numbers.some((x) => Math.abs(x - n) < 1e-7);
  if (skill === "histogram")
    return {
      numeric: has(0.2) && has(0.04),
      reasoning: /area/.test(text) && /probab|relative frequency/.test(text),
      units: /per|score unit/.test(text) ? "supported" : "unclear",
    };
  if (skill === "probability")
    return {
      numeric: has(0.25),
      reasoning: /evening/.test(text),
      units: "not_required",
    };
  return {
    numeric: has(6),
    reasoning: /slope|per|increase/.test(text),
    units: "unclear",
  };
}
export function perform(
  s: State,
  action: Action,
  actor: "student" | "model" = "student",
) {
  if (!valid(action))
    fail("invalid_params", "This action is not supported.", 400);
  const l = lesson(s, action.sessionId);
  const payload = canonical(action),
    prior = l.receipts[action.actionId];
  if (prior) {
    if (prior.payload !== payload)
      fail(
        "payload_conflict",
        "That action ID already identifies a different change.",
      );
    return prior.receipt;
  }
  if (action.turnEpoch !== l.epoch)
    fail("stale_turn", "This change belongs to an interrupted turn.");
  const a = action.args;
  if(actor==='model'){
    const targetSource=action.type==='source.open'||action.type==='board.create'||action.type==='board.replace'?a.sourceId:
      action.type==='board.patch'?l.board?.sourceId:action.type==='board.undo'?l.board?.history.at(-1)?.sourceId:undefined;
    if(targetSource!==undefined&&!readyLessonSources(s,l).some(src=>src.id===targetSource))fail('source_not_selected','Choose a source selected for this lesson before using it.',403);
  }
  let result: any;
  const allowed: Record<string, string[]> = {
    "board.create": [
      "kind",
      "sourceId",
      "column",
      "xColumn",
      "yColumn",
      "binCount",
      "edges",
      "mode",
      "cells",
      "conditioning",
      "label",
      "vectorA","vectorB","showProjection","showAngle",
      "algorithm","startNode","stepIndex","showFrontier","targetValue",
    ],
    "board.patch": ["binCount", "edges", "mode", "label", "conditioning", "vectorA","vectorB","showProjection","showAngle","algorithm","startNode","stepIndex","showFrontier","targetValue"],
    "board.undo": [],
    "practice.present": ["skill"],
    "practice.record": ["answer", "skip"],
    "source.open": ["sourceId", "versionId", "passageId"],
    "course.search": ["query"],
    "screen.point": ["captureId", "frameId", "x", "y"],
  };
  allowed['board.replace']=allowed['board.create'];
  if (
    allowed[action.type] &&
    Object.keys(a).some((k) => !allowed[action.type].includes(k))
  )
    fail("invalid_params", "Unexpected action parameter.", 400);
  if (action.type.startsWith("board.")) {
    if (action.type === "board.create" || action.type==='board.replace') {
      const replacing=action.type==='board.replace',old=l.board;
      if(replacing&&(!old||old.id!==action.targetId))fail('target_changed','Select the current visual to replace.');
      if(replacing&&old!.revision!==action.expectedRevision)fail('stale_revision','Your visual changed. Replace it from the current revision.');
      if (!replacing&&l.board)
        fail(
          "target_changed",
          "A board already exists. Change the selected chart.",
        );
      const kind = String(a.kind ?? "histogram");
      if (!["histogram", "regression", "probability", "vectors", "dsa"].includes(kind))
        fail("unsupported", "Choose a supported chart.");
      const vectorResult=kind==="vectors"?vectorAnalysis(a.vectorA,a.vectorB):null;
      if(kind==="vectors"&&Object.keys(a).some(key=>!["kind","label","sourceId","vectorA","vectorB","showProjection","showAngle"].includes(key)))fail("invalid_params","A vector diagram uses coordinate pairs, not CSV chart settings.",400);
      if(kind!=="vectors"&&["vectorA","vectorB","showProjection","showAngle"].some(key=>a[key]!==undefined))fail("invalid_params","Vector coordinates require a vector diagram.",400);
      if(kind==='dsa'&&Object.keys(a).some(key=>!['kind','sourceId','algorithm','startNode','stepIndex','showFrontier','targetValue','label'].includes(key)))fail('invalid_params','A data structure visual uses its imported nodes and traversal settings.',400);
      if(kind!=='dsa'&&['algorithm','startNode','stepIndex','showFrontier','targetValue'].some(key=>a[key]!==undefined))fail('invalid_params','Traversal settings require a data structure visual.',400);
      const src =
        (kind === "probability" || kind === "vectors") && !a.sourceId
          ? undefined
          : source(s, String(a.sourceId));
      if (
        kind === "probability" &&
        !src &&
        a.cells &&
        JSON.stringify(a.cells) !== "[3,9,6,2]"
      )
        fail(
          "invalid_params",
          "Probability counts must come from a dataset or the reviewed example.",
          400,
        );
      if (src && src.courseId !== l.courseId)
        fail("unauthorized", "Use a dataset from this course.", 403);
      const candidate:Board = {
        id: action.targetId,
        label: typeof a.label === "string" ? a.label : undefined,
        kind: kind as any,
        revision: replacing?old!.revision:0,
        sourceId: src?.id,
        sourceVersionId: src?.versionId,
        ...(vectorResult?{vectorA:vectorResult.vectorA,vectorB:vectorResult.vectorB,showProjection:a.showProjection!==false,showAngle:a.showAngle!==false}:{}),
        ...(kind==='dsa'?{algorithm:a.algorithm as Board['algorithm'],startNode:a.startNode as string|undefined,stepIndex:Number(a.stepIndex??0),showFrontier:a.showFrontier!==false,targetValue:a.targetValue as number|undefined}:{}),
        column: String(a.column ?? ""),
        xColumn: String(a.xColumn ?? ""),
        yColumn: String(a.yColumn ?? ""),
        binCount: Number(a.binCount ?? 4),
        edges: a.edges as number[] | undefined,
        mode: String(a.mode ?? "count"),
        result: vectorResult ?? {
          cells: a.cells ?? [3, 9, 6, 2],
          conditioning: a.conditioning ?? "row0",
        },
        history: replacing?[...old!.history,((({history,...before})=>before)(structuredClone(old!)))]:[],
      };
      recompute(s,candidate);
      l.board=candidate;
    }
    const b = l.board;
    if (!b || b.id !== action.targetId)
      fail("target_changed", "Select the current chart.");
    if (b.revision !== action.expectedRevision)
      fail(
        "stale_revision",
        "Your chart changed. Try again from the current version.",
      );
    if(action.type==="board.patch"){
      if(b.kind==="vectors"){
        if(Object.keys(a).some(key=>!["label","vectorA","vectorB","showProjection","showAngle"].includes(key)))fail("invalid_params","Change the vector coordinates or display options.",400);
        vectorAnalysis(a.vectorA??b.vectorA,a.vectorB??b.vectorB);
      }else if(["vectorA","vectorB","showProjection","showAngle"].some(key=>a[key]!==undefined))fail("invalid_params","Vector coordinates require a vector diagram.",400);
      if(b.kind==='dsa'){
        if(Object.keys(a).some(key=>!['algorithm','startNode','stepIndex','showFrontier','targetValue','label'].includes(key)))fail('invalid_params','Change the traversal or current step without changing its source.',400);
        const next={...b,...a,stepIndex:a.stepIndex??(['algorithm','startNode','targetValue'].some(key=>a[key]!==undefined)?0:b.stepIndex)} as Board;
        if(a.algorithm!==undefined&&['inorder','preorder','postorder','search'].includes(String(a.algorithm))&&a.startNode===undefined)next.startNode=undefined;
        recompute(s,next);
      }else if(['algorithm','startNode','stepIndex','showFrontier','targetValue'].some(key=>a[key]!==undefined))fail('invalid_params','Traversal settings require a data structure visual.',400);
    }
    if (action.type === "board.undo") {
      const prior = b.history.pop();
      if (!prior) fail("target_changed", "There is no board change to undo.");
      const revision = b.revision + 1;
      for(const key of Object.keys(b))if(key!=='history')delete (b as any)[key];
      Object.assign(b, prior, { revision });
    } else {
      if (
        a.binCount !== undefined &&
        (!Number.isInteger(a.binCount) ||
          Number(a.binCount) < 1 ||
          Number(a.binCount) > 50)
      )
        fail("invalid_params", "Use between 1 and 50 bins.", 400);
      if (
        a.mode !== undefined &&
        !["count", "density"].includes(String(a.mode))
      )
        fail("invalid_params", "Choose count or density.", 400);
      if (action.type === "board.patch") {
        const { history, ...before } = structuredClone(b);
        b.history.push(before);
        if(b.kind==='dsa'){
          if(['algorithm','startNode','targetValue'].some(key=>a[key]!==undefined))b.stepIndex=0;
          if(a.algorithm!==undefined){b.algorithm=a.algorithm as Board['algorithm'];if(['inorder','preorder','postorder','search'].includes(String(a.algorithm)))b.startNode=undefined;}
          if(a.startNode!==undefined)b.startNode=a.startNode as string;
          if(a.targetValue!==undefined)b.targetValue=a.targetValue as number;
          if(a.stepIndex!==undefined)b.stepIndex=a.stepIndex as number;
          if(a.showFrontier!==undefined)b.showFrontier=a.showFrontier as boolean;
        }
        if(a.vectorA!==undefined)b.vectorA=a.vectorA as [number,number];
        if(a.vectorB!==undefined)b.vectorB=a.vectorB as [number,number];
        if(a.showProjection!==undefined)b.showProjection=a.showProjection as boolean;
        if(a.showAngle!==undefined)b.showAngle=a.showAngle as boolean;
        if (a.label !== undefined) {
          if (typeof a.label !== "string" || a.label.length > 120)
            fail("invalid_params", "Use a chart title of at most 120 characters.", 400);
          b.label = a.label;
        }
        if (a.binCount !== undefined) {
          b.binCount = Number(a.binCount);
          b.edges = undefined;
        }
        if (a.edges !== undefined) b.edges = a.edges as number[];
        if (a.mode !== undefined) b.mode = String(a.mode);
        if (a.conditioning !== undefined) {
          if (
            !["row0", "row1", "column0", "column1"].includes(
              String(a.conditioning),
            )
          )
            fail("invalid_params", "Choose a labeled conditioning group.", 400);
          b.result.conditioning = String(a.conditioning);
        }
      }
      recompute(s, b);
      b.revision++;
    }
    result = {
      status: "saved",
      objectId: b.id,
      revision: b.revision,
      board: b,
    };
  } else if (action.type === "source.open") {
    const head = source(s, String(a.sourceId));
    const src = [head, ...(head.previous ?? [])].find(
      (x) => x.versionId === a.versionId,
    );
    if (!src || src.courseId !== l.courseId)
      fail("target_changed", "This source version is unavailable.");
    const p = src.passages.find((p) => p.id === a.passageId);
    if (!p) fail("insufficient_evidence", "This citation is unavailable.");
    l.activeSource = { id: src.id, versionId: src.versionId, passageId: p.id };
    result = {
      status: "opened",
      sourceId: src.id,
      versionId: src.versionId,
      passage: p,
    };
  } else if (action.type === "course.search") {
    result = { passages: search(s, l, String(a.query ?? "")) };
  } else if (action.type === "practice.present") {
    const skill = String(a.skill ?? "histogram");
    if (!practiceQuestions[skill])
      fail(
        "unsupported",
        "Choose histogram, probability or regression practice.",
      );
    const item =
      practiceBank[skill][
        l.attempts.filter((a) => a.skill === skill).length %
          practiceBank[skill].length
      ];
    l.practice = {
      id: uid(),
      skill,
      hintDepth: 0,
      solutionSeen: false,
      variantId: item.id,
      prompt: item.prompt,
    };
    result = { ...l.practice };
  } else if (action.type === "practice.record") {
    if (actor !== "student")
      fail("unauthorized", "Only the learner can record their answer.", 403);
    if (!l.practice || action.targetId !== l.practice.id)
      fail("target_changed", "Choose the current practice question.");
    if (typeof a.answer !== "string" || a.answer.length > 4000)
      fail("invalid_params", "Enter a short answer.", 400);
    const attempt = {
      id: uid(),
      practiceId: l.practice.id,
      variantId:l.practice.variantId,rubricVersion:"pilot-v1",
      skill: l.practice.skill,
      answer: a.answer,
      skipped: a.skip === true,
      at: new Date().toISOString(),
      independent: !l.practice.solutionSeen && l.practice.hintDepth === 0,
      result: a.skip
        ? { status: "skipped" }
        : gradePractice(l.practice, a.answer),
      hintDepth: l.practice.hintDepth,
    };
    l.attempts.push(attempt);
    l.practice.solutionSeen = true;
    result = { ...attempt, solution: getPracticeItem(l.practice).solution };
  } else if (action.type === "screen.point") {
    if (
      !l.capture ||
      l.capture.id !== a.captureId ||
      l.capture.frameId !== a.frameId ||
      Date.now() - l.capture.at > 3000
    )
      fail("target_changed", "Choose a fresh shared frame.");
    if (
      ![a.x, a.y].every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
      )
    )
      fail("invalid_params", "Select a point inside the preview.", 400);
    result = { status: "pointed", ...a };
  } else fail("unsupported", "This action requires a paired notebook.");
  const receipt = { actionId: action.actionId, ...result };
  l.receipts[action.actionId] = { payload, receipt };
  return receipt;
}
export function search(s: State, l: Lesson, query: string) {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return readyLessonSources(s,l)
    .flatMap((src) =>
      src.passages.map((p) => ({
        sourceId: src.id,
        versionId: src.versionId,
        filename: src.name,
        passageId: p.id,
        locator: p.locator,
        text: p.text,
        score: terms.reduce(
          (n, t) => n + (p.text.toLowerCase().includes(t) ? 1 : 0),
          0,
        ),
      })),
    )
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}
