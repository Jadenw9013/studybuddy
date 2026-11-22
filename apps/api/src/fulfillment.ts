import { fail, type State } from "./store.ts";
import { beginMeterPass, paidPassPeriod, type MeterPolicy } from './meter.ts';
/** Only call with a server-retrieved Stripe Checkout Session after signature validation. */
export function fulfill(
  s: State,
  owner: string,
  purchaseId: string,
  session: {
    id: string;
    client_reference_id: string | null;
    payment_status: string;
    mode: string | null;
    amount_total: number | null;
    currency: string | null;
    livemode: boolean;
    payment_intent: unknown;
  },
  meterPolicy: MeterPolicy,
  now = Date.now(),
) {
  const p = s.payments[purchaseId];
  if (
    !p ||
    p.owner !== owner ||
    p.sessionId !== session.id ||
    session.client_reference_id !== owner ||
    p.expectedAmount !== session.amount_total ||
    p.expectedCurrency !== session.currency ||
    p.expectedLivemode !== session.livemode
  )
    fail("payment_mismatch", "Payment does not match the pending purchase.");
  if (session.payment_status !== "paid" || session.mode !== "payment")
    return { fulfilled: false };
  if (p.fulfilled) return { fulfilled: true, duplicate: true };
  if (
    Object.values(s.payments).some(
      (x) => x !== p && x.checkoutSessionId === session.id,
    )
  )
    fail("payment_mismatch", "This checkout has already been assigned.");
  const previousPeriod = paidPassPeriod(s, now);
  if (previousPeriod && !previousPeriod.active) s.remainingSeconds = 0;
  Object.assign(p, {
    fulfilled: true,
    status: "paid",
    checkoutSessionId: session.id,
    paymentIntentId: session.payment_intent,
    amount: session.amount_total,
    currency: session.currency,
    startsAt: now, expiresAt: now + 28 * 24 * 60 * 60 * 1000,
  });
  s.remainingSeconds += 4800;
  beginMeterPass(s, purchaseId, meterPolicy);
  return { fulfilled: true, duplicate: false };
}
