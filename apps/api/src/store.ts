import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { Config } from "./config.ts";
import {projectState} from './projector.ts';
import type {IllustrationJob} from './illustration-types.ts';
export const uid = () => randomUUID();
import { DomainError } from "../../../packages/contracts/index.ts";
export { DomainError };
export function fail(code: string, message: string, status = 409): never {
  throw new DomainError(code, message, status);
}
export interface Passage {
  id: string;
  text: string;
  locator: Record<string, any>;
}
export interface Source {
  id: string;
  courseId: string;
  name: string;
  versionId: string;
  revision: number;
  hash: string;
  status: string;
  deleted?: boolean;
  storageKey: string;
  passages: Passage[];
  dataset?: {
    columns: string[];
    rows: Record<string, string>[];
    numericColumns: string[];
  };
  notebook?: any;
  dsa?:import('../../../packages/board/dsa.ts').DsaDataset;
  dsaExample?:boolean;
  skippedPages: number[];
  previous?: Source[];
}
export interface Board {
  id: string;
  label?: string;
  kind: "histogram" | "regression" | "probability" | "vectors" | "dsa";
  algorithm?:import('../../../packages/board/dsa.ts').DsaAlgorithm;
  startNode?:string;
  stepIndex?:number;
  showFrontier?:boolean;
  targetValue?:number;
  vectorA?: [number,number];
  vectorB?: [number,number];
  showProjection?: boolean;
  showAngle?: boolean;
  revision: number;
  sourceId?: string;
  sourceVersionId?: string;
  column?: string;
  xColumn?: string;
  yColumn?: string;
  binCount?: number;
  edges?: number[];
  mode?: string;
  result: any;
  history: Omit<Board, "history">[];
}
export interface Lesson {
  id: string;
  courseId: string;
  goal: string;
  epoch: number;
  /** Undefined means all ready course sources; [] is an explicit empty scope. */
  selectedSourceIds?:string[];
  sourceSelectionRevision?:number;
  sourceSelectionMessageOffset?:number;
  notes?:SavedNote[];
  studio?:import('./studio.ts').StudioArtifact[];
  createdAt?:string;
  updatedAt?:string;
  board?: Board;
  illustrations?: IllustrationJob[];
  messages: any[];
  receipts: Record<string, { payload: string; receipt: any }>;
  practice?: {
    id: string;
    skill: string;
    hintDepth: number;
    solutionSeen: boolean;
    variantId?: string;
    prompt?: string;
  };
  attempts: any[];
  activeSource?: { id: string; versionId: string; passageId: string };
  quiet: boolean;
  deleted?: boolean;
  paintedRevision?: number;
  capture?: { id: string; frameId: string; at: number };
}
export interface NoteCitation{sourceId:string;versionId:string;passageId:string;locator:Record<string,unknown>}
export interface SavedNote{id:string;title:string;content:string;revision:number;citations:NoteCitation[];createdAt:string;updatedAt:string;fromMessageId?:string;creationFingerprint?:string;deleted?:boolean}
export interface State {
  profile?: { adultConfirmedAt: string; retention: { liveTranscript: boolean; audio: false; screen: false } };
  grants?: { id:string; lessonId:string; targetId?:string; scopes:string[]; nonceDigest:string; expiresAt:number; revokedAt?:number }[];
  courses: { id: string; name: string; deleted?: boolean;createdAt?:string;updatedAt?:string }[];
  sources: Source[];
  lessons: Lesson[];
  reservations: Record<
    string,
    {
      seconds: number;
      settled: boolean;
      activeSeconds?: number;
      lessonId?: string;
      meterId?: string;
      lastHeartbeat?: number;
      usage?: unknown[];
      model?: string;
    }
  >;
  remainingSeconds: number;
  developmentAllowances?: Record<string,{seconds:number;createdAt:string}>;
  metering?: import("./meter.ts").MeterState["metering"];
  illustrationDays?: Record<string, number>;
  usedIllustrationIds?: string[];
  /** Opaque Studio request bindings survive course deletion; never store source text here. */
  studioRequests?:Record<string,{lessonId:string;fingerprint:string}>;
  payments: Record<string, any>;
  jobs: any[];
  revokedSessions?: string[];
  purges?: {
    id: string;
    key: string;
    versionId: string;
    status: string;
    attempts: number;
    kind?: "illustration";
  }[];
  deleted?: boolean;
}
export const emptyState = (): State => ({
  courses: [],
  sources: [],
  lessons: [],
  reservations: {},
  remainingSeconds: 4800,
  payments: {},
  jobs: [],
});
export class Store {
  pool?: pg.Pool;
  private lock = Promise.resolve();
  constructor(public config: Config) {
    if (config.mode === "live")
      this.pool = new pg.Pool({
        connectionString: config.databaseUrl,
        max: 8,
        statement_timeout: 15000,
      });
  }
  /** Packet-path guard: read only normalized lesson/course metadata, without
   * loading, locking, creating, serializing, or projecting the learner aggregate.
   * No cache: each query observes the committed epoch at its SELECT snapshot.
   * Actual tool writes must still authorize and compare epochs inside transact().
   */
  async readLessonEpoch(owner: string, lessonId: string): Promise<number> {
    if (this.pool) {
      const client=await this.pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query('SET LOCAL ROLE tutor_api');
        await client.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
        const result=await client.query(`select l.turn_epoch
          from public.lessons l
          join public.courses c on c.owner_id=l.owner_id and c.id=l.course_id
          where l.owner_id=$1 and l.id=$2
            and l.deleted_at is null and c.deleted_at is null`,[owner,lessonId]);
        if(!result.rows.length)fail('unauthorized','This lesson is unavailable.',404);
        const epoch=Number(result.rows[0].turn_epoch);
        if(result.rows[0].turn_epoch===null||!Number.isSafeInteger(epoch)||epoch<0)
          fail('invalid_state','The confirmed lesson state is unavailable.',500);
        await client.query('COMMIT');
        return epoch;
      }catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      }finally{client.release();}
    }
    // Local fixtures have no normalized database. Atomic aggregate replacement
    // gives a committed file snapshot; this fallback never rewrites it or creates
    // an absent account. Fixture voice cannot count as provider performance.
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(owner))
      fail('unauthorized','This lesson is unavailable.',404);
    let state:State;
    try{state=JSON.parse(await readFile(path.resolve(this.config.dataDir,'learners',`${owner}.json`),'utf8'));}
    catch(error:any){if(error.code==='ENOENT')fail('unauthorized','This lesson is unavailable.',404);throw error;}
    if(state.deleted)fail('unauthorized','This account was deleted.',401);
    const epoch=lesson(state,lessonId).epoch;
    if(!Number.isSafeInteger(epoch)||epoch<0)fail('invalid_state','The confirmed lesson state is unavailable.',500);
    return epoch;
  }
  async transact<T>(
    owner: string,
    fn: (state: State, client?: pg.PoolClient) => Promise<T> | T,
  ): Promise<T> {
    if (this.pool) {
      const c = await this.pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE tutor_api");
        await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
          owner,
        ]);
        await c.query(
          "insert into public.learner_state(owner_id,state) values($1,$2) on conflict do nothing",
          [owner, { ...emptyState(), remainingSeconds: 0 }],
        );
        const q = await c.query(
          "select state from public.learner_state where owner_id=$1 for update",
          [owner],
        );
        const s = q.rows[0]?.state as State;
        if (!s) fail("unauthorized", "Your lesson is unavailable.", 403);
        const priorState=JSON.stringify(s);
        const result = await fn(s, c);
        if(JSON.stringify(s)!==priorState){
        await projectState(c,owner,s);
        await c.query(
          "update public.learner_state set state=$2,revision=revision+1,updated_at=now() where owner_id=$1",
          [owner, s],
        );
        }
        await c.query("COMMIT");
        return structuredClone(result);
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    }
    let release!: () => void;
    const before = this.lock;
    this.lock = new Promise((r) => (release = r));
    await before;
    try {
      const dir = path.resolve(this.config.dataDir, "learners");
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${owner}.json`);
      let s: State;
      try {
        s = JSON.parse(await readFile(file, "utf8"));
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
        s = emptyState();
      }
      const result = await fn(s);
      await writeFile(file + ".tmp", JSON.stringify(s));
      await rename(file + ".tmp", file);
      return structuredClone(result);
    } finally {
      release();
    }
  }
  async owners() {
    if (this.pool)
      return (
        await this.pool.query("select owner_id from public.learner_state")
      ).rows.map((r) => r.owner_id as string);
    const { readdir } = await import("node:fs/promises");
    try {
      return (await readdir(path.resolve(this.config.dataDir, "learners")))
        .filter((x) => x.endsWith(".json"))
        .map((x) => x.slice(0, -5));
    } catch {
      return [];
    }
  }
  async close() {
    await this.pool?.end();
  }
}
export function course(s: State, id: string) {
  return (
    s.courses.find((x) => x.id === id && !x.deleted) ??
    fail("unauthorized", "This course is unavailable.", 404)
  );
}
export function lesson(s: State, id: string) {
  const l =
    s.lessons.find((x) => x.id === id && !x.deleted) ??
    fail("unauthorized", "This lesson is unavailable.", 404);
  course(s, l.courseId);
  return l;
}
export function source(s: State, id: string) {
  const x =
    s.sources.find((x) => x.id === id && !x.deleted) ??
    fail("source_removed", "Source removed or unavailable.", 404);
  course(s, x.courseId);
  return x;
}
/** One source-scope boundary shared by retrieval, text, voice and Studio.
 * Keep the last ready version available while a replacement is indexing.
 * An explicit empty selection never falls back to all course materials. */
export function readyLessonSources(s:State,l:Lesson):Source[]{
  course(s,l.courseId);
  return s.sources.filter(head=>!head.deleted&&head.courseId===l.courseId&&(l.selectedSourceIds===undefined||l.selectedSourceIds.includes(head.id)))
    .map(head=>head.status.startsWith('ready')?head:(head.previous??[]).find(version=>version.status.startsWith('ready')))
    .filter((version):version is Source=>Boolean(version));
}
export function lessonContextMessages(l:Lesson){return l.messages.slice(l.sourceSelectionMessageOffset??0);}
/** Keep the saved board intact while excluding deselected source-derived data
 * from future model contexts. Its identity still permits a typed replacement. */
export function lessonContextBoard(s:State,l:Lesson):any{
  const b=l.board;if(!b)return undefined;
  if(!b.sourceId||readyLessonSources(s,l).some(src=>src.id===b.sourceId&&[src,...(src.previous??[])].some(v=>v.versionId===b.sourceVersionId)))return b;
  return{id:b.id,kind:b.kind,revision:b.revision,sourceId:b.sourceId,sourceVersionId:b.sourceVersionId,detailsOmitted:true,sourceNotSelected:true};
}
export function publicSnapshot(s: State, l: Lesson) {
  return {
    ...l,
    sources: s.sources
      .filter((x) => x.courseId === l.courseId && !x.deleted)
      .map(({ storageKey, previous, ...x }) => x),
    course: course(s, l.courseId),
    remainingSeconds: s.remainingSeconds,
    recap: l.attempts.length
      ? l.attempts.map((a) => ({
          attemptId: a.id,
          skill: a.skill,
          independent: a.independent,
          result: a.result,
        }))
      : [],
    receipts: undefined,
  };
}
