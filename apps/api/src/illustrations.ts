import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  canonical,
  parseAction,
  type Action,
} from "../../../packages/contracts/index.ts";
import type { Config } from "./config.ts";
import { BflError, generateIllustration } from "./bfl.ts";
import { paidPassPeriod } from "./meter.ts";
import { reserveImage, settleImage } from "./illustration-meter.ts";
import type { IllustrationJob } from "./illustration-types.ts";
import {
  course,
  lesson,
  fail,
  type State,
  type Store,
  type Lesson,
} from "./store.ts";

const pending = (j: IllustrationJob) =>
  j.status === "queued" || j.status === "generating";
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type Dependencies = {
  config: Config;
  store: Store;
  storage?: SupabaseClient;
  auth: (req: any) => Promise<{ owner: string }>;
  provider?: typeof generateIllustration;
};

export async function registerIllustrations(
  app: FastifyInstance,
  { config, store, storage, auth, provider }: Dependencies,
) {
  if (provider && process.env.NODE_ENV !== "test")
    throw Error("An injected illustration provider is test-only.");
  const fixture = Boolean(provider),
    generate = provider ?? generateIllustration;
  const active = new Map<
    string,
    { lessonId: string; controller: AbortController; done: Promise<void> }
  >();
  const key = (owner: string, image: string) => `${owner}:${image}`;
  const enabled = () =>
    config.illustrations.enabled &&
    config.paid &&
    Boolean(config.illustrations.key) &&
    (config.mode === "live" || fixture);
  const estimateUsd = () => (enabled() ? config.illustrations.priceUsd : null);
  const blobPath = (owner: string, image: string) => {
    if (!uuid.test(owner) || !uuid.test(image))
      fail("invalid_params", "Invalid image identity.", 400);
    return path.resolve(config.dataDir, "illustrations", owner, image);
  };
  const removeBlob = async (owner: string, job: IllustrationJob) => {
    if (!job.storageKey) return;
    if (storage) {
      const r = await storage.storage
        .from("course-originals")
        .remove([job.storageKey]);
      if (r.error) throw Error("Illustration cleanup is pending.");
    } else
      await unlink(blobPath(owner, job.id)).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
  };
  const queuePurge = (s: State, job: IllustrationJob) => {
    if (!job.storageKey) return;
    s.purges ??= [];
    if (
      !s.purges.some((p) => p.kind === "illustration" && p.versionId === job.id)
    )
      s.purges.push({
        id: crypto.randomUUID(),
        key: job.storageKey,
        versionId: job.id,
        kind: "illustration",
        status: "pending",
        attempts: 0,
      });
  };
  const check = (s: State, lessonId: string) => {
    if (s.deleted) fail("unauthorized", "This account was deleted.", 401);
    const l = lesson(s, lessonId);
    course(s, l.courseId);
    return l;
  };
  const show = (l: Lesson, j: IllustrationJob) => ({
    id: j.id,
    title: j.title,
    purpose: j.purpose,
    status: j.status,
    model: j.model,
    fixture: j.fixture,
    createdAt: j.createdAt,
    estimateUsd: j.costState === "released" ? null : j.estimateUsd,
    costState: j.costState,
    message: j.message,
    imageUrl:
      j.status === "ready"
        ? `/api/lessons/${l.id}/illustrations/${j.id}/content`
        : undefined,
  });
  const receipt = (j: IllustrationJob) => ({
    status: j.status,
    objectId: j.id,
    provider: j.fixture ? "fixture" : "bfl",
    generated: true,
  });
  const finish = (l: Lesson, j: IllustrationJob) => {
    const previous = l.receipts[j.actionId];
    if (previous && ["queued", "generating"].includes(previous.receipt.status))
      previous.receipt = receipt(j);
  };
  const mark = (
    s: State,
    l: Lesson,
    j: IllustrationJob,
    status: IllustrationJob["status"],
    message: string,
    outcome: "estimated" | "unknown" | "released",
  ) => {
    settleImage(s, j, outcome);
    j.status = status;
    j.message = message;
    j.updatedAt = Date.now();
    finish(l, j);
  };
  async function execute(
    owner: string,
    lessonId: string,
    id: string,
    controller: AbortController,
  ) {
    let returned = false;
    try {
      const start = await store.transact(owner, (s) => {
        const l = check(s, lessonId),
          j = l.illustrations!.find((j) => j.id === id)!;
        if (
          !pending(j) ||
          controller.signal.aborted ||
          l.epoch !== j.turnEpoch ||
          (l.board?.revision ?? 0) !== j.boardRevision
        ) {
          if (pending(j))
            mark(
              s,
              l,
              j,
              "stale",
              "The lesson changed before generation started.",
              "released",
            );
          return null;
        }
        const entitlement = paidPassPeriod(
          s,
          Date.now(),
          j.passId === "pilot" ? undefined : j.passId,
        );
        if ((entitlement && !entitlement.active) || !enabled()) {
          mark(
            s,
            l,
            j,
            "cancelled",
            "This illustration is no longer authorized.",
            "released",
          );
          return null;
        }
        j.status = "generating";
        j.submitted = true;
        j.updatedAt = Date.now();
        return structuredClone(j);
      });
      if (!start) return;
      const result = await generate({
        key: config.illustrations.key!,
        model: start.model,
        baseUrl: config.illustrations.baseUrl,
        prompt: `Create one conceptual educational illustration for an adult statistics lesson. Purpose: ${start.purpose}\nScene: ${start.prompt}\nUse a clear uncluttered composition. Do not include equations, exact numerical labels, plotted data, answers to exercises, or claims of verification.`,
        width: 768,
        height: 768,
        signal: controller.signal,
        onSubmitted: async (providerId) => {
          await store.transact(owner, (s) => {
            const l = check(s, lessonId),
              j = l.illustrations?.find((j) => j.id === id);
            if (j) j.providerId = providerId;
          });
        },
      });
      if (
        result.width < 1 ||
        result.height < 1 ||
        result.width * result.height > 1024 * 1024
      )
        throw Error("Provider output dimensions need cost reconciliation.");
      returned = true;
      // The owner lock covers storage publication, so deletion cannot purge before a late upload.
      await store.transact(owner, async (s) => {
        const l = check(s, lessonId),
          j = l.illustrations?.find((j) => j.id === id);
        if (!j) return;
        if (
          !pending(j) ||
          controller.signal.aborted ||
          l.epoch !== j.turnEpoch ||
          (l.board?.revision ?? 0) !== j.boardRevision ||
          !enabled()
        ) {
          if (pending(j))
            mark(
              s,
              l,
              j,
              "stale",
              "The generated image was discarded because the lesson changed.",
              "estimated",
            );
          return;
        }
        if (storage) {
          const saved = await storage.storage
            .from("course-originals")
            .upload(j.storageKey!, result.bytes, {
              contentType: result.mime,
              upsert: false,
            });
          if (saved.error) throw Error("Private image storage is unavailable.");
        } else {
          const file = blobPath(owner, id);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, result.bytes, { flag: "wx" });
        }
        j.mime = result.mime;
        j.providerId = result.providerId;
        mark(
          s,
          l,
          j,
          "ready",
          "AI-generated illustration. Numerical and teaching correctness have not been verified.",
          "estimated",
        );
      });
    } catch (e: any) {
      await store
        .transact(owner, (s) => {
          const l = s.lessons.find((l) => l.id === lessonId),
            j = l?.illustrations?.find((j) => j.id === id);
          if (!l || !j || !pending(j)) return;
          const stale =
            l.deleted ||
            s.deleted ||
            l.epoch !== j.turnEpoch ||
            (l.board?.revision ?? 0) !== j.boardRevision;
          const definite = e?.definiteRejection === true && !j.providerId;
          mark(
            s,
            l,
            j,
            stale
              ? "stale"
              : controller.signal.aborted
                ? "cancelled"
                : "failed",
            stale
              ? "The lesson changed; this result was discarded."
              : controller.signal.aborted
                ? "Generation stopped. The provider may still charge for accepted work."
                : e instanceof BflError
                  ? e.message
                  : "The image provider could not finish. Your chart and saved lesson are unchanged.",
            returned
              ? "estimated"
              : definite || !j.submitted
                ? "released"
                : "unknown",
          );
        })
        .catch(() => {});
    }
  }

  async function generateAction(owner: string, input: Action) {
    const a = parseAction(input);
    if (a.type !== "illustration.generate")
      fail("unsupported", "Unknown illustration action.", 400);
    if (!uuid.test(a.targetId))
      fail("invalid_params", "Select a new illustration identity.", 400);
    const fingerprint = createHash("sha256").update(canonical(a)).digest("hex");
    const created = await store.transact(owner, (s) => {
      const l = check(s, a.sessionId),
        prior = l.receipts[a.actionId];
      if (prior) {
        const job = l.illustrations?.find((j) => j.actionId === a.actionId);
        if (job?.fingerprint !== fingerprint && prior.payload !== canonical(a))
          fail(
            "payload_conflict",
            "This request ID identifies different work.",
          );
        return { original: prior.receipt, job: null };
      }
      if (!enabled())
        fail(
          "provider_unavailable",
          "Illustrations are unavailable. Configure and enable BFL with paid-call cost controls.",
          503,
        );
      if (l.quiet)
        fail("paused", "Resume the lesson before requesting an illustration.");
      if (l.epoch !== a.turnEpoch)
        fail(
          "stale_turn",
          "This lesson turn changed. Try again from the current lesson.",
        );
      if ((l.board?.revision ?? 0) !== a.expectedRevision)
        fail(
          "stale_revision",
          "Your chart changed. Request the illustration again.",
        );
      if (s.lessons.some((other) => other.illustrations?.some(pending)))
        fail("busy", "Wait for or cancel the current illustration.", 409);
      if (
        s.usedIllustrationIds?.includes(a.targetId) ||
        s.lessons.some((other) =>
          other.illustrations?.some((j) => j.id === a.targetId),
        )
      )
        fail("payload_conflict", "This illustration identity is already used.");
      const now = Date.now(),
        j: IllustrationJob = {
          id: a.targetId,
          actionId: a.actionId,
          fingerprint,
          turnEpoch: a.turnEpoch,
          boardRevision: a.expectedRevision,
          prompt: String(a.args.prompt).trim(),
          purpose: String(a.args.purpose).trim(),
          title: String(a.args.title).trim(),
          status: "queued",
          model: config.illustrations.model,
          fixture,
          createdAt: now,
          updatedAt: now,
          estimateUsd: config.illustrations.priceUsd,
          priceVersion: config.illustrations.priceVersion,
          costState: "reserved",
          passId: "",
          storageKey: `${owner}/${l.courseId}/illustrations/${l.id}/${a.targetId}`,
        };
      if (j.prompt.length < 8 || j.purpose.length < 5 || !j.title)
        fail(
          "invalid_params",
          "Describe the illustration and what it should explain.",
          400,
        );
      reserveImage(
        s,
        j,
        Number(process.env.SPEND_CEILING_USD ?? 7.6),
        config.illustrations.dailyLimit,
      );
      (s.usedIllustrationIds ??= []).push(j.id);
      (l.illustrations ??= []).push(j);
      l.receipts[a.actionId] = { payload: canonical(a), receipt: receipt(j) };
      return { job: j, original: null };
    });
    if (!created.job) return created.original;
    const controller = new AbortController();
    const done = execute(
      owner,
      a.sessionId,
      created.job.id,
      controller,
    ).finally(() => active.delete(key(owner, created.job!.id)));
    active.set(key(owner, created.job.id), {
      lessonId: a.sessionId,
      controller,
      done,
    });
    return receipt(created.job);
  }
  function abortLesson(owner: string, lessonId: string) {
    // Confirmed ready images remain; pending provider work is never replayed.
    for (const [k, running] of active)
      if (k.startsWith(owner + ":") && running.lessonId === lessonId)
        running.controller.abort();
  }
  function purgeLessons(s: State, lessons: Lesson[]) {
    for (const l of lessons)
      for (const j of l.illustrations ?? []) {
        if (pending(j))
          mark(
            s,
            l,
            j,
            "cancelled",
            "Illustration removed.",
            j.submitted ? "unknown" : "released",
          );
        queuePurge(s, j);
      }
    for (const l of lessons) l.illustrations = [];
  }

  app.get<{ Params: { id: string } }>(
    "/api/lessons/:id/illustrations",
    async (req) => {
      const actor = await auth(req);
      return store.transact(actor.owner, (s) => {
        const l = check(s, req.params.id);
        for (const j of l.illustrations ?? [])
          if (pending(j) && !active.has(key(actor.owner, j.id)))
            mark(
              s,
              l,
              j,
              "failed",
              "The server restarted before the result was confirmed. Check provider billing before retrying.",
              j.submitted ? "unknown" : "released",
            );
        return {
          items: (l.illustrations ?? []).map((j) => show(l, j)),
          available: enabled(),
          estimateUsd: estimateUsd(),
        };
      });
    },
  );
  app.get<{ Params: { id: string; imageId: string } }>(
    "/api/lessons/:id/illustrations/:imageId/content",
    async (req, rep) => {
      const actor = await auth(req);
      const job = await store.transact(actor.owner, (s) => {
        const l = check(s, req.params.id),
          j = l.illustrations?.find((j) => j.id === req.params.imageId);
        if (!j || j.status !== "ready")
          fail("not_found", "Illustration unavailable.", 404);
        return j;
      });
      let bytes: Buffer;
      try {
        if (storage) {
          const r = await storage.storage
            .from("course-originals")
            .download(job.storageKey!);
          if (r.error) throw r.error;
          bytes = Buffer.from(await r.data.arrayBuffer());
        } else bytes = await readFile(blobPath(actor.owner, job.id));
      } catch {
        fail(
          "source_unavailable",
          "The saved illustration could not be read.",
          503,
        );
      }
      await store.transact(actor.owner, (s) => {
        const l = check(s, req.params.id);
        if (
          !l.illustrations?.some((j) => j.id === job.id && j.status === "ready")
        )
          fail("not_found", "Illustration removed.", 404);
      });
      return rep
        .header("Content-Type", job.mime!)
        .header("Content-Disposition", "inline")
        .send(bytes);
    },
  );
  app.delete<{ Params: { id: string; imageId: string } }>(
    "/api/lessons/:id/illustrations/:imageId",
    async (req) => {
      const actor = await auth(req);
      const job = await store.transact(actor.owner, (s) => {
        const l = check(s, req.params.id),
          j = l.illustrations?.find((j) => j.id === req.params.imageId);
        if (!j) fail("not_found", "Illustration unavailable.", 404);
        active.get(key(actor.owner, j.id))?.controller.abort();
        if (pending(j))
          mark(
            s,
            l,
            j,
            "cancelled",
            "Generation stopped. Accepted provider work may still be charged.",
            j.submitted ? "unknown" : "released",
          );
        else j.status = "cancelled";
        j.prompt = "[Removed]";
        j.purpose = "[Removed]";
        j.title = "Removed illustration";
        const saved = l.receipts[j.actionId];
        if (saved)
          saved.payload = canonical({
            type: "illustration.generate",
            actionId: j.actionId,
            turnEpoch: j.turnEpoch,
            expectedRevision: j.boardRevision,
            fingerprint: j.fingerprint,
          });
        queuePurge(s, j);
        return j;
      });
      let purged = false;
      try {
        await removeBlob(actor.owner, job);
        purged = true;
      } catch {}
      if (purged)
        await store.transact(actor.owner, (s) => {
          for (const p of s.purges ?? [])
            if (p.kind === "illustration" && p.versionId === job.id)
              p.status = "complete";
        });
      return { revoked: true, purge: purged ? "complete" : "pending" };
    },
  );
  return {
    generateAction,
    abortLesson,
    purgeLessons,
    available: enabled,
    estimateUsd,
    close: async () => {
      for (const r of active.values()) r.controller.abort();
      await Promise.allSettled([...active.values()].map((r) => r.done));
    },
  };
}
