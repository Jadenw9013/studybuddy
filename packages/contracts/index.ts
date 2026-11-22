import Ajv from "ajv";
export const actionTypes = [
  "board.create",
  "board.replace",
  "board.patch",
  "board.undo",
  "source.open",
  "course.search",
  "practice.present",
  "practice.record",
  "screen.point",
  "notebook.focus",
  "notebook.highlight",
  "notebook.propose",
  "notebook.undo",
  "illustration.generate",
] as const;
export type ActionType = (typeof actionTypes)[number];
export type Action = {
  actionId: string;
  sessionId: string;
  turnEpoch: number;
  type: ActionType;
  targetId: string;
  expectedRevision: number;
  args: Record<string, unknown>;
};
const id = { type: "string", minLength: 1, maxLength: 128 };
export const actionSchema = {
  $id: "tutor.action.v1",
  type: "object",
  additionalProperties: false,
  required: [
    "actionId",
    "sessionId",
    "turnEpoch",
    "type",
    "targetId",
    "expectedRevision",
    "args",
  ],
  properties: {
    actionId: id,
    sessionId: id,
    turnEpoch: { type: "integer", minimum: 0 },
    type: { enum: actionTypes },
    targetId: id,
    expectedRevision: { type: "integer", minimum: 0 },
    args: { type: "object", maxProperties: 12 },
  },
  allOf: [
    {if:{properties:{type:{const:'board.replace'}}},then:{properties:{args:{type:'object',required:['kind']}}}},
    {
      if: { properties: { type: { const: "illustration.generate" } } },
      then: { properties: { args: {
        type: "object", additionalProperties: false, required: ["prompt", "purpose", "title"],
        properties: {
          prompt: { type: "string", minLength: 8, maxLength: 1200 },
          purpose: { type: "string", minLength: 5, maxLength: 300 },
          title: { type: "string", minLength: 1, maxLength: 80 },
        },
      } } },
    },
    {
      if: { properties: { type: { enum: ["board.create", "board.replace", "board.patch"] } } },
      then: {
        properties: {
          args: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { enum: ["histogram", "regression", "probability", "vectors", "dsa"] },
              algorithm:{enum:['bfs','dfs','inorder','preorder','postorder','search']},
              startNode:{type:'string',pattern:'^[A-Za-z0-9_-]{1,40}$'},
              stepIndex:{type:'integer',minimum:0,maximum:128},
              showFrontier:{type:'boolean'},
              targetValue:{type:'number',minimum:-1000000,maximum:1000000},
              vectorA: {type:"array",minItems:2,maxItems:2,items:{type:"number",minimum:-1000000,maximum:1000000}},
              vectorB: {type:"array",minItems:2,maxItems:2,items:{type:"number",minimum:-1000000,maximum:1000000}},
              showProjection: {type:"boolean"},
              showAngle: {type:"boolean"},
              sourceId: id,
              column: id,
              xColumn: id,
              yColumn: id,
              binCount: { type: "integer", minimum: 1, maximum: 50 },
              edges: {
                type: "array",
                minItems: 2,
                maxItems: 51,
                items: { type: "number" },
              },
              mode: { enum: ["count", "density"] },
              label: { type: "string", maxLength: 120 },
              cells: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: { type: "number", minimum: 0 },
              },
              conditioning: { enum: ["row0", "row1", "column0", "column1"] },
            },
          },
        },
      },
    },
    {
      if:{properties:{type:{enum:["board.create","board.replace"]},args:{type:"object",properties:{kind:{const:"vectors"}},required:["kind"]}}},
      then:{properties:{args:{type:"object",required:["vectorA","vectorB"]}}},
    },
    {
      if:{properties:{type:{enum:['board.create','board.replace']},args:{type:'object',properties:{kind:{const:'dsa'}},required:['kind']}}},
      then:{properties:{args:{type:'object',required:['sourceId','algorithm']}}},
    },
  ],
};
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  removeAdditional: false,
  coerceTypes: false,
});
const validate = ajv.compile(actionSchema);
export function parseAction(value: unknown): Action {
  if (!validate(value))
    throw new DomainError(
      "invalid_params",
      "This action has invalid fields.",
      400,
    );
  return value as Action;
}
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export type Locator = {
  pageIndex?: number;
  physicalPage?: number;
  cellId?: string;
  rowStart?: number;
  rowEnd?: number;
  column?: string;
};
export type Passage = { id: string; text: string; locator: Locator };
export type Source = {
  id: string;
  courseId: string;
  versionId: string;
  name: string;
  hash: string;
  path: string;
  status: string;
  passages: Passage[];
  dataset?: {
    columns: string[];
    rows: Record<string, string>[];
    numericColumns: string[];
  };
  notebook?: unknown;
  deleted?: boolean;
  skippedPages?: number[];
};
export type Board = {
  id: string;
  revision: number;
  kind: "histogram" | "regression" | "probability" | "vectors" | "dsa";
  algorithm?:import('../board/dsa.ts').DsaAlgorithm;
  startNode?:string;
  stepIndex?:number;
  showFrontier?:boolean;
  targetValue?:number;
  vectorA?: [number,number];
  vectorB?: [number,number];
  showProjection?: boolean;
  showAngle?: boolean;
  datasetId?: string;
  column?: string;
  xColumn?: string;
  yColumn?: string;
  binCount?: number;
  edges?: number[];
  mode?: "count" | "density";
  label: string;
  result: any;
  cells?: number[];
  conditioning?: string;
  provenance: string[];
};
export type Lesson = {
  id: string;
  courseId: string;
  goal: string;
  epoch: number;
  board: Board | null;
  boardHistory: Board[];
  messages: any[];
  attempts: any[];
  practice: any;
  hintDepth: number;
  quiet: boolean;
  activeSource?: { sourceId: string; versionId: string; passageId: string };
  receipts: Record<string, { payload: string; receipt: any }>;
  createdAt: string;
  updatedAt: string;
};
