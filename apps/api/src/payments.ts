import type { MeterPolicy } from './meter.ts';
import { fulfill } from "./fulfillment.ts";
import Stripe from "stripe";
import type { FastifyInstance } from "fastify";
import { uid, fail, type Store } from "./store.ts";
import type { Config } from "./config.ts";
export async function registerPayments(
  app: FastifyInstance,
  {
    config,
    store,
    auth,
    meterPolicy,
  }: {
    config: Config;
    meterPolicy:MeterPolicy;
    store: Store;
    auth: (r: any) => Promise<{ owner: string }>;
  },
) {
  const key = process.env.STRIPE_SECRET_KEY;
  const enabled =
    config.mode === "live" && process.env.ENABLE_BILLING === "true";
  const stripe = enabled && key ? new Stripe(key) : null;
  app.post("/api/payments/checkout", async (req) => {
    const a = await auth(req);
    if (!stripe || !process.env.STRIPE_PRICE_ID)
      fail("billing_unavailable", "Pilot purchases are not enabled.", 503);
    if (process.env.NODE_ENV !== "production" && !key!.startsWith("sk_test_"))
      fail(
        "billing_unavailable",
        "Use a test-mode billing account in development.",
        503,
      );
    const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID);
    if (
      !price.active ||
      price.currency !== "usd" ||
      price.unit_amount !== 1900 ||
      price.type !== "one_time"
    )
      fail(
        "billing_unavailable",
        "The approved pilot pass is not configured.",
        503,
      );
    const purchaseId = uid();
    await store.transact(
      a.owner,
      (s) =>
        (s.payments[purchaseId] = {
          id: purchaseId,
          owner: a.owner,
          status: "pending",
          environment: process.env.NODE_ENV ?? "development",
          expectedAmount: price.unit_amount,
          expectedCurrency: price.currency,
          expectedLivemode: !key!.startsWith("sk_test_"),
        }),
    );
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
        client_reference_id: a.owner,
        metadata: { purchaseId, owner: a.owner },
        success_url: config.origin + "/settings?payment=confirming",
        cancel_url: config.origin + "/settings?payment=cancelled",
      },
      { idempotencyKey: purchaseId },
    );
    await store.transact(
      a.owner,
      (s) => (s.payments[purchaseId].sessionId = session.id),
    );
    return { url: session.url, purchaseId };
  });
  await app.register(async (hooks) => {
    hooks.removeContentTypeParser("application/json");
    hooks.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_r, body, done) => done(null, body),
    );
    hooks.post("/api/payments/webhook", async (req, rep) => {
      if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET)
        fail("billing_unavailable", "Billing is disabled.", 503);
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body as Buffer,
          String(req.headers["stripe-signature"] ?? ""),
          process.env.STRIPE_WEBHOOK_SECRET,
        );
      } catch {
        fail("invalid_signature", "Invalid payment signature.", 400);
      }
      if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded"
      ) {
        const fromEvent = event.data.object as Stripe.Checkout.Session;
        const session = await stripe.checkout.sessions.retrieve(fromEvent.id);
        const owner = session.metadata?.owner,
          purchaseId = session.metadata?.purchaseId;
        if (
          !owner ||
          !purchaseId ||
          session.payment_status !== "paid" ||
          session.mode !== "payment"
        )
          return { received: true, fulfilled: false };
        await store.transact(owner, (s) =>
          fulfill(s, owner, purchaseId, session, meterPolicy),
        );
      } else if (event.type === "charge.refunded") {
        const charge = event.data.object as Stripe.Charge;
        for (const owner of await store.owners())
          await store.transact(owner, (s) => {
            for (const p of Object.values(s.payments))
              if (p.paymentIntentId === charge.payment_intent && !p.refunded) {
                p.refundAmount = charge.amount_refunded;
                if (
                  charge.refunded &&
                  charge.amount_refunded === charge.amount
                ) {
                  p.refunded = true;
                  p.status = "refunded";
                  s.remainingSeconds = Math.max(0, s.remainingSeconds - 4800);
                } else p.refundReviewRequired = true;
              }
          });
      }
      return rep.send({ received: true });
    });
  });
}
