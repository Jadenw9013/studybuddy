import test from "node:test";
import assert from "node:assert/strict";
import {
  addUsage,
  beginMeterPass,
  estimateCost,
  heartbeatReservation,
  normalizeProviderUsage,
  parseRateTable,
  parseUnitLimits,
  pricingReady,
  reconcileStale,
  reserveLive,
  reserveTextTurn,
  settleLive,
  settleTextTurn,
  type MeterPolicy,
  type MeterState,
  type Units,
} from "../src/meter.ts";

// These prices are arbitrary test arithmetic, not Google pricing or cost evidence.
const counts = (TEXT = 0, AUDIO = 0, IMAGE = 0) => ({ TEXT, AUDIO, IMAGE });
const limits: Units = {
  input: counts(1000, 1000, 1000),
  output: counts(1000, 1000),
  cachedInput: counts(1000, 1000, 1000),
};
function policy(ceilingUsd = 0.03): MeterPolicy {
  return {
    enabled: true,
    ceilingUsd,
    limits: {
      live: structuredClone(limits),
      text: {
        input: counts(1000),
        output: counts(1000),
        cachedInput: counts(1000),
      },
    },
    dailyTextLimit: 2,
    leaseMs: 30_000,
    rates: parseRateTable({
      version: "synthetic-unit-only-v1",
      currency: "USD",
      models: {
        "synthetic-unit-model": {
          input: counts(1, 3, 4),
          output: counts(2, 6, 8),
          cachedInput: counts(0.1, 0.3, 0.4),
        },
      },
    }),
  };
}
const state = (): MeterState => ({ remainingSeconds: 4800, reservations: {} });
const input = (id = "meter1", now = 1000) => ({
  id,
  lessonId: "lesson1",
  model: "synthetic-unit-model",
  now,
  maxSeconds: 1200,
});
const event = (id = "usage1") => ({
  eventId: id,
  metadata: {
    promptTokenCount: 10,
    responseTokenCount: 5,
    totalTokenCount: 15,
    promptTokensDetails: [
      { modality: "TEXT", tokenCount: 4 },
      { modality: "AUDIO", tokenCount: 6 },
    ],
    responseTokensDetails: [{ modality: "AUDIO", tokenCount: 5 }],
  },
});

test("reviewed prices expire before reservation and stop an existing live heartbeat", () => {
  const p = policy();
  p.rates!.validUntil = "2027-01-01T00:00:00Z";
  const expires = Date.parse(p.rates!.validUntil);
  const s = state();
  reserveLive(s, input("before", expires - 1000), p);
  assert.equal(pricingReady(p, "synthetic-unit-model", "live", expires).reason, "reviewed_prices_expired");
  assert.equal(heartbeatReservation(s, "before", expires - 1, p), true);
  assert.equal(heartbeatReservation(s, "before", expires, p), false);
  assert.throws(() => reserveLive(s, input("after", expires), p), /reviewed rate table/);
  assert.throws(() => parseRateTable({ ...p.rates, validUntil: "invalid" }), /validity date/);
});

test("Google DOCUMENT and VIDEO tokens use the documented image billing modality", () => {
  const usage = normalizeProviderUsage({ promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10,
    promptTokensDetails: [{ modality: "DOCUMENT", tokenCount: 5 }, { modality: "VIDEO", tokenCount: 3 }],
    candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 2 }] }, "text");
  assert.equal(usage.units?.input.IMAGE, 8);
  assert.equal(usage.units?.output.TEXT, 2);
});

test("missing prices or unit ceilings make cost unknown and deny paid work", () => {
  const p = policy();
  p.rates = null;
  assert.equal(pricingReady(p, "synthetic-unit-model", "live").allowed, false);
  assert.equal(estimateCost(limits, undefined).usd, null);
  assert.throws(() => reserveLive(state(), input(), p), /rate table/);
  assert.deepEqual(parseUnitLimits(""), {});
  assert.equal(parseRateTable(""), null);
  assert.throws(() =>
    parseRateTable({
      version: "bad",
      currency: "USD",
      models: { bad: { input: { TEXT: -1 }, output: {} } },
    }),
  );
});

test("mixed live/cache attribution stays unknown instead of guessing an audio rate", () => {
  const mixed = { ...event().metadata, cachedContentTokenCount: 3 };
  assert.equal(
    normalizeProviderUsage(mixed, "live").reason,
    "cached_modality_unknown",
  );
  assert.equal(
    normalizeProviderUsage({ ...event().metadata, totalTokenCount: 16 }, "live")
      .units,
    null,
  );
  const single = normalizeProviderUsage(
    {
      promptTokenCount: 10,
      candidatesTokenCount: 2,
      cachedContentTokenCount: 4,
      totalTokenCount: 12,
    },
    "text",
  );
  assert.equal(single.units?.cachedInput.TEXT, 4);
  assert.equal(
    estimateCost(single.units, policy().rates!.models["synthetic-unit-model"])
      .usd,
    0.0000104,
  );
});

test("reservation retries debit once and altered payloads conflict", () => {
  const s = state(),
    p = policy();
  assert.equal(reserveLive(s, input(), p).seconds, 1200);
  reserveLive(s, input(), p);
  assert.equal(s.remainingSeconds, 3600);
  assert.throws(
    () => reserveLive(s, { ...input(), maxSeconds: 1 }, p),
    /different work/,
  );
  assert.equal(s.remainingSeconds, 3600);
});

test("atomic outstanding holds enforce a shared per-pass ceiling", () => {
  const s = state(),
    p = policy(0.02);
  reserveLive(s, input(), p);
  assert.throws(() => reserveLive(s, input("meter2"), p), /cost ceiling/);
  assert.equal(Object.keys(s.reservations).length, 1);
});

test("settlement deduplicates reported units and returns unused seconds once", () => {
  const s = state(),
    p = policy();
  reserveLive(s, input(), p);
  addUsage(s, "meter1", [event(), event()], p);
  const done = settleLive(s, "meter1", 4.1, [event()], p);
  assert.equal(done.estimatedUsd, 0.000052);
  assert.equal(s.remainingSeconds, 4795);
  assert.equal(Object.keys(s.reservations.meter1.usageRecords!).length, 1);
  const replay = settleLive(s, "meter1", 500, [event()], p);
  assert.equal(replay.replay, true);
  assert.equal(s.remainingSeconds, 4795);
  assert.equal(s.metering!.passes.pilot.heldUsd, 0);
});

test("usage without a bounded output total blocks future paid work and retains conservative hold", () => {
  const s = state(),
    p = policy();
  reserveLive(s, input(), p);
  const result = addUsage(
    s,
    "meter1",
    [
      {
        eventId: "unknown1",
        metadata: {
          promptTokenCount: 10,
          totalTokenCount: 11,
        },
      },
    ],
    p,
  );
  assert.equal(result.allowed, false);
  assert.equal(result.estimatedUsd, null);
  assert.equal(heartbeatReservation(s, "meter1", 2000, p), false);
  const settled = settleLive(s, "meter1", 2, [], p);
  assert.equal(settled.estimatedUsd, null);
  assert.ok(s.metering!.passes.pilot.conservativeProvisionUsd > 0);
  assert.throws(() => reserveLive(s, input("meter2"), p), /reconciliation/);
});

test("observed Live omissions use explicit highest-rate upper bounds without inventing attribution", () => {
  const s = state(), p = policy();
  reserveLive(s, input(), p);
  const observed = { promptTokenCount: 623, responseTokenCount: 11, totalTokenCount: 634,
    promptTokensDetails: [{ modality: 'TEXT', tokenCount: 352 }, { modality: 'AUDIO', tokenCount: 222 }], thoughtsTokenCount: 65 };
  const result = addUsage(s, 'meter1', [{eventId:'observed1',metadata:{rawUsageMetadata:observed}}], p);
  assert.equal(result.allowed, true);
  assert.equal(result.estimatedUsd, 0.00167);
  const record = s.reservations.meter1.usageRecords!.observed1;
  assert.equal(record.reason, 'conservative_live_usage_upper_bound');
  assert.deepEqual(record.unmatchedCounts, {input:49,output:11,thoughts:65,cached:0});
  assert.deepEqual(record.providerMetadata, observed);
  addUsage(s, 'meter1', [{eventId:'observed1',metadata:{rawUsageMetadata:observed}}], p);
  assert.equal(s.reservations.meter1.estimatedUsd, 0.00167);
  const next = {...observed,promptTokenCount:665,totalTokenCount:665,responseTokenCount:undefined,thoughtsTokenCount:80,
    promptTokensDetails:[{modality:'TEXT',tokenCount:372},{modality:'AUDIO',tokenCount:222}]};
  addUsage(s,'meter1',[{eventId:'observed2',metadata:next}],p);
  // Never subtract an assumed cumulative baseline: every distinct observation
  // remains provisioned in full until invoice reconciliation.
  assert.equal(s.reservations.meter1.estimatedUsd, 0.003472);
});

test("conservative Live bounds deny malformed counters, missing supported rates and ceiling overruns", () => {
  const p = policy(), rates = p.rates!.models['synthetic-unit-model'];
  const raw = {promptTokenCount:10,responseTokenCount:2,totalTokenCount:12,thoughtsTokenCount:2};
  assert.equal(normalizeProviderUsage({...raw,totalTokenCount:13},'live',rates).units,null);
  assert.equal(normalizeProviderUsage({...raw,promptTokenCount:-1},'live',rates).units,null);
  assert.equal(normalizeProviderUsage(raw,'live',{...rates,input:{TEXT:1,AUDIO:3}}).units,null);
  const s = state();reserveLive(s,input(),p);
  const over = addUsage(s,'meter1',[{eventId:'over',metadata:{...raw,responseTokenCount:1001,totalTokenCount:1011}}],p);
  assert.equal(over.allowed,false);
  assert.equal(over.reason,'provider_unit_ceiling_exceeded');
});

test("usage ID payload conflicts persist a block rather than silently dropping billed work", () => {
  const s = state(),
    p = policy();
  reserveLive(s, input(), p);
  addUsage(s, "meter1", [event()], p);
  const changed = event();
  changed.metadata.responseTokenCount = 6;
  const result = addUsage(s, "meter1", [changed], p);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "usage_payload_conflict");
});

test("abandoned reservation reconciliation never invents usage or refunds unknown paid time", () => {
  const s = state(),
    p = policy();
  reserveLive(s, input(), p);
  assert.deepEqual(reconcileStale(s, 2000, p).reconciled, []);
  assert.equal(heartbeatReservation(s, "meter1", 2000, p), true);
  assert.deepEqual(reconcileStale(s, 32_001, p).reconciled, ["meter1"]);
  assert.equal(s.remainingSeconds, 3600);
  assert.equal(s.reservations.meter1.activeSeconds, 1200);
  assert.equal(
    s.reservations.meter1.usageRecords &&
      Object.keys(s.reservations.meter1.usageRecords).length,
    0,
  );
  const provision = s.metering!.passes.pilot.conservativeProvisionUsd;
  reconcileStale(s, 100_000, p);
  assert.equal(s.metering!.passes.pilot.conservativeProvisionUsd, provision);
});

test("text quota uses unique turns, preserves retries across days, and checks payload conflicts", () => {
  const s = state(),
    p = policy();
  for (const id of ["text1", "text2"]) {
    reserveTextTurn(s, { ...input(id), payloadHash: "same" }, p);
    settleTextTurn(s, id, [], p, { noProviderWork: true });
  }
  reserveTextTurn(s, { ...input("text1", 86_401_000), payloadHash: "same" }, p);
  assert.equal(Object.keys(s.metering!.textDays["1970-01-01"]).length, 2);
  assert.equal(s.metering!.textDays["1970-01-02"], undefined);
  assert.throws(
    () => reserveTextTurn(s, { ...input("text1"), payloadHash: "changed" }, p),
    /different work|different input/,
  );
  assert.throws(() => reserveTextTurn(s, input("text3"), p), /Daily text/);
  reserveTextTurn(s, input("text3", 86_401_000), p);
});

test("rate revisions cannot change prices on an already reserved operation", () => {
  const s = state(),
    p = policy();
  reserveLive(s, input(), p);
  p.rates!.models["synthetic-unit-model"].input.TEXT = 1_000_000;
  p.rates!.version = "synthetic-v2";
  assert.equal(settleLive(s, "meter1", 1, [event()], p).estimatedUsd, 0.000052);
  assert.equal(
    s.reservations.meter1.pricing!.version,
    "synthetic-unit-only-v1",
  );
});

test("actual units exceeding the configured bound stop further paid work", () => {
  const s = state(),
    p = policy();
  reserveLive(s, input(), p);
  const exceeded = {
    input: counts(1001),
    output: counts(),
    cachedInput: counts(),
  };
  const result = addUsage(
    s,
    "meter1",
    [{ eventId: "over1", metadata: exceeded }],
    p,
  );
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "provider_unit_ceiling_exceeded");
});

test("a new pass does not erase prior-pass reservations or expenses", () => {
  const s = state(),
    p = policy();
  reserveLive(s, input(), p);
  beginMeterPass(s, "new-paid-pass", p);
  settleLive(s, "meter1", 1, [event()], p);
  assert.equal(s.metering!.passes.pilot.spentUsd, 0.000052);
  assert.equal(s.metering!.passes["new-paid-pass"].spentUsd, 0);
});

test('four-week expiry denies new paid work and an active stream cannot borrow a newer pass', () => {
  const s = state(), p = policy();
  const expiresAt = 28 * 86400_000;
  s.payments = { old: { fulfilled: true, startsAt: 0, expiresAt } };
  beginMeterPass(s, 'old', p);
  const reserved = reserveLive(s, input('near-expiry', expiresAt - 5000), p);
  assert.equal(reserved.seconds, 5);
  assert.equal(s.reservations['near-expiry'].entitlementId, 'old');
  assert.equal(heartbeatReservation(s, 'near-expiry', expiresAt - 1, p), true);
  assert.equal(heartbeatReservation(s, 'near-expiry', expiresAt, p), false);
  assert.throws(() => reserveLive(s, input('expired-live', expiresAt), p), /inactive or expired/);
  assert.throws(() => reserveTextTurn(s, input('expired-text', expiresAt), p), /inactive or expired/);
  s.payments.new = { fulfilled: true, startsAt: expiresAt, expiresAt: expiresAt + 28 * 86400_000 };
  beginMeterPass(s, 'new', p);
  assert.equal(heartbeatReservation(s, 'near-expiry', expiresAt + 1, p), false);
  const before = s.remainingSeconds;
  settleLive(s, 'near-expiry', 1, [event()], p, { now: expiresAt + 1 });
  assert.equal(s.remainingSeconds, before, 'unused expired seconds do not revive in the new pass');
});

test('a fulfilled purchase without valid dates never supplies an inferred unexpiring pass', () => {
  const s = state(); s.payments = { unknown: { fulfilled: true } };
  assert.throws(() => reserveTextTurn(s, input(), policy()), /inactive or expired/);
});
