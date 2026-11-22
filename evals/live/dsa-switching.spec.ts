import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile, open, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

type Seed = {
  kind: string;
  courseId: string;
  lessonId: string;
  url: string;
  sources: { id: string; name: string; versionId: string; hash: string }[];
};
type Expected = {
  sourceId: string;
  versionId: string;
  algorithm: string;
  step: number;
  targetValue?: number;
};
const sha = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const reportPath = path.resolve("evals/live/results/dsa-switching.json");

/** SAPI commonly writes an 18-byte fmt chunk. Walk RIFF chunks, never slice44. */
function pcm16k(wav: Buffer) {
  if (
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 12) !== "WAVE"
  )
    throw Error("Expected a RIFF/WAVE offline speech file.");
  let format = false,
    pcm: Buffer | undefined;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const name = wav.toString("ascii", offset, offset + 4),
      size = wav.readUInt32LE(offset + 4),
      start = offset + 8;
    if (start + size > wav.length)
      throw Error("Truncated offline speech WAV chunk.");
    if (name === "fmt ") {
      if (
        size < 16 ||
        wav.readUInt16LE(start) !== 1 ||
        wav.readUInt16LE(start + 2) !== 1 ||
        wav.readUInt32LE(start + 4) !== 16000 ||
        wav.readUInt16LE(start + 14) !== 16
      )
        throw Error("Offline speech must be PCM16, mono,16000Hz.");
      format = true;
    }
    if (name === "data") pcm = wav.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!format || !pcm?.length || pcm.length % 2 || pcm.length > 16000 * 2 * 15)
    throw Error("Use a nonempty offline speech clip under15 seconds.");
  return pcm;
}
async function rootReview() {
  let history: any = { runs: [] };
  try {
    history = JSON.parse(await readFile(reportPath, "utf8"));
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!Array.isArray(history.runs))
    throw Error(
      "The switching history is invalid; preserve it for root review.",
    );
  const providerAttempts = history.runs.filter(
    (run: any) => run.providerAttempted === true,
  ).length;
  if (providerAttempts >= 4 || history.runs.some((run: any) => run.passed))
    throw Error(
      "No further paid run is allowed after a pass or four provider attempts. The fourth attempt requires its exact one-use user approval; all earlier history must remain intact.",
    );
  const runNumber = history.runs.length + 1,
    reason = process.env.DSA_SWITCHING_ROOT_REVIEW_REASON?.trim() ?? "",
    fix = process.env.DSA_SWITCHING_REVIEWED_FIX?.trim() ?? "";
  if (
    process.env.RUN_PAID_DSA_SWITCHING !== "true" ||
    process.env.DSA_SWITCHING_ROOT_REVIEW_RUN !== String(runNumber) ||
    reason.length < 20 ||
    reason.length > 500
  )
    throw Error(
      `Before provider access, root must explicitly set RUN_PAID_DSA_SWITCHING=true, DSA_SWITCHING_ROOT_REVIEW_RUN=${runNumber}, and a concrete DSA_SWITCHING_ROOT_REVIEW_REASON of20–500 characters.`,
    );
  if (providerAttempts > 0 && (fix.length < 20 || fix.length > 500))
    throw Error(
      "Each retry needs a concrete reviewed product fix in DSA_SWITCHING_REVIEWED_FIX. No automatic retries or cap resets.",
    );
  let approvedExtension: Record<string, unknown> | undefined;
  if (providerAttempts === 3) {
    const preflights = history.runs.filter((run: any) => run.providerAttempted !== true);
    if (
      runNumber !== 6 ||
      preflights.length !== 2 ||
      preflights.some((run: any, index: number) =>
        run.runNumber !== index + 1 ||
        run.preflightReportingCorrection?.providerAttempted !== false ||
        run.preflightReportingCorrection?.providerCalls !== 0 ||
        run.preflightReportingCorrection?.mutationAttempted !== false,
      ) ||
      history.runs.some((run: any) => run.passed !== false) ||
      process.env.DSA_SWITCHING_APPROVED_EXTENSION !== "true"
    )
      throw Error(
        "The one approved extension permits only history run6 / provider attempt4, preserving two preflights and three failed provider attempts. No automatic retry is authorized.",
      );
    const approvalPath = path.resolve(".data/dsa-budget-approval.json"),
      evidencePath = path.resolve("evals/live/results/dsa-budget-approved-change.json"),
      approvalBytes = await readFile(approvalPath),
      approval = JSON.parse(approvalBytes.toString("utf8")),
      token = process.env.DSA_SWITCHING_APPROVAL_TOKEN?.trim();
    if (
      !token ||
      approval.approvalToken !== token ||
      approval.userApproved !== true ||
      approval.approvedProviderAttempt !== 4 ||
      approval.approvedHistoryRun !== 6 ||
      approval.voiceLimitSeconds !== 120 ||
      approval.voiceInputTextLimit !== 160000 ||
      approval.dollarBudget !== 7.6 ||
      typeof approval.approvedAt !== "string" ||
      !Number.isFinite(Date.parse(approval.approvedAt)) ||
      approval.maintenance?.completed !== true ||
      approval.maintenance.evidencePath !== "evals/live/results/dsa-budget-approved-change.json" ||
      !/^[a-f0-9]{64}$/.test(approval.maintenance.evidenceSha256 ?? "")
    )
      throw Error("The exact user approval and completed, hash-verified maintenance evidence are required before the fourth provider attempt.");
    const evidenceBytes = await readFile(evidencePath),
      evidenceSha256 = sha(evidenceBytes),
      evidence = JSON.parse(evidenceBytes.toString("utf8"));
    if (
      evidenceSha256 !== approval.maintenance.evidenceSha256 ||
      evidence.completed !== true ||
      evidence.approvalToken !== token ||
      evidence.approvedHistoryRun !== 6 ||
      evidence.approvedProviderAttempt !== 4 ||
      evidence.voiceLimitSeconds !== 120 ||
      evidence.oldInputTextLimit !== 80000 ||
      evidence.newInputTextLimit !== 160000 ||
      evidence.ceilingUsd !== 7.6 ||
      evidence.blockedReasonBefore !== "provider_unit_ceiling_exceeded" ||
      evidence.blockedReasonAfter !== null ||
      evidence.reservationsPreserved !== true ||
      evidence.stateExceptReviewedBlockPreserved !== true ||
      evidence.allOtherEnvironmentBytesPreserved !== true ||
      evidence.usageEventsMatched !== 15 ||
      evidence.providerCalls !== 0
    )
      throw Error("Maintenance evidence must prove only the approved TEXT allowance and reviewed pause changed, with all usage and the7.6 budget preserved.");
    let configuredTextLimit: unknown;
    try {
      configuredTextLimit = JSON.parse(process.env.MODEL_UNIT_LIMITS_JSON ?? "null")?.live?.input?.TEXT;
    } catch {
      throw Error("The current unit-limit configuration is invalid; no provider access is permitted.");
    }
    if (
      configuredTextLimit !== 160000 ||
      !process.env.SPEND_CEILING_USD?.trim() ||
      Number(process.env.SPEND_CEILING_USD) !== 7.6
    )
      throw Error("The approved extension requires the current live TEXT input limit160000 and unchanged dollar ceiling7.6.");
    approvedExtension = {
      kind: "explicit-user-approved-one-use-extension",
      approvedAt: approval.approvedAt,
      approvedHistoryRun: 6,
      approvedProviderAttempt: 4,
      priorProviderAttempts: providerAttempts,
      maximumProviderAttempts: 4,
      voiceLimitSeconds: 120,
      oldVoiceInputTextLimit: 80000,
      voiceInputTextLimit: 160000,
      dollarBudget: 7.6,
      approvalArtifactPath: ".data/dsa-budget-approval.json",
      approvalArtifactSha256: sha(approvalBytes),
      approvalTokenSha256: sha(token),
      maintenanceEvidencePath: approval.maintenance.evidencePath,
      maintenanceEvidenceSha256: evidenceSha256,
      automaticRetryAuthorized: false,
    };
  }
  return { history, runNumber, reason, fix, providerAttempts, approvedExtension };
}

test("real voice switches owned DSA sources, waits for paint, paces each step and preserves the original notebook", async ({
  page,
  browser,
}) => {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const lockPath = path.resolve(".data/dsa-switching.lock"),
    lock = await open(lockPath, "wx");
  let history: any,
    report: any,
    lessonId = "",
    voiceStarted = false,
    originalBoardHash: string | undefined;
  const api = async (url: string, method = "GET", data?: unknown) => {
    const response = await page.request.fetch(url, {
      method,
      data,
      headers: { Origin: "http://localhost:3000" },
    });
    expect(response.ok(), `${method} ${url}: ${response.status()}`).toBe(true);
    return response.json();
  };
  let seed: Seed | undefined;
  const snapshot = async () => (await api(`/api/lessons/${lessonId}`)).lesson;
  const save = async () => {
    if (history)
      await writeFile(reportPath, JSON.stringify(history, null, 2) + "\n");
  };
  try {
    const reviewed = await rootReview();
    history = reviewed.history;
    report = {
      runNumber: reviewed.runNumber,
      priorProviderAttempts: reviewed.providerAttempts,
      rootReviewReason: reviewed.reason,
      ...(reviewed.fix ? { reviewedProductFix: reviewed.fix } : {}),
      ...(reviewed.approvedExtension ? { approvedExtension: reviewed.approvedExtension } : {}),
      startedAt: new Date().toISOString(),
      kind: "real-provider-owned-notebook-dsa-switching",
      fixture: false,
      syntheticInput: true,
      humanParticipants: 0,
      browser: browser.version(),
      voiceLimitSeconds: 120,
      passed: false,
      providerAttempted: false,
      mutationAttempted: false,
      phases: [],
      gates: {
        humanMicrophone: "open",
        usefulAudibleExplanation: "open",
        humanSemanticTeachingReview: "open",
        humanInterruptionLatency: "open",
        twentyMinuteLesson: "open",
        invoiceReconciliation: "open",
      },
    };
    history.runs.push(report);
    await save();
    seed = JSON.parse(
      await readFile(path.resolve(".data/dsa-playground.json"), "utf8"),
    );
    expect(seed!.kind).toBe("synthetic-dsa-mock-course");
    expect(seed!.sources).toHaveLength(5);
    expect(new URL(seed!.url).origin).toBe("http://localhost:3000");
    report.courseId = seed!.courseId;
    report.originalLessonId = seed!.lessonId;
    const config = await api("/api/config");
    expect(config.mode).toBe("live");
    expect(config.authentication).toBe("local_test");
    expect(config.liveAvailable).toBe(true);
    expect((await api("/api/me")).remainingSeconds).toBeGreaterThanOrEqual(125);
    const course = await api(`/api/courses/${seed!.courseId}`);
    report.sourceHashes = [];
    for (const expected of seed!.sources) {
      const owned = course.sources.find(
        (source: any) => source.id === expected.id,
      );
      expect(owned?.status).toMatch(/^ready/);
      expect(owned.versionId).toBe(expected.versionId);
      const content = await page.request.get(
        `/api/sources/${expected.id}/versions/${expected.versionId}/content`,
      );
      expect(content.status()).toBe(200);
      expect(sha(await content.body())).toBe(expected.hash);
      report.sourceHashes.push({ ...expected, verified: true });
    }
    expect(
      course.sources.filter(
        (source: any) =>
          seed!.sources.some((item) => item.id === source.id) && source.dsa,
      ),
    ).toHaveLength(4);
    report.unselectedAdditionalSourceCount = course.sources.length - 5;
    originalBoardHash = sha(
      JSON.stringify(
        (await api(`/api/lessons/${seed!.lessonId}`)).lesson.board ?? null,
      ),
    );
    const clips = await Promise.all(
      ["tree", "bst"].map(async (name) => {
        const wav = await readFile(
            path.resolve(`.data/dsa-switching-audio/${name}.wav`),
          ),
          pcm = pcm16k(wav);
        return {
          name,
          pcm,
          wavHash: sha(wav),
          durationMs: Math.round(pcm.length / 32),
        };
      }),
    );
    report.audioInputs = clips.map(({ name, wavHash, durationMs }) => ({
      name,
      wavSha256: wavHash,
      durationMs,
      origin: "offline Windows SAPI synthetic speech",
      format: "PCM16 mono16000Hz",
    }));
    report.mutationAttempted = true;
    const created = await api("/api/lessons", "POST", {
      courseId: seed!.courseId,
      goal: "Show BFS on the undirected mock graph in 01-undirected-graph.json, at step zero. For every request, show the correct visual first, then say only one brief sentence about that displayed step. Wait for the learner to request each next step.",
    });
    expect(created.id).not.toBe(seed!.lessonId);
    lessonId = created.id;
    report.lessonId = lessonId;
    await api(`/api/lessons/${lessonId}/sources`, "PATCH", {
      sourceIds: seed!.sources.map((source) => source.id),
      expectedRevision: 0,
    });
    expect(
      (await api(`/api/lessons/${lessonId}/sources`)).selectedSources.sort(),
    ).toEqual(seed!.sources.map((source) => source.id).sort());
    report.selectedOnlyHashVerifiedMockSources = true;
    await page.addInitScript(
      ({ lessonId }) => {
        const w = window as any;
        const e: any = (w.__dsaSwitch = {
          phase: "initial-bfs",
          startedAt: 0,
          states: [],
          errors: [],
          toolErrors: [],
          toolDiagnostics: [],
          tools: [],
          audio: [],
          captions: [],
          captionChars: 0,
          captionClipped: 0,
          paints: [],
          fetchedBoard: null,
          lastPaint: null,
          audioPackets: 0,
          scheduledPackets: 0,
          activeSources: 0,
          stopCalls: 0,
          usage: [],
          usageDuplicateCount: 0,
          usageInvalidCount: 0,
          socketOpen: false,
          latestState: "",
          lastListeningAt: 0,
          lastPacketAt: 0,
          textRequests: 0,
          suppressedMicFrames: 0,
          injectedAudioFrames: 0,
          capExpired: false,
        });
        w.__dsaSwitchHashes = [];
        const numeric = (value: any) =>
          typeof value === "number" && Number.isFinite(value) && value >= 0
            ? value
            : null;
        const token = (value: any) =>
          typeof value === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(value)
            ? value
            : "unknown";
        const safeValidation = (rows: any[]) =>
          rows.slice(0, 8).map((row) => ({
            path:
              typeof row?.path === "string" &&
              /^[A-Za-z0-9_./~\[\]-]{0,160}$/.test(row.path)
                ? row.path
                : "[redacted-field-path]",
            keyword: token(row?.keyword),
            actualType: token(row?.actualType),
          }));
        const safeBoard = (board: any) =>
          board
            ? {
                id: board.id,
                revision: board.revision,
                sourceId: board.sourceId,
                sourceVersionId: board.sourceVersionId,
                kind: board.kind,
                algorithm: board.result?.algorithm,
                step: board.result?.stepIndex,
              }
            : null;
        const visible = () => ({
          confirmedPaint: e.lastPaint,
          header: document
            .querySelector(".visual-dsa .visual-heading h3")
            ?.textContent?.slice(0, 120),
          current: document
            .querySelector('[data-testid="dsa-current"]')
            ?.textContent?.slice(0, 120),
          frontier: document
            .querySelector('[data-testid="dsa-frontier"]')
            ?.textContent?.slice(0, 500),
          step: document
            .querySelector('[data-testid="dsa-step"]')
            ?.textContent?.slice(0, 500),
          nodeIds: [
            ...document.querySelectorAll(
              '[data-testid="dsa-svg"] [data-node-id]',
            ),
          ]
            .map((node) => node.getAttribute("data-node-id"))
            .slice(0, 31),
        });
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (input: any, init: any) => {
          const response = await nativeFetch(input, init),
            url = new URL(
              typeof input === "string" ? input : (input.url ?? String(input)),
              location.origin,
            ),
            method = init?.method ?? input?.method ?? "GET";
          if (
            response.ok &&
            url.pathname === `/api/lessons/${lessonId}` &&
            method === "GET"
          )
            try {
              e.fetchedBoard = safeBoard(
                (await response.clone().json()).lesson?.board,
              );
            } catch {}
          if (
            response.ok &&
            url.pathname === `/api/lessons/${lessonId}/paint` &&
            method === "POST"
          )
            try {
              const body = JSON.parse(init.body);
              e.lastPaint = {
                ...e.fetchedBoard,
                revision: body.revision,
                wallAt: Date.now(),
                at: performance.now(),
                phase: e.phase,
              };
              e.paints.push(e.lastPaint);
            } catch {}
          return response;
        };
        const Native = window.WebSocket,
          seenUsage = new Set<string>();
        class Observed extends Native {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            if (new URL(String(url)).pathname !== "/live") return;
            w.__dsaSwitchSocket = this;
            w.__dsaSwitchNativeSend = (data: any) =>
              Native.prototype.send.call(this, data);
            this.addEventListener("open", () => {
              e.socketOpen = true;
            });
            this.addEventListener("close", () => {
              e.socketOpen = false;
            });
            this.addEventListener("message", (event) => {
              try {
                const message = JSON.parse(String(event.data)),
                  at = performance.now(),
                  wallAt = Date.now();
                if (
                  typeof message.runId === "string" &&
                  !e.runDigest &&
                  !e.hashPending
                ) {
                  e.hashPending = true;
                  w.__dsaSwitchHashes.push(
                    crypto.subtle
                      .digest(
                        "SHA-256",
                        new TextEncoder().encode(message.runId),
                      )
                      .then((bytes) => {
                        e.runDigest = Array.from(new Uint8Array(bytes))
                          .map((value) => value.toString(16).padStart(2, "0"))
                          .join("");
                      }),
                  );
                }
                if (typeof message.turnEpoch === "number")
                  e.epoch = message.turnEpoch;
                if (message.type === "state") {
                  e.latestState = message.state;
                  e.states.push({
                    state: token(message.state),
                    phase: e.phase,
                    wallAt,
                    at,
                  });
                  if (message.state === "listening") e.lastListeningAt = at;
                }
                if (message.type === "error")
                  e.errors.push({
                    code: token(message.code),
                    phase: e.phase,
                    wallAt,
                  });
                if (message.type === "tool_diagnostic") {
                  const source = message.diagnostics ?? message,
                    diagnostics: any = {};
                  for (const key of [
                    "outcome",
                    "callDigest",
                    "actionIdDigest",
                    "turnEpoch",
                    "learnerTurn",
                    "providerGeneration",
                    "generation",
                    "revision",
                    "unknownFieldCount",
                    "kindCategory",
                    "algorithm",
                    "sourceMatch",
                    "sourceStructure",
                    "startNodeMember",
                    "startNodeIsRoot",
                    "algorithmCompatible",
                    "visualInFlight",
                    "visualCommitted",
                    "failureCount",
                    "code",
                    "retryable",
                    "failureCategory",
                  ]) {
                    const value = source[key];
                    if (
                      typeof value === "boolean" ||
                      (typeof value === "number" && Number.isFinite(value))
                    )
                      diagnostics[key] = value;
                    else if (typeof value === "string")
                      diagnostics[key] = token(value);
                  }
                  e.toolDiagnostics.push({
                    tool: token(message.tool ?? source.tool),
                    phase: e.phase,
                    wallAt,
                    at,
                    diagnostics,
                  });
                }
                if (message.type === "tool_error") {
                  const source = message.diagnostics ?? {},
                    diagnostics: any = {};
                  for (const key of [
                    "outcome",
                    "callDigest",
                    "turnEpoch",
                    "learnerTurn",
                    "unknownFieldCount",
                    "kindCategory",
                    "algorithm",
                    "sourceMatch",
                    "sourceStructure",
                    "startNodeMember",
                    "startNodeIsRoot",
                    "algorithmCompatible",
                    "visualInFlight",
                    "visualCommitted",
                    "failureCount",
                    "code",
                    "retryable",
                    "failureCategory",
                  ]) {
                    const value = source[key];
                    if (
                      typeof value === "boolean" ||
                      (typeof value === "number" && Number.isFinite(value))
                    )
                      diagnostics[key] = value;
                    else if (typeof value === "string")
                      diagnostics[key] = token(value);
                  }
                  if (Array.isArray(source.fieldsPresent))
                    diagnostics.fieldsPresent = source.fieldsPresent
                      .slice(0, 20)
                      .map(token);
                  if (Array.isArray(source.validationDiagnostics))
                    diagnostics.validationDiagnostics = safeValidation(
                      source.validationDiagnostics,
                    );
                  e.toolErrors.push({
                    tool: token(message.tool),
                    code: token(message.code),
                    retryable: message.retryable === true,
                    attempt: numeric(message.attempt),
                    phase: e.phase,
                    toolPhase: token(message.phase),
                    wallAt,
                    at,
                    diagnostics,
                  });
                }
                if (message.type === "tool")
                  e.tools.push({
                    name: token(message.name),
                    epoch: message.turnEpoch,
                    wallAt,
                    at,
                    phase: e.phase,
                    objectId: message.result?.objectId,
                    ...safeBoard(message.result?.board),
                    revision: message.result?.revision,
                  });
                if (message.type === "audio") {
                  e.audioPackets++;
                  e.lastPacketAt = at;
                  if (e.audio.length < 4000)
                    e.audio.push({
                      at,
                      wallAt,
                      epoch: message.turnEpoch,
                      phase: e.phase,
                    });
                }
                if (
                  message.type === "caption" &&
                  typeof message.text === "string"
                ) {
                  const remaining = 30000 - e.captionChars,
                    text = message.text.slice(
                      0,
                      Math.max(0, Math.min(1200, remaining)),
                    );
                  if (text) {
                    e.captionChars += text.length;
                    e.captions.push({
                      speaker:
                        message.speaker === "student" ? "student" : "tutor",
                      text,
                      phase: e.phase,
                      wallAt,
                      at,
                      visible: visible(),
                    });
                  }
                  if (text.length !== message.text.length) e.captionClipped++;
                }
                if (message.type === "usage") {
                  const usage = message.usage,
                    eventId = usage?.eventId;
                  if (
                    typeof eventId !== "string" ||
                    !/^[a-f0-9]{64}$/.test(eventId)
                  )
                    e.usageInvalidCount++;
                  else if (seenUsage.has(eventId)) e.usageDuplicateCount++;
                  else {
                    seenUsage.add(eventId);
                    const raw = usage.rawUsageMetadata ?? usage,
                      details = (rows: any) =>
                        Array.isArray(rows)
                          ? rows
                              .filter(
                                (row) =>
                                  [
                                    "TEXT",
                                    "AUDIO",
                                    "IMAGE",
                                    "DOCUMENT",
                                    "VIDEO",
                                    "UNKNOWN",
                                  ].includes(row?.modality) &&
                                  numeric(row.tokenCount) !== null,
                              )
                              .map((row) => ({
                                modality: row.modality,
                                tokenCount: row.tokenCount,
                              }))
                          : null;
                    const observation: any = {
                      wallAt,
                      phase: e.phase,
                      turnEpoch: numeric(usage.turnEpoch ?? message.turnEpoch),
                      turnSequence: numeric(message.turnSequence),
                      promptTokenCount: numeric(raw.promptTokenCount),
                      responseTokenCount: numeric(raw.responseTokenCount),
                      totalTokenCount: numeric(raw.totalTokenCount),
                      cachedContentTokenCount: numeric(
                        raw.cachedContentTokenCount,
                      ),
                      thoughtsTokenCount: numeric(raw.thoughtsTokenCount),
                      inputModalities: details(raw.promptTokensDetails),
                      outputModalities: details(raw.responseTokensDetails),
                      cachedModalities: details(raw.cacheTokensDetails),
                    };
                    e.usage.push(observation);
                    w.__dsaSwitchHashes.push(
                      crypto.subtle
                        .digest("SHA-256", new TextEncoder().encode(eventId))
                        .then((bytes) => {
                          observation.eventIdDigest = Array.from(
                            new Uint8Array(bytes),
                          )
                            .map((value) => value.toString(16).padStart(2, "0"))
                            .join("");
                        }),
                    );
                  }
                }
              } catch {
                e.errors.push({
                  code: "observation_parse_error",
                  phase: e.phase,
                  wallAt: Date.now(),
                });
              }
            });
          }
          send(data: Parameters<WebSocket["send"]>[0]) {
            if (typeof data !== "string") {
              e.suppressedMicFrames++;
              return;
            }
            try {
              if (JSON.parse(data).type === "text") e.textRequests++;
            } catch {}
            super.send(data);
          }
        }
        window.WebSocket = Observed;
        const make = AudioContext.prototype.createBufferSource;
        AudioContext.prototype.createBufferSource = function () {
          const node = make.call(this),
            start = node.start.bind(node),
            stop = node.stop.bind(node);
          node.addEventListener("ended", () => {
            e.activeSources = Math.max(0, e.activeSources - 1);
          });
          node.start = ((...args: any[]) => {
            e.scheduledPackets++;
            e.activeSources++;
            return (start as any)(...args);
          }) as typeof node.start;
          node.stop = ((...args: any[]) => {
            e.stopCalls++;
            return (stop as any)(...args);
          }) as typeof node.stop;
          return node;
        };
      },
      { lessonId },
    );
    await page.goto(`/lessons/${lessonId}`);
    await expect(
      page
        .locator(".topbar")
        .getByRole("button", { name: "Sources (5)", exact: true }),
    ).toBeVisible();
    expect((await snapshot()).id).toBe(lessonId);
    expect((await snapshot()).board).toBeUndefined();
    const tabs = page.getByRole("navigation", {
      name: "Notebook panels",
      exact: true,
    });
    if (await tabs.isVisible())
      await tabs.getByRole("button", { name: "Chat", exact: true }).click();
    const start = page.getByRole("button", { name: "Start live", exact: true });
    await expect(start).toBeEnabled();
    await page.evaluate(() => {
      const w = window as any;
      w.__dsaSwitch.startedAt = performance.now();
      w.__dsaSwitchCap = setTimeout(() => {
        w.__dsaSwitch.capExpired = true;
        const socket = w.__dsaSwitchSocket;
        if (socket?.readyState === 1) {
          w.__dsaSwitchNativeSend(JSON.stringify({ type: "end" }));
          socket.close(1000, "bounded_switching_end");
        }
      }, 120000);
    });
    report.providerAttempted = true;
    report.providerAttemptNumber = reviewed.providerAttempts + 1;
    voiceStarted = true;
    await start.click();
    let boardId = "";
    const metrics = async () => {
      const digest = await page.evaluate(
        () => (window as any).__dsaSwitch.runDigest,
      );
      return (
        await readFile(
          path.resolve(process.env.DATA_DIR ?? ".data", "live-metrics.jsonl"),
          "utf8",
        )
      )
        .split(/\r?\n/)
        .flatMap((line) => {
          try {
            const event = JSON.parse(line);
            return event.runId === digest && event.fixture === false
              ? [event]
              : [];
          } catch {
            return [];
          }
        });
    };
    const finish = async (
      name: string,
      expected: Expected,
      baseline: {
        packets: number;
        scheduled: number;
        at: number;
        wallAt: number;
        tools: number;
        mode: string;
      },
    ) => {
      await expect
        .poll(
          async () => {
            const board = (await snapshot()).board;
            return board
              ? [
                  board.sourceId,
                  board.sourceVersionId,
                  board.result.algorithm,
                  board.result.stepIndex,
                ]
              : null;
          },
          { timeout: 18000 },
        )
        .toEqual([
          expected.sourceId,
          expected.versionId,
          expected.algorithm,
          expected.step,
        ]);
      const board = (await snapshot()).board;
      if (expected.targetValue !== undefined)
        expect(board.result.targetValue).toBe(expected.targetValue);
      if (board.result.kind === "graph")
        expect(board.result.steps[0].frontierIds[0]).toBe("A");
      if (!boardId) boardId = board.id;
      expect(board.id).toBe(boardId);
      await expect(page.getByTestId("dsa-svg")).toBeVisible();
      await expect
        .poll(async () => (await snapshot()).paintedRevision, { timeout: 5000 })
        .toBe(board.revision);
      await expect
        .poll(
          () =>
            page.evaluate(
              (revision) =>
                (window as any).__dsaSwitch.tools.some(
                  (tool: any) =>
                    tool.revision === revision &&
                    ["board.create", "board.replace", "board.patch"].includes(
                      tool.name,
                    ),
                ),
              board.revision,
            ),
          { timeout: 3000 },
        )
        .toBe(true);
      const receipt = await page.evaluate(
        (revision) =>
          (window as any).__dsaSwitch.tools.find(
            (tool: any) =>
              tool.revision === revision &&
              ["board.create", "board.replace", "board.patch"].includes(
                tool.name,
              ),
          ),
        board.revision,
      );
      expect(receipt.objectId).toBe(boardId);
      expect(receipt.sourceId).toBe(expected.sourceId);
      expect(receipt.sourceVersionId).toBe(expected.versionId);
      const current = board.result.steps[expected.step],
        label = (id: string) =>
          board.result.nodes.find((node: any) => node.id === id)?.label ?? id;
      await expect(page.getByTestId("dsa-current")).toHaveText(
        current.currentId ? label(current.currentId) : "None yet",
      );
      await expect(page.getByTestId("dsa-frontier")).toHaveText(
        current.frontierIds.length
          ? current.frontierIds.map(label).join(" · ")
          : "Empty",
      );
      let ordering: any;
      await expect
        .poll(
          async () => {
            try {
              const rows = (await metrics()).filter(
                (event: any) =>
                  event.turnEpoch === receipt.epoch &&
                  event.at >= baseline.wallAt,
              );
              const paint = rows.find(
                (event: any) =>
                  event.name === "board_render_proxy" &&
                  event.at >= receipt.wallAt - 250,
              );
              const completed = rows.find(
                (event: any) =>
                  event.name === "tool_completed" &&
                  [
                    receipt.name,
                    ...(receipt.name === "board.patch" ? [] : ["other"]),
                  ].includes(event.code) &&
                  paint &&
                  event.at >= paint.at,
              );
              const audio = rows.find(
                (event: any) =>
                  event.name === "audio_packet" &&
                  completed &&
                  event.at >= completed.at,
              );
              if (!paint || !completed || !audio) return false;
              ordering = {
                authenticatedPaintMetricAt: paint.at,
                toolResponseCompletedAt: completed.at,
                postReceiptPcmAt: audio.at,
              };
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 18000 },
        )
        .toBe(true);
      await expect
        .poll(
          () =>
            page.evaluate(
              ({ baseline, epoch }) => {
                const e = (window as any).__dsaSwitch;
                return (
                  e.socketOpen &&
                  !e.capExpired &&
                  e.errors.length === 0 &&
                  e.epoch === epoch &&
                  e.audioPackets > baseline.packets &&
                  e.scheduledPackets > baseline.scheduled &&
                  e.latestState === "listening" &&
                  e.lastListeningAt >= e.lastPacketAt &&
                  e.activeSources === 0 &&
                  performance.now() - e.lastPacketAt >= 600
                );
              },
              { baseline, epoch: receipt.epoch },
            ),
          { timeout: 22000 },
        )
        .toBe(true);
      // Intentional observation interval: late auto-advance must not pass after
      // an early correct frame or first PCM packet.
      await page.waitForTimeout(800);
      const settled = (await snapshot()).board;
      expect([
        settled.id,
        settled.sourceId,
        settled.sourceVersionId,
        settled.revision,
        settled.result.algorithm,
        settled.result.stepIndex,
      ]).toEqual([
        boardId,
        expected.sourceId,
        expected.versionId,
        board.revision,
        expected.algorithm,
        expected.step,
      ]);
      const evidence = await page.evaluate(() => (window as any).__dsaSwitch);
      expect(evidence.errors).toEqual([]);
      expect(evidence.stopCalls).toBe(0);
      expect(evidence.activeSources).toBe(0);
      const mutations = evidence.tools
        .slice(baseline.tools)
        .filter((tool: any) =>
          ["board.create", "board.replace", "board.patch"].includes(tool.name),
        );
      expect(mutations).toHaveLength(1);
      const paint = evidence.paints.find(
        (event: any) =>
          event.revision === board.revision && event.id === boardId,
      );
      expect(paint).toBeTruthy();
      const captions = evidence.captions.filter(
        (caption: any) => caption.at >= baseline.at,
      );
      const student = captions
        .filter((caption: any) => caption.speaker === "student")
        .map((caption: any) => caption.text)
        .join("");
      if (baseline.mode === "audio") {
        expect(student.trim().length).toBeGreaterThan(0);
        expect(student.toLowerCase()).toMatch(/tree/);
      }
      const result = {
        name,
        inputMode: baseline.mode,
        sourceId: expected.sourceId,
        sourceVersionId: expected.versionId,
        boardId,
        revision: board.revision,
        algorithm: expected.algorithm,
        targetValue: board.result.targetValue ?? null,
        stepIndex: expected.step,
        elapsedMs: Math.round(evidence.lastListeningAt - baseline.at),
        toolReceipt: receipt,
        paintAck: paint,
        ordering,
        newPcmPackets: evidence.audioPackets - baseline.packets,
        prePaintPcmPackets: evidence.audio.filter(
          (packet: any) => packet.at >= baseline.at && packet.at < paint.at,
        ).length,
        postReceiptPcmPackets: evidence.audio.filter(
          (packet: any) => packet.at >= paint.at && packet.at >= receipt.at,
        ).length,
        playbackDrained: true,
        noAutoAdvanceAfterDrain: true,
        quietObservationMs: 800,
        toolErrors: evidence.toolErrors.filter(
          (error: any) => error.at >= baseline.at,
        ),
        captions,
        semanticReview:
          "Bounded synthetic-only captions carry the actual visible board snapshot. Root must review whether each explanation describes that current visual; PCM/paint are not human semantic or audibility proof.",
      };
      return result;
    };
    const input = async (name: string, text?: string, clip?: Buffer) => {
      const state = await page.evaluate((name) => {
        const e = (window as any).__dsaSwitch;
        e.phase = name;
        return {
          packets: e.audioPackets,
          scheduled: e.scheduledPackets,
          at: performance.now(),
          wallAt: Date.now(),
          tools: e.tools.length,
          open: e.socketOpen,
          active: e.activeSources,
          errors: e.errors,
        };
      }, name);
      expect(state.open).toBe(true);
      expect(state.active).toBe(0);
      expect(state.errors).toEqual([]);
      if (clip) {
        await page.evaluate(async (encoded) => {
          const w = window as any,
            raw = Uint8Array.from(atob(encoded), (character) =>
              character.charCodeAt(0),
            );
          for (let offset = 0; offset < raw.length; offset += 640) {
            if (w.__dsaSwitchSocket?.readyState !== 1)
              throw Error("Voice closed during offline speech injection.");
            const frame = new Uint8Array(640);
            frame.set(raw.subarray(offset, offset + 640));
            w.__dsaSwitchNativeSend(frame.buffer);
            w.__dsaSwitch.injectedAudioFrames++;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          w.__dsaSwitchNativeSend(JSON.stringify({ type: "audio_end" }));
        }, clip.toString("base64"));
      } else
        await page.evaluate(
          (text) =>
            (window as any).__dsaSwitchSocket.send(
              JSON.stringify({ type: "text", text }),
            ),
          text,
        );
      return { ...state, mode: clip ? "audio" : "live-text" };
    };
    const graph = seed!.sources[0],
      tree = seed!.sources[2],
      bst = seed!.sources[3];
    report.phases.push(
      await finish(
        "initial-bfs",
        {
          sourceId: graph.id,
          versionId: graph.versionId,
          algorithm: "bfs",
          step: 0,
        },
        {
          packets: 0,
          scheduled: 0,
          at: 0,
          wallAt: Date.parse(report.startedAt),
          tools: 0,
          mode: "initial-goal",
        },
      ),
    );
    await save();
    report.phases.push(
      await finish(
        "bfs-next",
        {
          sourceId: graph.id,
          versionId: graph.versionId,
          algorithm: "bfs",
          step: 1,
        },
        await input(
          "bfs-next",
          "Next step, please. Show only that step and say one short sentence.",
        ),
      ),
    );
    await save();
    report.phases.push(
      await finish(
        "dfs-same-graph",
        {
          sourceId: graph.id,
          versionId: graph.versionId,
          algorithm: "dfs",
          step: 0,
        },
        await input(
          "dfs-same-graph",
          "Show DFS on the same undirected graph, starting at step zero. Explain only that displayed step in one short sentence.",
        ),
      ),
    );
    await save();
    report.phases.push(
      await finish(
        "binary-tree-inorder",
        {
          sourceId: tree.id,
          versionId: tree.versionId,
          algorithm: "inorder",
          step: 0,
        },
        await input("binary-tree-inorder", undefined, clips[0].pcm),
      ),
    );
    await save();
    report.phases.push(
      await finish(
        "bst-search-ready",
        {
          sourceId: bst.id,
          versionId: bst.versionId,
          algorithm: "search",
          step: 0,
          targetValue: 7,
        },
        await input("bst-search-ready", undefined, clips[1].pcm),
      ),
    );
    await save();
    const searchSteps = [];
    for (let step = 1; step <= 4; step++)
      searchSteps.push(
        await finish(
          `bst-next-${step}`,
          {
            sourceId: bst.id,
            versionId: bst.versionId,
            algorithm: "search",
            step,
            targetValue: 7,
          },
          await input(
            `bst-next-${step}`,
            "Next step only, please. Say one brief sentence about this comparison.",
          ),
        ),
      );
    report.phases.push({ name: "bst-search-path", steps: searchSteps });
    expect((await snapshot()).board.result.foundId).toBe("n7");
    await page.setViewportSize({ width: 360, height: 800 });
    const mobileTabs = page.getByRole("navigation", {
      name: "Notebook panels",
      exact: true,
    });
    if (await mobileTabs.isVisible())
      await mobileTabs
        .getByRole("button", { name: "Studio", exact: true })
        .click();
    const stop = page
      .getByRole("button", { name: "Stop voice", exact: true })
      .first();
    await expect(stop).toBeInViewport({ ratio: 1 });
    const bounds = await stop.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await stop.click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__dsaSwitch.socketOpen), {
        timeout: 4000,
      })
      .toBe(false);
    report.mobileStopReachable = true;
    report.passed = true;
    report.demoUrl = `http://localhost:3000/lessons/${lessonId}`;
  } catch (error) {
    if (report) {
      report.failure = error instanceof Error ? error.message : String(error);
      report.passed = false;
    }
    throw error;
  } finally {
    if (voiceStarted) {
      await page
        .getByRole("button", { name: "Stop voice", exact: true })
        .first()
        .click({ timeout: 1000 })
        .catch(() => {});
      await page
        .evaluate(() => {
          const w = window as any;
          clearTimeout(w.__dsaSwitchCap);
          if (w.__dsaSwitchSocket?.readyState === 1) {
            w.__dsaSwitchNativeSend(JSON.stringify({ type: "end" }));
            w.__dsaSwitchSocket.close(1000, "test_complete");
          }
        })
        .catch(() => {});
    }
    if (report) {
      await page
        .evaluate(async () => {
          await Promise.all((window as any).__dsaSwitchHashes ?? []);
        })
        .catch(() => {});
      report.browserEvidence = await page
        .evaluate(() => (window as any).__dsaSwitch ?? null)
        .catch(() => null);
      if (
        report.providerAttempted &&
        (!report.browserEvidence?.usage.length ||
          report.browserEvidence.usageInvalidCount ||
          report.browserEvidence.errors.length ||
          report.browserEvidence.capExpired)
      )
        report.passed = false;
      if (originalBoardHash === undefined)
        report.originalBoardPreserved = "not_measured_preflight";
      if (seed) {
        try {
          if (originalBoardHash !== undefined) {
            const original = (await api(`/api/lessons/${seed.lessonId}`))
              .lesson;
            report.originalBoardPreserved =
              sha(JSON.stringify(original.board ?? null)) === originalBoardHash;
          }
          const course = await api(`/api/courses/${seed.courseId}`);
          report.seededSourcesPreserved = seed.sources.every((expected) =>
            course.sources.some(
              (source: any) =>
                source.id === expected.id &&
                source.versionId === expected.versionId,
            ),
          );
          if (
            (originalBoardHash !== undefined &&
              report.originalBoardPreserved !== true) ||
            !report.seededSourcesPreserved
          )
            report.passed = false;
        } catch {
          report.originalPreservationCheckFailed = true;
          report.passed = false;
        }
      }
      if (lessonId && !report.passed) {
        try {
          const removed = await page.request.delete(
            `/api/lessons/${lessonId}`,
            { headers: { Origin: "http://localhost:3000" } },
          );
          report.failedLessonDeleted = removed.ok();
        } catch {
          report.failedLessonDeleted = false;
        }
        delete report.demoUrl;
      } else if (lessonId) {
        report.passedLessonRetained = true;
      }
      report.finishedAt = new Date().toISOString();
      report.usageNote =
        "Numeric provider usage retained by unique event ID/epoch/turn. Periodic or cumulative observations are not summed into invoices.";
      report.preflightOnly = report.providerAttempted !== true;
      report.measurement = report.providerAttempted
        ? "Real provider execution was attempted; inspect captured PCM, ASR and paint evidence for completed phases. No human microphone, human audibility or invoice claim."
        : "Infrastructure preflight only. No provider session was attempted, no provider audio or ASR was measured, and no model usage is claimed.";
      report.syntheticCaptionPolicy = report.selectedOnlyHashVerifiedMockSources
        ? "Only the five byte-hash-verified mock sources were selected on a fresh lesson. Bounded captions are acceptance evidence for root review, not operational telemetry."
        : "Source verification or lesson setup did not complete; no synthetic-caption acceptance evidence is claimed.";
      await save();
    }
    await lock.close();
    await unlink(lockPath);
  }
  expect(report?.passed).toBe(true);
  expect(report?.originalBoardPreserved).toBe(true);
  expect(report?.seededSourcesPreserved).toBe(true);
});
