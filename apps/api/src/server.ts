import { tutorTools } from "./tools.ts";
import {
  parseRateTable,
  parseUnitLimits,
  pricingReady,
  reserveLive,
  settleLive,
  reconcileStale,
  heartbeatReservation,
  reserveTextTurn,
  settleTextTurn,
  addUsage,
} from "./meter.ts";
import { createMetricsWriter } from "./metrics.ts";
import {
  retrieve,
  indexPassages,
  invalidateSource,
  invalidateCourse,
} from "../../../packages/tutor/retrieval.ts";
import { queryEmbedding } from "./embedding.ts";
import { getPracticeItem } from "./practice.ts";
import { registerPayments } from "./payments.ts";
import { registerIllustrations } from "./illustrations.ts";
import {registerSourceNotes} from './source-notes.ts';
import {purgeStudioArtifacts,registerStudio} from './studio.ts';
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { createClient } from "@supabase/supabase-js";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.ts";
import {
  Store,
  uid,
  fail,
  DomainError,
  course,
  source,
  lesson,
  readyLessonSources,
  lessonContextMessages,
  lessonContextBoard,
  type State,
  type Lesson,
  type Source,
} from "./store.ts";
import { perform, search, practiceQuestions } from "./gateway.ts";
import { reply as tutorReply, validateVisualProposal } from "../../../packages/tutor/index.ts";
import { voiceLessonContext } from "./voice-context.ts";
import {actionSchema,type Action} from "../../../packages/contracts/index.ts";
import { registerVoice } from "./voice.ts";
import { registerCompanion } from "./companion.ts";
export async function buildServer(config: Config, options: {illustrationProvider?: typeof import("./bfl.ts").generateIllustration} = {}) {
  const meterPolicy = {
    enabled: config.paid,
    rates: parseRateTable(process.env.MODEL_UNIT_PRICES_JSON),
    limits: parseUnitLimits(process.env.MODEL_UNIT_LIMITS_JSON),
    ceilingUsd: Number(process.env.SPEND_CEILING_USD ?? 7.6),
    dailyTextLimit: Number(process.env.TEXT_DAILY_LIMIT ?? 50),
  };
  const recordMetric = createMetricsWriter(
    path.resolve(config.dataDir, "live-metrics.jsonl"),
  );
  const app = Fastify({
    logger: false,
    bodyLimit: 26_000_000,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const store = new Store(config);
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 25_000_000, files: 3, fields: 5 },
  });
  const supabase =
    config.mode === "live"
      ? createClient(
          config.supabaseUrl!,
          config.supabaseKey!,
          { auth: { persistSession: false } },
        )
      : undefined;
  const storage =
    config.mode === "live"
      ? createClient(
          config.supabaseUrl!,
          config.serviceKey!,
          { auth: { persistSession: false } },
        )
      : undefined;
  let companionController: any;
  let revokeGrants = (owner: string, lessonId: string) => {};
  const queuePurge = (s: State, items: Source[]) => {
    s.purges ??= [];
    for (const src of items)
      for (const version of [src, ...(src.previous ?? [])])
        if (!s.purges.some((p) => p.versionId === version.versionId))
          s.purges.push({
            id: uid(),
            key: version.storageKey,
            versionId: version.versionId,
            status: "pending",
            attempts: 0,
          });
  };
  const drainPurge = async (owner: string) => {
    const tasks = await store.transact(owner, (s) =>
      (s.purges ?? [])
        .filter((p) => p.status !== "complete" && p.attempts < 3)
        .slice(0, 20),
    );
    for (const p of tasks) {
      let ok = true;
      try {
        if (storage) {
          const r = await storage.storage
            .from("course-originals")
            .remove([p.key]);
          if (r.error) ok = false;
        } else if (p.kind === "illustration")
          await unlink(path.resolve(config.dataDir, "illustrations", owner, p.versionId)).catch(e=>{if(e.code!=="ENOENT")throw e;});
        else
          await unlink(
            path.resolve(config.dataDir, "originals", p.versionId),
          ).catch((e) => {
            if (e.code !== "ENOENT") throw e;
          });
      } catch {
        ok = false;
      }
      await store.transact(owner, (s) => {
        const task = s.purges?.find((t) => t.id === p.id);
        if (task) {
          task.attempts++;
          task.status = ok ? "complete" : "pending";
        }
      });
    }
    return store.transact(owner, (s) =>
      (s.purges ?? []).every((p) => p.status === "complete"),
    );
  };
  const secret = config.ticketSecret;
  const signing = (s: string) =>
    createHmac("sha256", secret).update(s).digest("base64url");
  const revokedOwners = new Set<string>();
  const tokenDigest = (token: string) =>
    createHash("sha256").update(token).digest("hex");
  const sessions = new Map<
    string,
    { owner: string; email: string; expires: number }
  >();
  const attempts = new Map<string, { n: number; at: number }>();
  const auth = async (req: any) => {
    if (config.devAuthBypass) {
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip))
        fail("unauthorized", "Local testing is only available on this computer.", 403);
      return {owner:config.devAuthUserId ?? hashUUID("live-tutor-local-test-workspace"),email:"Local test workspace"};
    }
    const token = req.cookies.tutor_session;
    if (!token) fail("unauthorized", "Sign in to open your private work.", 401);
    if (config.mode === "fixture") {
      const entry = sessions.get(token);
      if (!entry || entry.expires < Date.now())
        fail("unauthorized", "Sign in again to continue.", 401);
      await store.transact(entry.owner, (s) => {
        if (s.deleted || s.revokedSessions?.includes(tokenDigest(token)))
          fail("unauthorized", "Sign in again to continue.", 401);
      });
      return entry;
    }
    const result = await supabase!.auth.getUser(token);
    if (result.error || !result.data.user)
      fail("unauthorized", "Your session expired. Sign in again.", 401);
    await store.transact(result.data.user.id, (s) => {
      if (s.deleted || s.revokedSessions?.includes(tokenDigest(token)))
        fail("unauthorized", "This session was revoked.", 401);
    });
    return { owner: result.data.user.id, email: result.data.user.email ?? "" };
  };
  const searchCourse = async (
    s: State,
    owner: string,
    l: Lesson,
    query: string,
    client?: import("pg").PoolClient,
    embedding?: number[],
  ) => {
    if (!client) return search(s, l, query);
    const allowed = readyLessonSources(s,l);
    const found = await retrieve(
      client,
      owner,
      l.courseId,
      allowed.map((x) => x.versionId),
      query,
      embedding,
    );
    return found
      .filter((p) =>
        allowed.some(
          (x) =>
            x.id === p.sourceId &&
            x.versionId === p.versionId &&
            x.passages.some((v) => v.id === p.passageId),
        ),
      )
      .map((p) => ({
        ...p,
        filename: allowed.find((x) => x.id === p.sourceId)!.name,
      }));
  };
  const authorize = async (req: any, id: string) => {
    const actor = await auth(req);
    await store.transact(actor.owner, (s) => {
      if (s.deleted) fail("unauthorized", "This account was deleted.", 401);
      lesson(s, id);
    });
    return { userId: actor.owner };
  };
  const illustrations = await registerIllustrations(app,{config,store,storage,auth,provider:options.illustrationProvider});
  const studio = await registerStudio(app,{config,store,auth,meterPolicy});
  const secureCookie = (r: any, name: string, value: string, maxAge = 3600) =>
    r.setCookie(name, value, {
      httpOnly: true,
      sameSite: "strict",
      secure: new URL(config.origin).protocol === "https:",
      path: "/",
      maxAge,
    });
  app.addHook("onRequest", async (req, rep) => {
    rep.header("Cache-Control", "private, no-store");
    rep.header("X-Content-Type-Options", "nosniff");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.url.startsWith("/internal/") &&
      req.url !== "/api/payments/webhook" &&
      req.headers.origin !== config.origin
    )
      fail("origin_denied", "Open this action in the study workspace.", 403);
  });
  app.setErrorHandler((e: any, _req, rep) => {
    const known = e instanceof DomainError || e.status;
    rep.code(e.validation ? 400 : (e.status ?? e.statusCode ?? 500)).send({
      code: e.validation ? "invalid_params" : (e.code ?? "service_error"),
      message: e.validation
        ? "Check the requested action."
        : known
          ? e.message
          : "The service could not finish. Your confirmed work is saved.",
    });
  });
  app.get("/api/health", async () => ({
    mode: config.mode,
    api: "ready",
    database: store.pool ? "configured_unverified" : "local_fixture",
    text:
      config.paid && process.env.GEMINI_API_KEY
        ? "configured_unverified"
        : "unavailable",
    voice:
      config.live && config.paid && process.env.GEMINI_API_KEY
        ? "configured_unverified"
        : "unavailable",
    worker: "separate_process",
    illustrations: illustrations.available() ? "configured_unverified" : "unavailable",
  }));
  app.get("/api/config", async () => ({
    mode: config.mode,
    authentication: config.devAuthBypass ? "local_test" : "required",
    supabaseUrl: config.supabaseUrl ?? "",
    publishableKey: config.supabaseKey ?? "",
    apiOrigin: config.apiOrigin,
    providerReadiness: config.providerReadiness,
    textAvailable: config.providerReadiness.text.configured,
    liveAvailable:
      config.mode === "live" &&
      config.live &&
      config.paid &&
      Boolean(config.geminiKey) &&
      pricingReady(meterPolicy, config.liveModel, "live").allowed,
    companion: config.companion,
    illustrationsAvailable: illustrations.available(),
    illustrationEstimateUsd: illustrations.estimateUsd(),
  }));
  app.post<{ Body: { email: string } }>(
    "/api/auth/code",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email"],
          properties: {
            email: {
              type: "string",
              maxLength: 254,
              pattern: "^[^@ ]+@[^@ ]+\\.[^@ ]+$",
            },
          },
        },
      },
    },
    async (req) => {
      const key = req.ip;
      const a = attempts.get(key);
      if (a && Date.now() - a.at < 60000 && a.n >= 4)
        fail(
          "rate_limited",
          "Wait a minute before requesting another code.",
          429,
        );
      attempts.set(key, { at: a?.at ?? Date.now(), n: (a?.n ?? 0) + 1 });
      if (supabase)
        await supabase.auth.signInWithOtp({
          email: req.body.email,
          options: { shouldCreateUser: false },
        });
      return {
        message: "If this address is invited, a sign-in code is on its way.",
        fixture: config.mode === "fixture",
      };
    },
  );
  app.post<{
    Body: { email: string; code: string; adult: boolean; consent: boolean };
  }>("/api/auth/verify", async (req, rep) => {
    const { email, code, adult, consent } = req.body ?? {};
    if (
      !adult ||
      !consent ||
      typeof email !== "string" ||
      !email.includes("@") ||
      typeof code !== "string"
    )
      fail(
        "invalid_params",
        "Confirm adult eligibility and data consent, then enter your code.",
        400,
      );
    if (config.mode === "fixture") {
      if (code !== "246810")
        fail("invalid_code", "That development code is incorrect.", 400);
      const owner = hashUUID(email.toLowerCase().trim());
      const token = randomBytes(32).toString("hex");
      sessions.set(token, { owner, email, expires: Date.now() + 3600_000 });
      revokedOwners.delete(owner);
      secureCookie(rep, "tutor_session", token);
      await store.transact(owner, (s) => {
        if (s.deleted) Object.assign(s, { deleted: false });
        s.profile ??= {adultConfirmedAt:new Date().toISOString(),retention:{liveTranscript:false,audio:false,screen:false}};
      });
      return { signedIn: true };
    }
    const r = await supabase!.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    if (r.error || !r.data.session)
      fail(
        "invalid_code",
        "The code expired or is incorrect. Request another code.",
        400,
      );
    revokedOwners.delete(r.data.user!.id);
    await store.transact(r.data.user!.id,s=>{s.profile??={adultConfirmedAt:new Date().toISOString(),retention:{liveTranscript:false,audio:false,screen:false}};});
    secureCookie(
      rep,
      "tutor_session",
      r.data.session.access_token,
      r.data.session.expires_in,
    );
    return { signedIn: true };
  });
  app.get("/api/me", async (req) => {
    const actor = await auth(req);
    return store.transact(actor.owner, (s) => ({
      email: actor.email,
      authentication: config.devAuthBypass ? "local_test" : "required",
      mode: config.mode,
      courses: s.courses.filter((x) => !x.deleted).map(c=>({...c,sourceCount:s.sources.filter(src=>!src.deleted&&src.courseId===c.id).length,lessonCount:s.lessons.filter(l=>!l.deleted&&l.courseId===c.id).length})),
      lessons: s.lessons
        .filter((x) => !x.deleted)
        .map((l) => ({ id: l.id, courseId: l.courseId, goal: l.goal, title: l.messages.find(m=>m.role==="student")?.text?.split("\n")[0]?.slice(0,90) ?? l.goal,createdAt:l.createdAt,updatedAt:l.updatedAt,noteCount:(l.notes??[]).filter(n=>!n.deleted).length })),
      remainingSeconds: s.remainingSeconds,
      preferences:s.profile?.retention??{liveTranscript:false,audio:false,screen:false},
    }));
  });
  app.post("/api/auth/logout", async (req, rep) => {
    const actor = await auth(req);
    studio.abortOwner(actor.owner);
    if (config.devAuthBypass) {
      await store.transact(actor.owner,s=>{for(const l of s.lessons){illustrations.abortLesson(actor.owner,l.id);revokeGrants(actor.owner,l.id);l.epoch++;delete l.capture;}});
      secureCookie(rep,"tutor_session","",0);
      return {signedOut:false,localTesting:true};
    }
    revokedOwners.add(actor.owner);
    await store.transact(actor.owner, (s) => {
      s.revokedSessions??=[];
      s.revokedSessions.push(tokenDigest(req.cookies.tutor_session!));
      s.lessons.forEach((l) => {
        illustrations.abortLesson(actor.owner,l.id);
        revokeGrants(actor.owner, l.id);
        l.epoch++;
        delete l.capture;
      });
    });
    secureCookie(rep, "tutor_session", "", 0);
    return { signedOut: true };
  });
  app.patch<{Body:{liveTranscript:boolean}}>("/api/preferences",{schema:{body:{type:'object',additionalProperties:false,required:['liveTranscript'],properties:{liveTranscript:{type:'boolean'}}}}},async(req)=>{const actor=await auth(req);return store.transact(actor.owner,s=>{s.profile??={adultConfirmedAt:new Date().toISOString(),retention:{liveTranscript:false,audio:false,screen:false}};s.profile.retention.liveTranscript=req.body.liveTranscript;return s.profile.retention;});});
  app.post<{ Body: { name: string } }>("/api/courses", async (req) => {
    const actor = await auth(req);
    return store.transact(actor.owner, (s) => {
      if (
        typeof req.body?.name !== "string" ||
        !req.body.name.trim() ||
        req.body.name.length > 100
      )
        fail("invalid_params", "Name your course.", 400);
      const now=new Date().toISOString();const c = { id: uid(), name: req.body.name.trim(),createdAt:now,updatedAt:now };
      s.courses.push(c);
      return c;
    });
  });
  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/api/courses/:id",
    async (req) => {
      const a = await auth(req);
      return store.transact(a.owner, (s) => {
        const c = course(s, req.params.id);
        if (!req.body.name?.trim() || req.body.name.length > 100)
          fail("invalid_params", "Use a short course name.", 400);
        c.name = req.body.name.trim();
        c.updatedAt=new Date().toISOString();
        return c;
      });
    },
  );
  const upload = async (
    owner: string,
    courseId: string,
    name: string,
    bytes: Buffer,
    replaceId?: string,
  ) => {
    if (!/\.(pdf|csv|txt|md|ipynb|json)$/i.test(name))
      fail(
        "unsupported",
        "Use a PDF, CSV, text, notebook v4 or structured DSA JSON file.",
        400,
      );
    const hash = createHash("sha256").update(bytes).digest("hex");
    const existing = await store.transact(owner, (s) => {
      course(s, courseId);
      if(!replaceId&&s.sources.filter(x=>!x.deleted&&x.courseId===courseId).length>=25)fail("quota_exhausted","This course has 25 files. Replace or remove one before adding another.",429);
      return s.sources.find(
        (x) => !x.deleted && x.courseId === courseId && x.hash === hash,
      );
    });
    if (existing) return publicSource(existing);
    const id = uid(),
      versionId = uid(),
      storageKey = `${owner}/${courseId}/${id}/${versionId}`;
    if (storage) {
      const r = await storage.storage
        .from("course-originals")
        .upload(storageKey, bytes, {
          upsert: false,
          contentType: "application/octet-stream",
        });
      if (r.error)
        fail(
          "storage_unavailable",
          "Your file could not be stored. Try again.",
          503,
        );
    } else {
      await mkdir(path.resolve(config.dataDir, "originals"), {
        recursive: true,
      });
      await writeFile(
        path.resolve(config.dataDir, "originals", versionId),
        bytes,
      );
    }
    const saved = await store.transact(owner, (s) => {
      course(s, courseId).updatedAt=new Date().toISOString();
      const duplicate = s.sources.find(
        (x) => !x.deleted && x.courseId === courseId && x.hash === hash,
      );
      if (duplicate) return publicSource(duplicate);
      const old = replaceId ? source(s, replaceId) : undefined;
      if (old && old.courseId !== courseId)
        fail("unauthorized", "Choose a file in this course.", 403);
      const src: Source = {
        id: old?.id ?? id,
        courseId,
        name: name.slice(0, 180),
        versionId,
        revision: (old?.revision ?? 0) + 1,
        hash,
        status: "indexing",
        storageKey,
        passages: [],
        skippedPages: [],
        previous: old
          ? [
              { ...structuredClone(old), previous: undefined },
              ...(old.previous ?? []),
            ]
          : [],
      };
      if (old) {
        const index = s.sources.indexOf(old);
        s.sources[index] = src;
      } else s.sources.push(src);
      s.jobs.push({
        id: uid(),
        owner,
        courseId,
        sourceId: src.id,
        versionId,
        originalName: name,
        storageKey,
        state: "pending",
        attempts: 0,
        createdAt: Date.now(),
      });
      return publicSource(src);
    });
    if (saved.versionId !== versionId) {
      if (storage)
        await storage.storage.from("course-originals").remove([storageKey]);
      else
        await unlink(
          path.resolve(config.dataDir, "originals", versionId),
        ).catch(() => {});
    }
    return saved;
  };
  app.post<{ Params: { id: string }; Querystring: { replace?: string } }>(
    "/api/courses/:id/uploads",
    async (req) => {
      const actor = await auth(req);
      await store.transact(actor.owner, (s) => course(s, req.params.id));
      const results = [];
      for await (const part of req.parts())
        if (part.type === "file")
          results.push(
            await upload(
              actor.owner,
              req.params.id,
              part.filename,
              await part.toBuffer(),
              req.query.replace,
            ),
          );
      return { sources: results };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/courses/:id/sample",
    async (req) => {
      const actor = await auth(req);
      const out = [];
      for (const name of ["lecture.pdf", "attempt.ipynb", "scores.csv"])
        out.push(
          await upload(
            actor.owner,
            req.params.id,
            name,
            await readFile(path.resolve("fixtures", name)),
          ),
        );
      return { sources: out };
    },
  );
  app.get<{ Params: { id: string } }>("/api/courses/:id", async (req) => {
    const a = await auth(req);
    return store.transact(a.owner, (s) => ({
      course: course(s, req.params.id),
      sources: s.sources
        .filter((x) => !x.deleted && x.courseId === req.params.id)
        .map(publicSource),
      lessons: s.lessons.filter(
        (x) => !x.deleted && x.courseId === req.params.id,
        ).map(publicLesson),
    }));
  });
  app.get<{ Params: { id: string; versionId: string } }>(
    "/api/sources/:id/versions/:versionId/content",
    async (req, rep) => {
      const a = await auth(req);
      const src = await store.transact(a.owner, (s) => {
        const cur = source(s, req.params.id);
        return cur.versionId === req.params.versionId
          ? cur
          : ((cur.previous ?? []).find(
              (x) => x.versionId === req.params.versionId,
            ) ?? fail("target_changed", "This version is unavailable.", 404));
      });
      let bytes: Buffer;
      if (storage) {
        const r = await storage.storage
          .from("course-originals")
          .download(src.storageKey);
        if (r.error)
          fail("source_unavailable", "This source could not be read.", 503);
        bytes = Buffer.from(await r.data.arrayBuffer());
      } else
        bytes = await readFile(
          path.resolve(config.dataDir, "originals", src.versionId),
        );
      await store.transact(a.owner, (s) => source(s, src.id));
      rep.header(
        "Content-Type",
        src.name.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "text/plain; charset=utf-8",
      );
      rep.header("Content-Disposition", "inline");
      rep.header("Accept-Ranges", "bytes");
      const range = req.headers.range;
      if (range) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!m)
          return rep
            .code(416)
            .header("Content-Range", `bytes */${bytes.length}`)
            .send();
        const start = Number(m[1]),
          end = m[2]
            ? Math.min(Number(m[2]), bytes.length - 1)
            : bytes.length - 1;
        if (start > end || start >= bytes.length) return rep.code(416).send();
        return rep
          .code(206)
          .header("Content-Range", `bytes ${start}-${end}/${bytes.length}`)
          .send(bytes.subarray(start, end + 1));
      }
      return rep.send(bytes);
    },
  );
  app.post<{ Body: { courseId: string; goal?: string } }>(
    "/api/lessons",
    async (req) => {
      const a = await auth(req);
      return store.transact(a.owner, (s) => {
        course(s, req.body.courseId);
        const l: Lesson = {
          id: uid(),
          courseId: req.body.courseId,
          goal:
            req.body.goal?.slice(0, 500) ??
            "Understand my coursework",
          epoch: 0,
          createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
          messages: [],
          receipts: {},
          attempts: [],
          quiet: false,
        };
        s.lessons.push(l);
        return l;
      });
    },
  );
  app.get<{ Params: { id: string } }>("/api/lessons/:id", async (req) => {
    const a = await auth(req);
    return store.transact(a.owner, (s) => ({
      lesson: publicLesson(lesson(s, req.params.id)),
      sources: s.sources
        .filter(
          (x) => !x.deleted && x.courseId === lesson(s, req.params.id).courseId,
        )
        .map(publicSource),
      remainingSeconds: s.remainingSeconds,
    }));
  });
  app.post<{ Params: { id: string }; Body: Action }>(
    "/api/lessons/:id/actions",
    {schema:{body:actionSchema}},
    async (req) => {
      const a = await auth(req);
      if (req.params.id !== req.body.sessionId)
        fail("unauthorized", "This action targets a different lesson.", 403);
      if(req.body.type === "illustration.generate") return illustrations.generateAction(a.owner,req.body);
      return store.transact(a.owner, (s) => {const l=lesson(s,req.params.id);const prior=Boolean(l.receipts[req.body.actionId]);const receipt=perform(s,req.body);if(!prior&&req.body.type.startsWith('board.')){l.epoch++;illustrations.abortLesson(a.owner,l.id);pendingText.get(`${a.owner}:${l.id}`)?.controller.abort();}return receipt;});
    },
  );
  app.get<{ Params: { id: string; actionId: string } }>(
    "/api/lessons/:id/actions/:actionId",
    async (req) => {
      const a = await auth(req);
      return store.transact(
        a.owner,
        (s) =>
          lesson(s, req.params.id).receipts[req.params.actionId]?.receipt ??
          fail("not_found", "This action has not been saved.", 404),
      );
    },
  );
  app.post<{ Params: { id: string }; Body: { revision: number } }>(
    "/api/lessons/:id/paint",
    async (req) => {
      const a = await auth(req);
      return store.transact(a.owner, (s) => {
        const l = lesson(s, req.params.id);
        if (l.board?.revision !== req.body.revision)
          fail("stale_revision", "This board changed before it was shown.");
        l.paintedRevision = req.body.revision;
        return {
          status: "shown",
          revision: req.body.revision,
          measurement: "browser_ack_proxy",
        };
      });
    },
  );
  const pendingText = new Map<string, {id:string;controller:AbortController}>();
  registerSourceNotes(app,{store,auth,onScopeChanged:(owner,id)=>{studio.abortLesson(owner,id);illustrations.abortLesson(owner,id);revokeGrants(owner,id);pendingText.get(`${owner}:${id}`)?.controller.abort();pendingText.delete(`${owner}:${id}`);}});
  const interrupt = async (owner: string, id: string) => {
    illustrations.abortLesson(owner,id);
    pendingText.get(`${owner}:${id}`)?.controller.abort();
    pendingText.delete(`${owner}:${id}`);
    revokeGrants(owner, id);
    return store.transact(owner, (s) => {
      const l = lesson(s, id);
      l.epoch++;
      delete l.capture;
      return l.epoch;
    });
  };
  app.post<{ Params: { id: string }; Body: { quiet?: boolean } }>(
    "/api/lessons/:id/interrupt",
    async (req) => {
      const a = await auth(req);
      const epoch = await interrupt(a.owner, req.params.id);
      await store.transact(
        a.owner,
        (s) => (lesson(s, req.params.id).quiet = req.body?.quiet ?? false),
      );
      return { epoch };
    },
  );
  const processTypedMessage = async (req:any,onProgress:(event:any)=>void) => {
    const a=await auth(req);
    const {text,clientMessageId}=req.body??{};
    if(typeof text!=="string"||!text.trim()||text.length>4000||typeof clientMessageId!=="string"||!clientMessageId||clientMessageId.length>128)
      fail("invalid_params","Enter a short question.",400);
    const key=`${a.owner}:${req.params.id}`;
    const previous=pendingText.get(key);
    if(previous&&previous.id!==clientMessageId)previous.controller.abort();
    const controller=previous?.id===clientMessageId?previous.controller:new AbortController();
    pendingText.set(key,{id:clientMessageId,controller});
    const stageId=(suffix:string)=>`${clientMessageId.length+suffix.length+1<=128?clientMessageId:tokenDigest(clientMessageId)}-${suffix}`;
    const firstMeterId=clientMessageId,groundedMeterId=stageId("grounded");
    const paid=config.mode==="live"&&config.paid&&Boolean(config.geminiKey);
    const embedding=await queryEmbedding(text);
    const input:any=await store.transact(a.owner,async(s,client)=>{
      const l=lesson(s,req.params.id),prior=l.messages.find(m=>m.id===clientMessageId);
      if(prior){if(prior.text!==text)fail("payload_conflict","This message ID was used for different text.");return{prior};}
      if(controller.signal.aborted)fail("stale_turn","The earlier request was interrupted.");
      if(paid){reconcileStale(s,Date.now(),meterPolicy);reserveTextTurn(s,{id:firstMeterId,lessonId:l.id,model:config.textModel,now:Date.now(),payloadHash:tokenDigest(text)},meterPolicy);}
      const history=lessonContextMessages(l).filter(m=>["student","tutor"].includes(m.role)&&typeof m.text==="string").slice(-8).map(m=>({role:m.role,text:m.text.slice(0,700)}));
      l.epoch++;l.quiet=false;
      l.messages.push({id:clientMessageId,role:"student",text,status:"pending"});
      const owned=readyLessonSources(s,l);
      const datasets=owned.filter(x=>x.dataset);
      // The offline fixture retains its existing upload-to-histogram journey.
      // Live visuals are proposed by the model and computed by the gateway.
      if(config.mode==="fixture"&&!l.board&&datasets.length===1&&/histogram|density|bins?|peak|\.03/i.test(text)){
        const src=datasets[0],column=src.dataset!.numericColumns[0];
        if(column){
          let edges:number[]|undefined;
          const notebook=owned.find(x=>x.notebook);
          const match=JSON.stringify(notebook?.notebook??{}).match(/bins\s*=\s*\[([\d.,\s-]+)\]/);
          if(match)edges=match[1].split(",").map(Number);
          perform(s,{actionId:stageId("chart"),sessionId:l.id,turnEpoch:l.epoch,type:"board.create",targetId:uid(),expectedRevision:0,args:{kind:"histogram",sourceId:src.id,column,...(edges?{edges}:{binCount:4})}},"model");
        }
      }
      const passages=await searchCourse(s,a.owner,l,(text+(/histogram|bin|density|\.03/i.test(text)?" density histogram bin count":"")).slice(0,4000),client,embedding);
      return{epoch:l.epoch,sourceSelectionRevision:l.sourceSelectionRevision??0,question:text,goal:l.goal,passages,board:lessonContextBoard(s,l),attempts:l.attempts,history,
        notebook:owned.filter(x=>x.notebook).map(x=>({sourceId:x.id,versionId:x.versionId,filename:x.name,cells:x.notebook.cells})),
        datasets:datasets.map(x=>({sourceId:x.id,versionId:x.versionId,name:x.name,columns:x.dataset!.columns,numericColumns:x.dataset!.numericColumns,rowCount:x.dataset!.rows.length})),
        dsaSources:owned.filter(x=>x.dsa).map(x=>({sourceId:x.id,versionId:x.versionId,name:x.name,dsa:x.dsa})),
        sourceVersions:owned.map(x=>({id:x.id,versionId:x.versionId})),
        paintedRevision:l.paintedRevision,pairedNotebook:companionController?.snapshot(a.owner,l.id),phase:"propose"};
    });
    if(input.prior){if(input.prior.status!=="pending"&&pendingText.get(key)?.controller===controller)pendingText.delete(key);return{status:input.prior.status,message:input.prior.response};}
    const checkContext=(s:State,l:Lesson)=>{
      if(controller.signal.aborted||l.epoch!==input.epoch)fail("stale_turn","The earlier reply was interrupted. Your latest work is saved.");
      const currentSources=readyLessonSources(s,l).map(src=>`${src.id}:${src.versionId}`).sort();
      if((l.sourceSelectionRevision??0)!==input.sourceSelectionRevision||JSON.stringify(currentSources)!==JSON.stringify((input.sourceVersions??[]).map((src:any)=>`${src.id}:${src.versionId}`).sort()))fail('target_changed','Your selected sources changed while this reply was prepared.');
      for(const version of input.sourceVersions??[]){const head=source(s,version.id);if(head.courseId!==l.courseId||![head,...(head.previous??[])].some(v=>v.versionId===version.versionId))fail("target_changed","The source changed while this reply was prepared.");}
      if(input.board?.sourceId){const head=source(s,input.board.sourceId);if(head.courseId!==l.courseId||![head,...(head.previous??[])].some(v=>v.versionId===input.board.sourceVersionId))fail("target_changed","The visual's source is no longer available.");}
    };
    const providerCalls:{id:string;usage:any}[]=[];
    const callStates=new Map<string,{started:boolean;usage?:any}>();
    const callStage=async(stageInput:any,meterId:string,reserve:boolean)=>{
      if(reserve&&paid)await store.transact(a.owner,s=>{const l=lesson(s,req.params.id);checkContext(s,l);reconcileStale(s,Date.now(),meterPolicy);reserveTextTurn(s,{id:meterId,lessonId:l.id,model:config.textModel,now:Date.now(),payloadHash:tokenDigest(text+"\n"+meterId)},meterPolicy);});
      const observation={started:false,usage:undefined as any};callStates.set(meterId,observation);
      try{
        await store.transact(a.owner,s=>checkContext(s,lesson(s,req.params.id)));
        observation.started=true;
        const result=await tutorReply(stageInput,{fixture:config.mode==="fixture",apiKey:config.geminiKey,model:config.textModel,paid:config.paid,signal:controller.signal,onProgress,inputTokenLimit:meterPolicy.limits.text?.input.TEXT,outputTokenLimit:meterPolicy.limits.text?.output.TEXT});
        observation.usage=result.usage;
        await store.transact(a.owner,s=>{if(s.reservations[meterId])settleTextTurn(s,meterId,[{eventId:meterId,metadata:result.usage}],meterPolicy);});
        providerCalls.push({id:meterId,usage:result.usage??null});
        return result;
      }catch(error:any){
        if(error.providerStarted===false)observation.started=false;
        observation.usage=error.usage??observation.usage;
        await store.transact(a.owner,s=>{if(s.reservations[meterId])settleTextTurn(s,meterId,observation.usage?[{eventId:meterId,metadata:observation.usage}]:[],meterPolicy,{noProviderWork:!observation.started});});
        throw error;
      }
    };
    try{
      const proposed=await callStage(input,firstMeterId,false);
      const visual=proposed.visualProposal??(proposed.patch?{type:"board.patch" as const,args:proposed.patch}:undefined);
      let output=proposed,receipt:any;
      if(visual){
        receipt=await store.transact(a.owner,s=>{
          const l=lesson(s,req.params.id);checkContext(s,l);
          if(visual.type!=="board.create"&&!l.board)fail("target_changed","Create a visual before changing it.");
          return perform(s,{actionId:stageId(visual.type==="board.patch"?"patch":"visual"),sessionId:l.id,turnEpoch:l.epoch,type:visual.type,targetId:visual.type==="board.create"?uid():l.board!.id,expectedRevision:input.board?.revision??0,args:visual.args},"model");
        });
        onProgress({stage:"visual_computed",revision:receipt.revision});
        const confirmed=await store.transact(a.owner,s=>{const l=lesson(s,req.params.id);checkContext(s,l);return{...input,phase:"grounded",board:l.board,visualReceipt:receipt,paintedRevision:l.paintedRevision};});
        // Never publish the provisional narrative. The next paid call sees the
        // actual result and has no mutation fields in its response schema.
        output=await callStage(confirmed,groundedMeterId,true);
      }
      await store.transact(a.owner,s=>checkContext(s,lesson(s,req.params.id)));
      const externalReceipt=proposed.notebookProposal?await companionController.dispatch(a.owner,req.params.id,{actionId:stageId("notebook"),type:"notebook.propose",turnEpoch:input.epoch,args:proposed.notebookProposal}):undefined;
      return await store.transact(a.owner,s=>{
        const l=lesson(s,req.params.id);checkContext(s,l);
        const citations=input.passages.filter((p:any)=>output.citationIds.includes(p.passageId)).map((p:any)=>{
          const head=source(s,p.sourceId),version=[head,...(head.previous??[])].find(v=>v.versionId===p.versionId);
          const passage=version?.passages.find(candidate=>candidate.id===p.passageId);
          if(!passage||head.courseId!==l.courseId)fail("insufficient_evidence","The cited source is no longer available.");
          return{...p,text:passage.text,locator:passage.locator};
        });
        const answer={id:uid(),role:"tutor",text:output.text,citations,usage:output.usage??null,providerCalls,fixture:config.mode==="fixture",receipt,externalReceipt,at:new Date().toISOString()};l.updatedAt=answer.at;course(s,l.courseId).updatedAt=answer.at;
        l.messages.push(answer);
        const m=l.messages.find(message=>message.id===clientMessageId);
        if(m){m.status="complete";m.response=answer;}
        return{status:"complete",message:answer,board:l.board};
      });
    }catch(error:any){
      await store.transact(a.owner,s=>{
        const m=lesson(s,req.params.id).messages.find(message=>message.id===clientMessageId);if(m&&m.status!=="complete")m.status="failed";
        // Unused reservations created before a source/epoch check did no paid
        // work. A started provider failure was already settled conservatively.
        for(const meterId of[firstMeterId,groundedMeterId]){const reservation=s.reservations[meterId],observed=callStates.get(meterId);if(reservation&&!reservation.settled)settleTextTurn(s,meterId,observed?.usage?[{eventId:meterId,metadata:observed.usage}]:[],meterPolicy,{noProviderWork:!observed?.started});}
      });
      if(error instanceof DomainError)throw error;
      throw Object.assign(error,{status:error.status??503,code:error.code??"provider_unavailable"});
    }finally{if(pendingText.get(key)?.controller===controller)pendingText.delete(key);}
  };
  app.post<{
    Params: { id: string };
    Body: { clientMessageId: string; text: string };
  }>("/api/lessons/:id/messages", async (req, rep) => {
    await auth(req);
    const streaming = req.headers.accept?.includes("application/x-ndjson");
    if (!streaming) return processTypedMessage(req, () => {});
    rep.hijack();
    rep.raw.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const send = (event: any) => {
      if (!rep.raw.destroyed) rep.raw.write(JSON.stringify(event) + "\n");
    };
    try {
      send({
        type: "progress",
        stage: "checking_source",
        fixture: config.mode === "fixture",
      });
      const result = await processTypedMessage(req, (event) =>
        send({
          type: "progress",
          ...event,
          fixture: config.mode === "fixture",
        }),
      );
      send({ type: "complete", result });
    } catch (e: any) {
      send({
        type: "error",
        code: e.code ?? "service_error",
        message:
          e instanceof DomainError || e.status
            ? e.message
            : "The reply could not finish. Your confirmed work is saved.",
      });
    }
    rep.raw.end();
    return rep;
  });
  app.post<{
    Params: { id: string };
    Body: { captureId: string; frameId: string };
  }>("/api/lessons/:id/capture", async (req) => {
    const a = await auth(req);
    return store.transact(a.owner, (s) => {
      const l = lesson(s, req.params.id);
      const b = req.body;
      if (
        typeof b.captureId !== "string" ||
        typeof b.frameId !== "string" ||
        b.captureId.length > 128 ||
        b.frameId.length > 128
      )
        fail("invalid_params", "Select a new capture.", 400);
      l.capture = { id: b.captureId, frameId: b.frameId, at: Date.now() };
      return { active: true };
    });
  });
  app.delete<{ Params: { id: string } }>(
    "/api/lessons/:id/capture",
    async (req) => {
      const a = await auth(req);
      return store.transact(a.owner, (s) => {
        delete lesson(s, req.params.id).capture;
        return { stopped: true };
      });
    },
  );
  app.post<{ Params: { id: string } }>("/api/lessons/:id/hint", async (req) => {
    const a = await auth(req);
    return store.transact(a.owner, (s) => {
      const l = lesson(s, req.params.id);
      if (!l.practice)
        fail("target_changed", "Start a practice question first.");
      l.practice.hintDepth++;
      return {
        hint:
          l.practice.hintDepth === 1
            ? "Start with the conditioning group or the number of included observations."
            : l.practice.hintDepth === 2
              ? "For density, divide the relative frequency by bin width. For a line, multiply change in x by slope."
              : getPracticeItem(l.practice).solution,
        depth: l.practice.hintDepth,
      };
    });
  });
  app.delete<{ Params: { id: string } }>("/api/sources/:id", async (req) => {
    const a = await auth(req);
    const keys = await store.transact(a.owner, async (s, client) => {
      const src = s.sources.find((x) => x.id === req.params.id);
      if (!src) fail("not_found", "Source unavailable.", 404);
      if (src.deleted) return [];
      queuePurge(s, [src]);
      const linked=s.lessons.filter(l=>l.courseId===src.courseId);for(const l of linked){studio.abortLesson(a.owner,l.id);illustrations.abortLesson(a.owner,l.id);}illustrations.purgeLessons(s,linked);
      if (client) await invalidateSource(client, a.owner, src.id);
      src.deleted = true;
      const keys = [src, ...(src.previous ?? [])].map((x) => ({
        key: x.storageKey,
        id: x.versionId,
      }));
      src.passages = [];
      delete src.dataset;
      delete src.notebook;
      delete src.dsa;
      delete src.dsaExample;
      src.previous = [];
      s.jobs
        .filter((j) => j.sourceId === src.id)
        .forEach((j) => (j.state = "cancelled"));
      for (const l of s.lessons.filter((l) => l.courseId === src.courseId)) {
        purgeStudioArtifacts(l,[src.id]);
        revokeGrants(a.owner, l.id);
        l.epoch++;
        l.messages = [];
        l.sourceSelectionMessageOffset=0;
        l.receipts = {};
        delete l.capture;
        delete l.activeSource;
        if (l.board?.sourceId === src.id) delete l.board;
      }
      return keys;
    });
    for (const k of keys) {
      if (storage)
        await storage.storage.from("course-originals").remove([k.key]);
      else
        await unlink(path.resolve(config.dataDir, "originals", k.id)).catch(
          () => {},
        );
    }
    const complete = await drainPurge(a.owner);
    return {
      revoked: true,
      purge: complete ? "complete" : "pending",
      backupExpiry: "unverified",
    };
  });
  app.delete<{ Params: { id: string } }>("/api/lessons/:id", async (req) => {
    const a = await auth(req);
    return store.transact(a.owner, (s) => {
      const l = lesson(s, req.params.id);
      studio.abortLesson(a.owner,l.id);illustrations.abortLesson(a.owner,l.id);illustrations.purgeLessons(s,[l]);
      purgeStudioArtifacts(l);
      Object.assign(l, {
        deleted: true,
        messages: [],
        attempts: [],
        receipts: {},
        notes:[],
        epoch: l.epoch + 1,
      });
      delete l.board;
      delete l.capture;
      return { revoked: true };
    });
  });
  app.delete<{ Params: { id: string } }>("/api/courses/:id", async (req) => {
    const a = await auth(req);
    return store.transact(a.owner, async (s, client) => {
      const c = s.courses.find((c) => c.id === req.params.id);
      if (!c) fail("not_found", "Course unavailable.", 404);
      c.deleted = true;
      const linked=s.lessons.filter(l=>l.courseId===c.id);for(const l of linked){studio.abortLesson(a.owner,l.id);illustrations.abortLesson(a.owner,l.id);purgeStudioArtifacts(l);}illustrations.purgeLessons(s,linked);
      if (client) await invalidateCourse(client, a.owner, c.id);
      queuePurge(
        s,
        s.sources.filter((x) => x.courseId === c.id),
      );
      for (const l of s.lessons.filter((l) => l.courseId === c.id))
        revokeGrants(a.owner, l.id);
      for (const x of s.sources.filter((x) => x.courseId === c.id)) {
        x.deleted = true;
        x.passages = [];
        delete x.dataset;
        delete x.notebook;
        delete x.dsa;
        delete x.dsaExample;
        x.previous = [];
      }
      for (const l of s.lessons.filter((l) => l.courseId === c.id))
        revokeGrants(a.owner, l.id);
      s.lessons = s.lessons.filter((l) => l.courseId !== c.id);
      s.jobs
        .filter((j) => j.courseId === c.id)
        .forEach((j) => (j.state = "cancelled"));
      return { revoked: true, purge: "pending" };
    });
  });
  app.delete("/api/account", async (req, rep) => {
    const a = await auth(req);
    studio.abortOwner(a.owner);
    await store.transact(a.owner, async (s, client) => {
      if (client)
        for (const c of s.courses)
          await invalidateCourse(client, a.owner, c.id);
      queuePurge(s, s.sources);
      for(const l of s.lessons){illustrations.abortLesson(a.owner,l.id);purgeStudioArtifacts(l);}illustrations.purgeLessons(s,s.lessons);
      for (const l of s.lessons) revokeGrants(a.owner, l.id);
      Object.assign(s, {
        courses: [],
        sources: [],
        lessons: [],
        jobs: [],
        reservations: {},
        remainingSeconds: 0,
        deleted: true,
      });
    });
    const complete = await drainPurge(a.owner);
    if (complete && storage && !config.devAuthBypass) await storage.auth.admin.deleteUser(a.owner);
    secureCookie(rep, "tutor_session", "", 0);
    return {
      revoked: true,
      purge: complete ? "complete" : "pending",
      providerRetention:
        "See provider terms; deletion is not a provider erasure guarantee.",
    };
  });
  const workerSecret = config.workerSecret;
  const workerAuth = (req: any) => {
    const given = String(req.headers.authorization ?? "");
    if (!workerSecret || given !== `Bearer ${workerSecret}`)
      fail("unauthorized", "Worker credential required.", 403);
  };
  app.post("/internal/purges/run", async (req) => {
    workerAuth(req);
    let complete = 0;
    for (const owner of await store.owners())
      if (await drainPurge(owner)) complete++;
    return { checked: complete };
  });
  app.post("/internal/jobs/claim", async (req) => {
    workerAuth(req);
    for (const owner of await store.owners()) {
      const job = await store.transact(owner, (s) => {
        const j = s.jobs.find(
          (j) =>
            (j.state === "pending" ||
              (j.state === "processing" && j.leaseExpiresAt < Date.now())) &&
            j.attempts < 3,
        );
        if (!j) return null;
        const src = s.sources.find(
          (x) =>
            x.id === j.sourceId && !x.deleted && x.versionId === j.versionId,
        );
        if (!src) {
          j.state = "cancelled";
          return null;
        }
        j.state = "processing";
        j.attempts++;
        j.leaseToken = uid();
        j.leaseExpiresAt = Date.now() + 120000;
        return j;
      });
      if (job)
        return {
          id: job.id,
          leaseToken: job.leaseToken,
          originalName: job.originalName,
          path:
            config.mode === "fixture"
              ? path.resolve(config.dataDir, "originals", job.versionId)
              : undefined,
          downloadUrl: `http://127.0.0.1:${config.port}/internal/jobs/${job.id}/content`,
          owner,
        };
    }
    return null;
  });
  app.get<{ Params: { id: string } }>(
    "/internal/jobs/:id/content",
    async (req, rep) => {
      workerAuth(req);
      for (const owner of await store.owners()) {
        const j = await store.transact(owner, (s) =>
          s.jobs.find(
            (j) => j.id === req.params.id && j.state === "processing",
          ),
        );
        if (j) {
          if (storage) {
            const r = await storage.storage
              .from("course-originals")
              .download(j.storageKey);
            if (r.error) fail("source_unavailable", "File unavailable.", 404);
            return rep.send(Buffer.from(await r.data.arrayBuffer()));
          }
          return rep.send(
            await readFile(
              path.resolve(config.dataDir, "originals", j.versionId),
            ),
          );
        }
      }
      fail("not_found", "Job unavailable.", 404);
    },
  );
  app.post<{
    Body: { id: string; leaseToken: string; result: any; error?: string };
  }>("/internal/jobs/publish", async (req) => {
    workerAuth(req);
    for (const owner of await store.owners()) {
      const out = await store.transact(owner, async (s, client) => {
        const j = s.jobs.find((j) => j.id === req.body.id);
        if (!j) return null;
        if (
          j.leaseToken !== req.body.leaseToken ||
          j.leaseExpiresAt < Date.now() ||
          j.state !== "processing"
        )
          fail("stale_revision", "The worker lease expired.");
        const src = s.sources.find(
          (x) =>
            x.id === j.sourceId && !x.deleted && x.versionId === j.versionId,
        );
        if (!src) {
          j.state = "cancelled";
          return { published: false };
        }
        const r = req.body.result;
        if (req.body.error || !r || !Array.isArray(r.passages)) {
          j.state = j.attempts >= 3 ? "failed" : "pending";
          src.status = j.state === "failed" ? "needs_attention" : "indexing";
          return { published: false };
        }
        src.passages = r.passages.slice(0, 2000).map((p: any) => ({
          id:
            typeof p.id === "string" && /^[0-9a-f-]{36}$/i.test(p.id)
              ? p.id
              : uid(),
          text: String(p.text).slice(0, 12000),
          locator: p.locator ?? {},
        }));
        src.dataset = r.dataset;
        src.notebook = r.notebook;
        src.dsa = r.dsa;
        src.dsaExample = r.dsaExample===true;
        if(typeof r.parserRevision==='string'&&/^r2-parser-\d+$/.test(r.parserRevision))j.parserRevision=r.parserRevision;
        src.status = [
          "ready",
          "ready_with_skipped_pages",
          "needs_attention",
        ].includes(r.status)
          ? r.status
          : "needs_attention";
        src.skippedPages = r.skippedPages ?? [];
        if (client)
          await indexPassages(client, {
            ownerId: owner,
            courseId: src.courseId,
            sourceId: src.id,
            versionId: src.versionId,
            passages: src.passages.map((p, i) => ({
              ...p,
              embedding: r.passages[i].embedding,
              embeddingRevision: r.passages[i].embeddingRevision,
            })),
          });
        j.state = "done";
        return { published: true };
      });
      if (out) return out;
    }
    fail("not_found", "Job unavailable.", 404);
  });
  await registerVoice(app, {
    config: {
      origin: config.origin,
      apiKey: config.mode === "live" ? config.geminiKey : undefined,
      model: process.env.GEMINI_LIVE_MODEL ?? "gemini-3.8-live",
      ticketSecret: secret,
      enabled: config.mode === "live" && config.live,
      maxSessionSeconds: config.maxSeconds,
      retainLiveTranscript: true,
      toolDiagnostics: config.mode==='live'&&config.devAuthBypass&&process.env.VOICE_TOOL_DIAGNOSTICS==='true',
      paidCallsAllowed: () => config.paid,
    },
    authorize,
    snapshot: (u, id) =>
      store.transact(u, (s) => {
        const l = lesson(s, id);
        return voiceLessonContext(s,l,companionController?.snapshot(u,id));
      }),
    currentEpoch: (u, id) => {
        if (revokedOwners.has(u))
          fail("unauthorized", "The session ended.", 401);
        return store.readLessonEpoch(u,id);
      },
    interrupt,
    executeTool: async (i) =>
      i.name.startsWith("notebook.")
        ? companionController.dispatch(i.userId, i.lessonId, {
            actionId: i.actionId,
            type: i.name,
            turnEpoch: i.turnEpoch,
            args: i.args,
          })
        : store.transact(i.userId, async (s, client) => {
            const l = lesson(s, i.lessonId);
            if (i.name === "course.search")
              return {
                passages: await searchCourse(
                  s,
                  i.userId,
                  l,
                  String(i.args.query ?? ""),
                  client,
                ),
              };
            if (
              ![
                "board.create",
                "board.patch",
                "board.replace",
                "board.undo",
                "course.search",
                "source.open",
                "practice.present",
              ].includes(i.name)
            )
              fail("unsupported", "This live action is unavailable.");
            if(i.name==="board.create"||i.name==="board.patch"||i.name==="board.replace"){
              const sources=readyLessonSources(s,l);
              validateVisualProposal({type:i.name,args:i.args},{question:i.inputText?.trim()?i.inputText:l.goal,goal:l.goal,board:lessonContextBoard(s,l),attempts:l.attempts,history:lessonContextMessages(l).filter(m=>m.role==="student").slice(-8),passages:sources.flatMap(src=>src.passages.map(p=>({...p,sourceId:src.id,versionId:src.versionId}))),notebook:sources.filter(src=>src.notebook).map(src=>({...src.notebook,sourceId:src.id,versionId:src.versionId})),datasets:sources.filter(src=>src.dataset).map(src=>({sourceId:src.id,name:src.name,columns:src.dataset!.columns,numericColumns:src.dataset!.numericColumns,rowCount:src.dataset!.rows.length})),dsaSources:sources.filter(src=>src.dsa).map(src=>({sourceId:src.id,versionId:src.versionId,name:src.name,dsa:src.dsa!}))});
            }
            return perform(
              s,
              {
                actionId: i.actionId,
                sessionId: l.id,
                turnEpoch: i.turnEpoch,
                type: i.name as any,
                targetId:
                  i.name === "board.create" ? uid() : (l.board?.id ?? l.id),
                expectedRevision: l.board?.revision ?? 0,
                args: i.args,
              },
              "model",
            );
          }),
    reserve: async (u, id, meterId, maxSeconds) =>
      store.transact(u, (s) => {
        lesson(s, id);
        reconcileStale(s, Date.now(), meterPolicy);
        return reserveLive(
          s,
          {
            id: meterId,
            lessonId: id,
            model: config.liveModel,
            now: Date.now(),
            maxSeconds,
          },
          meterPolicy,
        );
      }),
    settle: async (id, seconds, usage, options) => {
      for (const owner of await store.owners())
        await store.transact(owner, (s) => {
          if (s.reservations[id])
            settleLive(
              s,
              id,
              seconds,
              usage.map((u) => ({ eventId: u.eventId, metadata: u })),
              meterPolicy,
              options,
            );
        });
    },
    usageAllowed: async (id, usage) => {
      for (const owner of await store.owners()) {
        const result = await store.transact(owner, (s) =>
          s.reservations[id]
            ? addUsage(
                s,
                id,
                usage.map((u) => ({ eventId: u.eventId, metadata: u })),
                meterPolicy,
              ).allowed
            : null,
        );
        if (result !== null) return result;
      }
      return false;
    },
    toolsForSession: async (u, id, context) =>
      tutorTools(Boolean(companionController?.snapshot(u, id)), context as any),
    heartbeat: async (id) => {
      for (const owner of await store.owners()) {
        const ok = await store.transact(owner, (s) => {
          const r = s.reservations[id];
          if (!r) return null;
          if (
            s.deleted ||
            revokedOwners.has(owner) ||
            !s.lessons.some((l) => l.id === r.lessonId && !l.deleted)
          )
            return false;
          return heartbeatReservation(s, id, Date.now(), meterPolicy);
        });
        if (ok !== null) return ok;
      }
      return false;
    },
    recordMetric,
    recordTurn:async(owner,id,turn)=>store.transact(owner,s=>{const l=lesson(s,id);if(!s.profile?.retention.liveTranscript||l.epoch!==turn.turnEpoch)return;for(const [role,text]of [['student',turn.inputText],['tutor',turn.outputText]]){const messageId=hashUUID(`voice:${turn.turnId}:${role}`);if(text&&!l.messages.some(m=>m.id===messageId))l.messages.push({id:messageId,role,text,channel:'voice',played:'unknown',status:'complete'});}}),
    authorizeFrame: (u, id, captureId, frameId) =>
      store.transact(u, (s) => {
        const c = lesson(s, id).capture;
        return Boolean(
          c &&
          c.id === captureId &&
          c.frameId === frameId &&
          Date.now() - c.at < 3000,
        );
      }),
    tools: [
      {
        name: "board.patch",
        description: "Change the existing histogram in place.",
        parametersJsonSchema: {
          type: "object",
          properties: {
            binCount: { type: "integer", minimum: 1, maximum: 50 },
            mode: { enum: ["count", "density"] },
          },
          additionalProperties: false,
        },
      },
      {
        name: "course.search",
        description: "Search owned current course evidence.",
        parametersJsonSchema: {
          type: "object",
          required: ["query"],
          properties: { query: { type: "string" } },
          additionalProperties: false,
        },
      },
    ],
  });
  companionController = await registerCompanion(app, { config, store, auth });
  revokeGrants = companionController.revokeLesson;
  await registerPayments(app, { config, store, auth, meterPolicy });
  app.addHook("onClose", async () => {
    await illustrations.close();
    await recordMetric.flush();
    await store.close();
  });
  return { app, store, upload };
}
function publicLesson(l: Lesson) {
  const {illustrations,receipts,studio,...visible}=l;
  return {...visible,studio:studio?.filter(artifact=>artifact.status!=='deleted').map(({requestFingerprint,epoch,selectionRevision,...artifact})=>artifact),notes:(l.notes??[]).filter(note=>!note.deleted).map(({creationFingerprint,...note})=>note),receipts:Object.fromEntries(Object.entries(receipts).map(([id,entry])=>[id,{receipt:entry.receipt}])),illustrations:illustrations?.map(j=>({id:j.id,status:j.status,updatedAt:j.updatedAt}))};
}
function publicSource(src: Source): any {
  const { storageKey, previous, ...visible } = src;
  const old = !src.status.startsWith("ready")
    ? previous?.find((x) => x.status.startsWith("ready"))
    : undefined;
  return {
    ...visible,
    published: old ? publicSource({ ...old, previous: undefined }) : undefined,
    previous: previous?.map((x) => ({
      versionId: x.versionId,
      name: x.name,
      status: x.status,
    })),
  };
}
function hashUUID(text: string) {
  const h = createHash("sha256").update(text).digest("hex").slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
}
