import { createHash } from "node:crypto";
import { canonical, DomainError } from "../../../packages/contracts/index.ts";

export const modalities = ["TEXT", "AUDIO", "IMAGE"] as const;
export type Modality = (typeof modalities)[number];
export type Counts = Record<Modality, number>;
export type Units = { input: Counts; output: Counts; cachedInput: Counts };
export type Rates = {
  input: Partial<Counts>;
  output: Partial<Counts>;
  cachedInput?: Partial<Counts>;
};
/** Prices are operator-supplied USD per million tokens, never bundled vendor assumptions. */
export type RateTable = {
  version: string;
  currency: "USD";
  /** Exclusive UTC validity bound for time-limited reviewed vendor prices. */
  validUntil?: string;
  models: Record<string, Rates>;
};
export type MeterPolicy = {
  enabled: boolean;
  rates: RateTable | null;
  ceilingUsd: number;
  limits: { text?: Units; live?: Units };
  dailyTextLimit?: number;
  leaseMs?: number;
};
export type UsageInput = { eventId: string; metadata: unknown };
export type UsageRecord = {
  eventId: string;
  payloadHash: string;
  units: Units | null;
  usd: number | null;
  reason?: string;
  unmatchedCounts?: { input: number; output: number; thoughts: number; cached: number };
  providerMetadata?: unknown;
};
export type Reservation = {
  seconds: number;
  settled: boolean;
  activeSeconds?: number;
  lessonId?: string;
  meterId?: string;
  lastHeartbeat?: number;
  model?: string;
  usage?: unknown[];
  kind?: "text" | "live";
  passId?: string;
  createdAt?: number;
  maxUsd?: number;
  heldUsd?: number;
  estimatedUsd?: number;
  unknownCost?: boolean;
  reconciled?: boolean;
  payloadHash?: string;
  pricing?: { version: string; rates: Rates };
  limits?: Units;
  usageRecords?: Record<string, UsageRecord>;
  entitlementId?: string;
  entitlementExpiresAt?: number;
};
type Pass = {
  spentUsd: number;
  heldUsd: number;
  ceilingUsd: number;
  unknownCost: boolean;
  blockedReason?: string;
  conservativeProvisionUsd: number;
};
export type MeterState = {
  remainingSeconds: number;
  reservations: Record<string, Reservation>;
  payments?: Record<string, { fulfilled?: boolean; refunded?: boolean; startsAt?: number; expiresAt?: number; checkoutSessionId?: string }>;
  metering?: {
    activePassId: string;
    passes: Record<string, Pass>;
    textDays: Record<string, Record<string, string>>;
  };
};
const zeroCounts = (): Counts => ({ TEXT: 0, AUDIO: 0, IMAGE: 0 });
const zeroUnits = (): Units => ({
  input: zeroCounts(),
  output: zeroCounts(),
  cachedInput: zeroCounts(),
});
const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
function fail(code: string, message: string): never {
  throw new DomainError(code, message, code === "quota_exhausted" ? 429 : 409);
}
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const count = (value: unknown): value is number =>
  finite(value) && Number.isSafeInteger(value);
const round = (value: number) => Math.round(value * 1e12) / 1e12;
const safeId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9_.:-]{1,128}$/.test(value) &&
  !["__proto__", "prototype", "constructor"].includes(value);

/** A missing paid purchase is a separate fixture/trial case, not an inferred purchase.
 * A fulfilled purchase with missing/invalid dates is explicitly inactive.
 */
export function paidPassPeriod(state: MeterState, now: number, entitlementId?: string) {
  const purchases = Object.entries(state.payments ?? {}).filter(([, purchase]) => purchase.fulfilled);
  if (!purchases.length && !entitlementId) return null;
  const activeId = entitlementId ?? state.metering?.activePassId;
  const selected = purchases.find(([id]) => id === activeId)
    ?? (entitlementId ? undefined : purchases.sort((a, b) => (finite(b[1].startsAt) ? b[1].startsAt : -1) - (finite(a[1].startsAt) ? a[1].startsAt : -1))[0]);
  if (!selected) return { id: entitlementId!, startsAt: null, expiresAt: null, active: false };
  const [id, purchase] = selected;
  const startsAt = finite(purchase.startsAt) ? purchase.startsAt : null;
  const expiresAt = finite(purchase.expiresAt) ? purchase.expiresAt : null;
  return { id, startsAt, expiresAt, active: !purchase.refunded && finite(now) && startsAt !== null && expiresAt !== null
    && expiresAt > startsAt && now >= startsAt && now < expiresAt };
}

export function parseRateTable(value: unknown): RateTable | null {
  if (value === undefined || value === null || value === "") return null;
  const table = typeof value === "string" ? JSON.parse(value) : value;
  if (
    !table ||
    typeof table.version !== "string" ||
    !table.version.trim() ||
    table.version.length > 120 ||
    table.currency !== "USD" ||
    !table.models ||
    typeof table.models !== "object" ||
    Array.isArray(table.models)
  )
    throw new Error("Invalid versioned USD rate table.");
  const models: Record<string, Rates> = {};
  if (table.validUntil !== undefined &&
    (typeof table.validUntil !== "string" || !Number.isFinite(Date.parse(table.validUntil))))
    throw new Error("Invalid pricing validity date.");
  for (const [model, raw] of Object.entries(table.models)) {
    if (!safeId(model) || model.length > 120 || !raw || typeof raw !== "object")
      throw new Error("Invalid model pricing.");
    const rates: Rates = { input: {}, output: {}, cachedInput: {} };
    for (const direction of ["input", "output", "cachedInput"] as const) {
      const entry = (raw as any)[direction];
      if (entry === undefined && direction === "cachedInput") continue;
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        throw new Error("Invalid modality rates.");
      for (const [modality, price] of Object.entries(entry)) {
        if (!modalities.includes(modality as Modality) || !finite(price))
          throw new Error(
            "Rates must be nonnegative finite USD per million tokens.",
          );
        rates[direction]![modality as Modality] = price;
      }
    }
    models[model] = rates;
  }
  return { version: table.version, currency: "USD", models,
    ...(table.validUntil ? { validUntil: table.validUntil } : {}) };
}

export function parseUnitLimits(value: unknown): MeterPolicy["limits"] {
  if (value === undefined || value === null || value === "") return {};
  const limits = typeof value === "string" ? JSON.parse(value) : value;
  if (!limits || typeof limits !== "object" || Array.isArray(limits))
    throw new Error("Invalid provider unit ceilings.");
  const result: MeterPolicy["limits"] = {};
  for (const mode of ["text", "live"] as const) {
    if (limits[mode] === undefined) continue;
    const units = readUnits(limits[mode]);
    if (!units)
      throw new Error(
        "Each configured ceiling needs input, output and cachedInput counts for TEXT, AUDIO and IMAGE.",
      );
    result[mode] = units;
  }
  return result;
}

function readUnits(value: any): Units | null {
  if (!value || typeof value !== "object") return null;
  const units = zeroUnits();
  for (const direction of ["input", "output", "cachedInput"] as const) {
    if (!value[direction] || typeof value[direction] !== "object") return null;
    for (const modality of modalities) {
      if (!count(value[direction][modality])) return null;
      units[direction][modality] = value[direction][modality];
    }
  }
  for (const modality of modalities)
    if (units.cachedInput[modality] > units.input[modality]) return null;
  return units;
}

export function estimateCost(
  units: Units | null,
  rates: Rates | undefined,
): { usd: number | null; reason?: string } {
  if (!units || !readUnits(units) || !rates)
    return { usd: null, reason: "usage_or_rates_unknown" };
  let usd = 0;
  for (const modality of modalities) {
    const input = units.input[modality] - units.cachedInput[modality];
    const output = units.output[modality],
      cached = units.cachedInput[modality];
    const parts: [number, number | undefined][] = [
      [input, rates.input[modality]],
      [output, rates.output[modality]],
      [cached, rates.cachedInput?.[modality]],
    ];
    for (const [amount, price] of parts) {
      if (amount && !finite(price))
        return { usd: null, reason: `missing_${modality.toLowerCase()}_rate` };
      usd += (amount * (price ?? 0)) / 1_000_000;
    }
  }
  return { usd: round(usd) };
}

/** Decode only provider counters. Missing mixed-modality information remains unknown. */
export function normalizeProviderUsage(
  value: any,
  kind: "text" | "live",
  conservativeRates?: Rates,
): { units: Units | null; reason?: string; unmatchedCounts?: { input: number; output: number; thoughts: number; cached: number } } {
  const raw = value?.rawUsageMetadata ?? value;
  const strict = normalizeStrictUsage(raw, kind);
  if (strict.units || kind !== "live" || !conservativeRates) return strict;
  return conservativeLiveUsage(raw, conservativeRates);
}

/** Upper bound for the observed Live schema's incomplete modality breakdown.
 * Counts remain attributed as unknown in unmatchedCounts; allocation to the most
 * expensive configured modality is an estimate, never a vendor billing claim.
 * Periodic/cumulative observations are charged in full individually. This can
 * over-reserve but cannot undercharge by subtracting an unproven cumulative base.
 */
function conservativeLiveUsage(value: any, rates: Rates) {
  const invalid = { units: null, reason: "live_usage_cannot_be_bounded" };
  if (!value || typeof value !== "object") return invalid;
  const prompt = value.promptTokenCount, total = value.totalTokenCount;
  const response = value.responseTokenCount ?? (count(total) && count(prompt) && total === prompt ? 0 : undefined);
  const thoughts = value.thoughtsTokenCount ?? 0, cached = value.cachedContentTokenCount ?? 0;
  if (![prompt, response, total, thoughts, cached].every(count) || cached > prompt ||
    !count(prompt + response + thoughts) || (total !== prompt + response && total !== prompt + response + thoughts)) return invalid;
  const units = zeroUnits(), unmatched = { input: 0, output: 0, thoughts: 0, cached: 0 };
  function mostExpensive(direction: "input" | "output"): Modality | undefined {
    // Live input can be text/audio/image; output is text/audio. Missing rates for
    // any supported modality prevent a safe fallback instead of assuming zero.
    const supported: Modality[] = direction === "input" ? ["TEXT", "AUDIO", "IMAGE"] : ["TEXT", "AUDIO"];
    if (supported.some(key => !finite(rates[direction][key]))) return undefined;
    return supported.reduce((a, b) => rates[direction][a]! >= rates[direction][b]! ? a : b);
  }
  function allocate(items: unknown, tokens: number, direction: "input" | "output") {
    if (items !== undefined && !Array.isArray(items)) return false;
    let observed = 0;
    for (const item of (items as any[] | undefined) ?? []) {
      const key = item?.modality === "DOCUMENT" || item?.modality === "VIDEO" ? "IMAGE" : item?.modality;
      if (!modalities.includes(key) || !count(item?.tokenCount)) return false;
      units[direction][key as Modality] += item.tokenCount; observed += item.tokenCount;
    }
    if (observed > tokens || !count(observed)) return false;
    unmatched[direction] = tokens - observed;
    if (unmatched[direction]) {
      const highest = mostExpensive(direction);
      if (!highest) return false;
      units[direction][highest] += unmatched[direction];
    }
    return true;
  }
  if (!allocate(value.promptTokensDetails, prompt, "input") ||
    !allocate(value.responseTokensDetails, response, "output")) return invalid;
  if (thoughts) {
    const highest = mostExpensive("output");
    if (!highest) return invalid;
    units.output[highest] += thoughts; unmatched.thoughts = thoughts;
  }
  if (cached) {
    // With incomplete attribution, apply no discount. Only safe when all
    // configured cache rates are no greater than the full input rates.
    if (modalities.some(key => !finite(rates.cachedInput?.[key]) || !finite(rates.input[key]) || rates.cachedInput![key]! > rates.input[key]!)) return invalid;
    unmatched.cached = cached;
  }
  if (!readUnits(units)) return invalid;
  return { units, reason: "conservative_live_usage_upper_bound", unmatchedCounts: unmatched };
}

function normalizeStrictUsage(
  value: any,
  kind: "text" | "live",
): { units: Units | null; reason?: string } {
  if (!value || typeof value !== "object")
    return { units: null, reason: "missing_provider_usage" };
  if (value.input !== undefined) {
    const units = readUnits(value);
    return units ? { units } : { units: null, reason: "invalid_usage_units" };
  }
  const units = zeroUnits();
  const prompt = value.promptTokenCount;
  const response = value.responseTokenCount ?? value.candidatesTokenCount;
  const cached = value.cachedContentTokenCount ?? 0;
  const thoughts = value.thoughtsTokenCount ?? 0;
  if (![prompt, response, cached, thoughts].every(count))
    return { units: null, reason: "missing_or_invalid_token_totals" };
  function detail(
    items: unknown,
    total: number,
    target: Counts,
    fallback: boolean,
  ): boolean {
    if (!Array.isArray(items) || !items.length) {
      if (!total) return true;
      if (fallback) {
        target.TEXT = total;
        return true;
      }
      return false;
    }
    for (const item of items) {
      const modality = item?.modality === "DOCUMENT" || item?.modality === "VIDEO" ? "IMAGE" : item?.modality;
      if (
        !item ||
        !modalities.includes(modality) ||
        !count(item.tokenCount)
      )
        return false;
      target[modality as Modality] += item.tokenCount;
    }
    return modalities.reduce((sum, key) => sum + target[key], 0) === total;
  }
  if (!detail(value.promptTokensDetails, prompt, units.input, kind === "text"))
    return { units: null, reason: "input_modality_unknown" };
  if (
    !detail(
      value.responseTokensDetails ?? value.candidatesTokensDetails,
      response,
      units.output,
      kind === "text",
    )
  )
    return { units: null, reason: "output_modality_unknown" };
  if (thoughts) {
    if (kind !== "text")
      return { units: null, reason: "reasoning_modality_unknown" };
    units.output.TEXT += thoughts;
  }
  if (cached) {
    if (!detail(value.cacheTokensDetails, cached, units.cachedInput, false)) {
      const used = modalities.filter((key) => units.input[key] > 0);
      if (used.length !== 1)
        return { units: null, reason: "cached_modality_unknown" };
      units.cachedInput[used[0]] = cached;
    }
  }
  if (modalities.some((key) => units.cachedInput[key] > units.input[key]))
    return { units: null, reason: "invalid_cached_usage" };
  if (
    value.totalTokenCount !== undefined &&
    (!count(value.totalTokenCount) ||
      value.totalTokenCount !== prompt + response + thoughts)
  )
    return { units: null, reason: "unattributed_provider_tokens" };
  return { units };
}

export function pricingReady(
  policy: MeterPolicy,
  model: string,
  kind: "text" | "live",
  now = Date.now(),
) {
  if (!policy.enabled)
    return { allowed: false, reason: "paid_calls_disabled", maximumUsd: null };
  if (policy.rates?.validUntil && now >= Date.parse(policy.rates.validUntil))
    return { allowed: false, reason: "reviewed_prices_expired", maximumUsd: null };
  const limits = policy.limits[kind],
    rates = policy.rates?.models[model];
  if (
    !limits ||
    !readUnits(limits) ||
    !rates ||
    !policy.rates ||
    !finite(policy.ceilingUsd) ||
    policy.ceilingUsd <= 0
  )
    return {
      allowed: false,
      reason: "cost_controls_unconfigured",
      maximumUsd: null,
    };
  const worstRates = structuredClone(rates);
  for (const modality of modalities)
    if (limits.cachedInput[modality]) {
      const cachedRate = rates.cachedInput?.[modality];
      if (!finite(cachedRate) || !finite(rates.input[modality]))
        return {
          allowed: false,
          reason: "cached_rate_unknown",
          maximumUsd: null,
        };
      worstRates.input[modality] = Math.max(cachedRate, rates.input[modality]!);
    }
  const maximum = estimateCost(
    { ...limits, cachedInput: zeroCounts() },
    worstRates,
  );
  if (maximum.usd === null || maximum.usd <= 0)
    return {
      allowed: false,
      reason: maximum.reason || "invalid_cost_bound",
      maximumUsd: null,
    };
  return {
    allowed: true,
    reason: "configured_bounds_require_runtime_enforcement",
    maximumUsd: maximum.usd,
  };
}

function ledger(state: MeterState, policy: MeterPolicy) {
  state.metering ??= { activePassId: "pilot", passes: {}, textDays: {} };
  const id = state.metering.activePassId;
  state.metering.passes[id] ??= {
    spentUsd: 0,
    heldUsd: 0,
    ceilingUsd: policy.ceilingUsd,
    unknownCost: false,
    conservativeProvisionUsd: 0,
  };
  return {
    ledger: state.metering,
    pass: state.metering.passes[id],
    passId: id,
  };
}

/** Call from the same unique payment-fulfillment transaction that grants minutes. */
export function beginMeterPass(
  state: MeterState,
  passId: string,
  policy: MeterPolicy,
) {
  if (!safeId(passId)) fail("invalid_params", "Invalid pass identifier.");
  const { ledger: book } = ledger(state, policy);
  book.passes[passId] ??= {
    spentUsd: 0,
    heldUsd: 0,
    ceilingUsd: policy.ceilingUsd,
    unknownCost: false,
    conservativeProvisionUsd: 0,
  };
  book.activePassId = passId;
}

type ReservationInput = {
  id: string;
  lessonId: string;
  model: string;
  now: number;
  payloadHash?: string;
};
function reserve(
  state: MeterState,
  input: ReservationInput,
  kind: "text" | "live",
  seconds: number,
  policy: MeterPolicy,
): Reservation {
  if (
    !safeId(input.id) ||
    !safeId(input.lessonId) ||
    !safeId(input.model) ||
    !finite(input.now)
  )
    fail("invalid_params", "Invalid meter reservation.");
  const payloadHash = hash({
    kind,
    lessonId: input.lessonId,
    model: input.model,
    seconds,
    payloadHash: input.payloadHash ?? null,
  });
  const prior = state.reservations[input.id];
  const period = paidPassPeriod(state, input.now, prior?.entitlementId);
  if (period && !period.active) fail('entitlement_expired', 'This four-week pass is inactive or expired. Your saved course and lesson remain available.');
  if (prior) {
    if (prior.payloadHash !== payloadHash)
      fail("payload_conflict", "Meter ID already identifies different work.");
    return prior;
  }
  const readiness = pricingReady(policy, input.model, kind, input.now);
  if (!readiness.allowed || readiness.maximumUsd === null)
    fail(
      "cost_controls_unconfigured",
      "Paid tutoring needs a reviewed rate table and enforceable usage ceilings.",
    );
  const { pass, passId } = ledger(state, policy);
  if (pass.unknownCost || pass.blockedReason)
    fail(
      "budget_blocked",
      "Paid work is paused pending usage reconciliation. Your saved work remains available.",
    );
  const ceiling = Math.min(pass.ceilingUsd, policy.ceilingUsd);
  if (pass.spentUsd + pass.heldUsd + readiness.maximumUsd > ceiling + 1e-10)
    fail(
      "quota_exhausted",
      "This pass reached its cost ceiling. Your saved work remains available.",
    );
  const reservation: Reservation = {
    seconds,
    settled: false,
    kind,
    lessonId: input.lessonId,
    meterId: input.id,
    model: input.model,
    createdAt: input.now,
    lastHeartbeat: input.now,
    passId,
    payloadHash,
    maxUsd: readiness.maximumUsd,
    heldUsd: readiness.maximumUsd,
    estimatedUsd: 0,
    pricing: {
      version: policy.rates!.version,
      rates: structuredClone(policy.rates!.models[input.model]),
    },
    limits: structuredClone(policy.limits[kind]!),
    usageRecords: {},
    entitlementId: period?.id,
    entitlementExpiresAt: period?.expiresAt ?? undefined,
  };
  pass.heldUsd = round(pass.heldUsd + readiness.maximumUsd);
  state.reservations[input.id] = reservation;
  return reservation;
}

/** Caller must hold its owner/pass row lock; no provider I/O occurs inside this helper. */
export function reserveLive(
  state: MeterState,
  input: ReservationInput & { maxSeconds: number },
  policy: MeterPolicy,
) {
  if (
    !count(input.maxSeconds) ||
    input.maxSeconds < 1 ||
    input.maxSeconds > 1200
  )
    fail("invalid_params", "Use a live session of at most 20 minutes.");
  const prior = state.reservations[input.id];
  const period = paidPassPeriod(state, input.now, prior?.entitlementId);
  if (period && !period.active) fail('entitlement_expired', 'This four-week pass is inactive or expired. Your saved course and lesson remain available.');
  const secondsBeforeExpiry = period?.expiresAt === null || !period ? 1200 : Math.max(0, Math.floor((period.expiresAt - input.now) / 1000));
  const seconds =
    prior?.seconds ?? Math.min(state.remainingSeconds, input.maxSeconds, secondsBeforeExpiry);
  if (!count(seconds) || seconds < 1)
    fail("quota_exhausted", "Live minutes are used up. Continue by typing.");
  const reservation = reserve(
    state,
    {
      ...input,
      payloadHash: hash({
        payload: input.payloadHash ?? null,
        maxSeconds: input.maxSeconds,
      }),
    },
    "live",
    seconds,
    policy,
  );
  if (!prior) state.remainingSeconds -= seconds;
  return {
    id: input.id,
    seconds: reservation.seconds,
    maximumUsd: reservation.maxUsd,
  };
}

export function reserveTextTurn(
  state: MeterState,
  input: ReservationInput,
  policy: MeterPolicy,
) {
  const prior = state.reservations[input.id];
  if (prior) {
    const reservation = reserve(state, input, "text", 0, policy);
    return {
      id: input.id,
      maximumUsd: reservation.maxUsd,
      quotaDay: new Date(reservation.createdAt ?? input.now)
        .toISOString()
        .slice(0, 10),
    };
  }
  const { ledger: book } = ledger(state, policy);
  const day = new Date(input.now).toISOString().slice(0, 10); // Explicit UTC quota day.
  const seen = book.textDays[day] ?? {};
  if (seen[input.id] && seen[input.id] !== input.payloadHash)
    fail("payload_conflict", "Text turn ID has different input.");
  if (
    !seen[input.id] &&
    Object.keys(seen).length >= (policy.dailyTextLimit ?? 50)
  )
    fail(
      "quota_exhausted",
      "Daily text-turn allowance reached. Resume tomorrow.",
    );
  const reservation = reserve(state, input, "text", 0, policy);
  book.textDays[day] ??= {};
  book.textDays[day][input.id] = input.payloadHash ?? "";
  return { id: input.id, maximumUsd: reservation.maxUsd, quotaDay: day };
}

function reservationPass(state: MeterState, id: string, policy: MeterPolicy) {
  const reservation =
    state.reservations[id] ??
    fail("not_found", "Meter reservation unavailable.");
  const { ledger: book, pass: active } = ledger(state, policy);
  return {
    reservation,
    pass: reservation.passId
      ? (book.passes[reservation.passId] ?? active)
      : active,
  };
}

/** Persist the returned denial; do not throw/roll back an unknown-usage budget block. */
export function addUsage(
  state: MeterState,
  id: string,
  events: UsageInput[],
  policy: MeterPolicy,
) {
  const { reservation: r, pass } = reservationPass(state, id, policy);
  if (r.settled)
    return {
      allowed: false,
      reason: "already_settled",
      estimatedUsd: r.unknownCost ? null : (r.estimatedUsd ?? null),
    };
  r.usageRecords ??= {};
  for (const event of events) {
    if (!event.eventId || event.eventId.length > 160) {
      pass.unknownCost = r.unknownCost = true;
      pass.blockedReason = "invalid_usage_event";
      continue;
    }
    const normalized = normalizeProviderUsage(event.metadata, r.kind ?? "live", r.pricing?.rates);
    const payloadHash = hash({ model: r.model, metadata: event.metadata });
    const prior = r.usageRecords[event.eventId];
    if (prior) {
      if (prior.payloadHash !== payloadHash) {
        pass.unknownCost = r.unknownCost = true;
        pass.blockedReason = "usage_payload_conflict";
      }
      continue;
    }
    const estimate = estimateCost(normalized.units, r.pricing?.rates);
    const record: UsageRecord = {
      eventId: event.eventId,
      payloadHash,
      units: normalized.units,
      usd: estimate.usd,
      reason: normalized.reason ?? estimate.reason,
      unmatchedCounts: normalized.unmatchedCounts,
      providerMetadata: (event.metadata as any)?.rawUsageMetadata ?? event.metadata,
    };
    r.usageRecords[event.eventId] = record;
    if (estimate.usd === null) {
      pass.unknownCost = r.unknownCost = true;
      pass.blockedReason = record.reason ?? "usage_unknown";
      continue;
    }
    r.estimatedUsd = round((r.estimatedUsd ?? 0) + estimate.usd);
    pass.spentUsd = round(pass.spentUsd + estimate.usd);
    const hold = Math.max(0, (r.maxUsd ?? 0) - r.estimatedUsd);
    pass.heldUsd = round(Math.max(0, pass.heldUsd - ((r.heldUsd ?? 0) - hold)));
    r.heldUsd = hold;
    if (r.limits && normalized.units && Object.keys(r.usageRecords).length) {
      const sum = zeroUnits();
      for (const item of Object.values(r.usageRecords))
        if (item.units)
          for (const direction of ["input", "output", "cachedInput"] as const)
            for (const modality of modalities)
              sum[direction][modality] += item.units[direction][modality];
      if (
        modalities.some(
          (key) =>
            sum.input[key] > r.limits!.input[key] ||
            sum.output[key] > r.limits!.output[key] ||
            sum.cachedInput[key] > r.limits!.cachedInput[key],
        )
      )
        pass.blockedReason = "provider_unit_ceiling_exceeded";
    }
    if (
      pass.spentUsd + pass.heldUsd >
      Math.min(pass.ceilingUsd, policy.ceilingUsd) + 1e-10
    )
      pass.blockedReason = "pass_cost_ceiling_exceeded";
  }
  return {
    allowed: !pass.unknownCost && !pass.blockedReason,
    reason: pass.blockedReason ?? null,
    estimatedUsd: r.unknownCost ? null : (r.estimatedUsd ?? 0),
  };
}

export function heartbeatReservation(
  state: MeterState,
  id: string,
  now: number,
  policy: MeterPolicy,
) {
  const { reservation: r, pass } = reservationPass(state, id, policy);
  const period = paidPassPeriod(state, now, r.entitlementId);
  if (
    r.settled ||
    !policy.enabled ||
    (policy.rates?.validUntil !== undefined && now >= Date.parse(policy.rates.validUntil)) ||
    pass.unknownCost ||
    pass.blockedReason ||
    !finite(now)
    || (period !== null && !period.active)
    || (r.entitlementExpiresAt !== undefined && now >= r.entitlementExpiresAt)
  )
    return false;
  r.lastHeartbeat = now;
  return true;
}

export function settleLive(
  state: MeterState,
  id: string,
  activeSeconds: number,
  events: UsageInput[],
  policy: MeterPolicy,
  options: { noProviderWork?: boolean; now?: number } = {},
) {
  const { reservation: r, pass } = reservationPass(state, id, policy);
  if (r.settled)
    return {
      status: "settled",
      activeSeconds: r.activeSeconds ?? 0,
      estimatedUsd: r.unknownCost ? null : (r.estimatedUsd ?? null),
      replay: true,
    };
  const result = addUsage(state, id, events, policy);
  if (!finite(activeSeconds)) {
    r.unknownCost = pass.unknownCost = true;
    pass.blockedReason = "invalid_active_duration";
  }
  r.activeSeconds = finite(activeSeconds)
    ? Math.min(r.seconds, Math.ceil(activeSeconds))
    : r.seconds;
  const settledAt = options.now ?? Date.now();
  const originalPeriod = paidPassPeriod(state, settledAt, r.entitlementId);
  const currentPeriod = paidPassPeriod(state, settledAt);
  // Unused time from an expired/replaced pass must not revive in a newer pass.
  if (!originalPeriod || (originalPeriod.active && originalPeriod.id === currentPeriod?.id))
    state.remainingSeconds += Math.max(0, r.seconds - r.activeSeconds);
  const missingUsage =
    !Object.keys(r.usageRecords ?? {}).length && !options.noProviderWork;
  if (missingUsage) {
    r.unknownCost = pass.unknownCost = true;
    pass.blockedReason = "provider_usage_missing";
  }
  if (r.unknownCost) {
    // Keep the remaining reservation as a conservative provision, not an invoice estimate.
    pass.conservativeProvisionUsd = round(
      pass.conservativeProvisionUsd + (r.heldUsd ?? 0),
    );
  } else pass.heldUsd = round(Math.max(0, pass.heldUsd - (r.heldUsd ?? 0)));
  r.settled = true;
  return {
    status: "settled",
    activeSeconds: r.activeSeconds,
    estimatedUsd: r.unknownCost ? null : result.estimatedUsd,
    replay: false,
  };
}

export function settleTextTurn(
  state: MeterState,
  id: string,
  events: UsageInput[],
  policy: MeterPolicy,
  options: { noProviderWork?: boolean; now?: number } = {},
) {
  return settleLive(state, id, 0, events, policy, options);
}

/** Abandoned leases never refund unobserved paid time or invent provider usage. */
export function reconcileStale(
  state: MeterState,
  now: number,
  policy: MeterPolicy,
) {
  const reconciled: string[] = [];
  for (const [id, r] of Object.entries(state.reservations)) {
    if (
      r.settled ||
      !finite(now) ||
      (r.lastHeartbeat !== undefined &&
        now - r.lastHeartbeat <= (policy.leaseMs ?? 30_000))
    )
      continue;
    const { pass } = reservationPass(state, id, policy);
    r.activeSeconds = r.seconds;
    r.settled = true;
    r.reconciled = true;
    r.unknownCost = true;
    pass.unknownCost = true;
    pass.blockedReason = "abandoned_usage_requires_reconciliation";
    pass.conservativeProvisionUsd = round(
      pass.conservativeProvisionUsd + (r.heldUsd ?? 0),
    );
    reconciled.push(id);
  }
  return {
    reconciled,
    paidAllowed:
      reconciled.length === 0 && !ledger(state, policy).pass.blockedReason,
  };
}
