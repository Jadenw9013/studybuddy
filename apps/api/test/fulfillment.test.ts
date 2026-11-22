import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../src/store.ts";
import { fulfill } from "../src/fulfillment.ts";
import type { MeterPolicy } from '../src/meter.ts';
const meterPolicy: MeterPolicy = { enabled: false, rates: null, limits: {}, ceilingUsd: 7.60 };
test("one rightful paid Checkout grants once; unpaid/out-of-order and wrong identity cannot grant", () => {
  const s = emptyState();
  s.remainingSeconds = 0;
  s.payments.p = {
    owner: "u",
    sessionId: "cs",
    expectedAmount: 1900,
    expectedCurrency: "usd",
    expectedLivemode: false,
  };
  const paid = {
    id: "cs",
    client_reference_id: "u",
    payment_status: "paid",
    mode: "payment",
    amount_total: 1900,
    currency: "usd",
    livemode: false,
    payment_intent: "pi",
  };
  assert.equal(
    fulfill(s, "u", "p", { ...paid, payment_status: "unpaid" }, meterPolicy).fulfilled,
    false,
  );
  assert.equal(s.remainingSeconds, 0);
  assert.throws(() =>
    fulfill(s, "u", "p", { ...paid, client_reference_id: "someone-else" }, meterPolicy),
  );
  assert.throws(() => fulfill(s, "u", "p", { ...paid, amount_total: 200 }, meterPolicy));
  assert.equal(fulfill(s, "u", "p", paid, meterPolicy).duplicate, false);
  assert.equal(fulfill(s, "u", "p", paid, meterPolicy).duplicate, true);
  assert.equal(s.remainingSeconds, 4800);
  fulfill(s, "u", "p", { ...paid, payment_status: "unpaid" }, meterPolicy);
  assert.equal(s.remainingSeconds, 4800);
});

test('new rightful fulfillment creates one exact 28-day budget period and duplicate cannot reset it', () => {
  const s = emptyState();
  const startsAt = Date.UTC(2026, 10, 16);
  s.remainingSeconds = 1000;
  s.payments.old = { fulfilled: true, startsAt: startsAt - 29 * 86400_000, expiresAt: startsAt - 86400_000 };
  s.payments.new = { owner: 'u', sessionId: 'cs_new', expectedAmount: 1900, expectedCurrency: 'usd', expectedLivemode: false };
  const paid = { id: 'cs_new', client_reference_id: 'u', payment_status: 'paid', mode: 'payment', amount_total: 1900, currency: 'usd', livemode: false, payment_intent: 'pi_new' };
  fulfill(s, 'u', 'new', paid, meterPolicy, startsAt);
  assert.equal(s.remainingSeconds, 4800, 'expired unused allowance is not renewed');
  assert.equal(s.payments.new.startsAt, startsAt);
  assert.equal(s.payments.new.expiresAt, startsAt + 28 * 86400_000);
  assert.equal(s.metering!.activePassId, 'new');
  s.metering!.passes.new.spentUsd = 1.25;
  fulfill(s, 'u', 'new', paid, meterPolicy, startsAt + 30 * 86400_000);
  assert.equal(s.payments.new.expiresAt, startsAt + 28 * 86400_000);
  assert.equal(s.metering!.passes.new.spentUsd, 1.25);
  assert.equal(s.remainingSeconds, 4800);
});
