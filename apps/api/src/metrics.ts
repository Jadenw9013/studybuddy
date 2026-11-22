import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const names = new Set([
  "session_started",
  "session_settled",
  "provider_connected",
  "reconnect_started",
  "provider_interrupt",
  "local_interrupt",
  "speech_end",
  "useful_audio",
  "correct_visible_chart",
  "playback_silence",
  "audio_scheduled_proxy",
  "board_render_proxy",
  "audio_packet",
  "frame_sent",
  "tool_completed",
  "usage",
  "error",
  "budget_blocked",
  "reservation_reconciled",
]);
const numbers = new Set([
  "at",
  "turnEpoch",
  "turnSequence",
  "elapsedMs",
  "activeSeconds",
  "reservedSeconds",
  "remainingSeconds",
  "revision",
  "promptTokenCount",
  "responseTokenCount",
  "totalTokenCount",
  "cachedContentTokenCount",
  "inputTextTokens",
  "inputAudioTokens",
  "inputImageTokens",
  "outputTextTokens",
  "outputAudioTokens",
  "estimatedUsd",
  "maximumUsd",
]);
const identifiers = new Set([
  "runId",
  "meterId",
  "eventId",
  "actionId",
  "lessonId",
  "ownerId",
]);
const codes = new Set([
  "board.create",
  "board.patch",
  "board.replace",
  "board.undo",
  "course.search",
  "source.open",
  "practice.present",
  "pause",
  "end",
  "client_closed",
  "connection_lost",
  "quota_exhausted",
  "connection_slow",
  "provider_unavailable",
  "provider_start_failed",
  "provider_event_failed",
  "tool_failed",
  "payload_conflict",
  "learner_turn_limit",
  "visual_busy",
  "meter_settlement_pending",
  "connection_or_budget_closed",
  "reservation_expired",
  "authorization_revoked",
  "meter_heartbeat_failed",
  "voice_state_unavailable",
  "audio_rate_exceeded",
  "pass_cost_ceiling_exceeded",
  "provider_unit_ceiling_exceeded",
  "provider_usage_missing",
  "abandoned_usage_requires_reconciliation",
  "cost_controls_unconfigured",
]);

/** Return only documented operational fields. Unknown keys/nested values are never logged. */
export function sanitizeMetric(
  value: unknown,
): Record<string, string | number | boolean> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.name !== "string" || !names.has(input.name)) return null;
  const output: Record<string, string | number | boolean> = {
    name: input.name,
    fixture: input.fixture !== false,
  };
  for (const [key, data] of Object.entries(input)) {
    if (
      numbers.has(key) &&
      typeof data === "number" &&
      Number.isFinite(data) &&
      data >= 0 &&
      data <= 1e15
    )
      output[key] = data;
    else if (
      identifiers.has(key) &&
      typeof data === "string" &&
      data.length > 0 &&
      data.length <= 256
    )
      output[key] = createHash("sha256").update(data).digest("hex");
    else if (key === "code" && typeof data === "string")
      output.code = codes.has(data) ? data : "other";
    else if (
      key === "model" &&
      typeof data === "string" &&
      /^(gemini-[a-z0-9_.-]+|synthetic-unit-model)$/.test(data) &&
      data.length <= 100
    )
      output.model = data;
    else if (
      (key === "resumed" || key === "clientReported") &&
      typeof data === "boolean"
    )
      output[key] = data;
  }
  return output;
}

/** Optional local JSONL sink, serialized to keep events intact; no raw error payloads. */
export function createMetricsWriter(file?: string) {
  let queue: Promise<void> = Promise.resolve();
  let ready: Promise<void> | undefined;
  const destination = file ? path.resolve(file) : undefined;
  const write = (event: unknown): Promise<void> => {
    const safe = sanitizeMetric(event);
    if (!safe || !destination) return Promise.resolve();
    const line = JSON.stringify(safe) + "\n";
    if (line.length > 4096)
      return Promise.reject(
        new Error("Operational metric exceeded the field limit."),
      );
    const operation = queue
      .catch(() => undefined)
      .then(async () => {
        ready ??= mkdir(path.dirname(destination), { recursive: true }).then(
          () => undefined,
        );
        await ready;
        await appendFile(destination, line, { encoding: "utf8", mode: 0o600 });
      });
    queue = operation;
    return operation;
  };
  write.flush = () => queue;
  return write;
}
