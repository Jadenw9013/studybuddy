import type { State } from "./store.ts";
import { fail } from "./store.ts";
import type { IllustrationJob } from "./illustration-types.ts";
import { paidPassPeriod } from "./meter.ts";

/** Image holds share the same locked per-pass budget as speech and text. */
export function reserveImage(
  s: State,
  job: IllustrationJob,
  ceilingUsd: number,
  dailyLimit: number,
) {
  const period = paidPassPeriod(s, job.createdAt);
  if (period && !period.active)
    fail(
      "entitlement_expired",
      "Your pass is inactive. Your saved lesson remains available.",
    );
  const day = new Date(job.createdAt).toISOString().slice(0, 10);
  if ((s.illustrationDays?.[day] ?? 0) >= dailyLimit)
    fail("quota_exhausted", "Today's illustration limit is reached.", 429);
  if (
    !Number.isFinite(ceilingUsd) ||
    ceilingUsd <= 0 ||
    !Number.isFinite(job.estimateUsd) ||
    job.estimateUsd <= 0
  )
    fail(
      "cost_controls_unconfigured",
      "Illustration cost controls are unavailable.",
      503,
    );
  s.metering ??= { activePassId: "pilot", passes: {}, textDays: {} };
  const passId = s.metering.activePassId;
  const pass = (s.metering.passes[passId] ??= {
    spentUsd: 0,
    heldUsd: 0,
    ceilingUsd,
    unknownCost: false,
    conservativeProvisionUsd: 0,
  });
  if (pass.unknownCost || pass.blockedReason)
    fail("budget_blocked", "Paid work is paused pending usage reconciliation.");
  if (
    pass.spentUsd + pass.heldUsd + job.estimateUsd >
    Math.min(ceilingUsd, pass.ceilingUsd) + 1e-10
  )
    fail("quota_exhausted", "This pass reached its cost ceiling.", 429);
  job.passId = passId;
  pass.heldUsd = round(pass.heldUsd + job.estimateUsd);
  s.illustrationDays ??= {};
  s.illustrationDays[day] = (s.illustrationDays[day] ?? 0) + 1;
}

/** Estimates are versioned prices, never claimed to be provider invoices. Unknown requests retain a provision. */
export function settleImage(
  s: State,
  job: IllustrationJob,
  outcome: "estimated" | "unknown" | "released",
) {
  if (job.costState !== "reserved") return;
  const pass = s.metering?.passes[job.passId];
  if (!pass)
    fail("budget_blocked", "The illustration budget needs reconciliation.");
  if (outcome === "estimated") {
    pass.heldUsd = round(Math.max(0, pass.heldUsd - job.estimateUsd));
    pass.spentUsd = round(pass.spentUsd + job.estimateUsd);
  } else if (outcome === "released") {
    pass.heldUsd = round(Math.max(0, pass.heldUsd - job.estimateUsd));
  } else {
    pass.unknownCost = true;
    pass.blockedReason = "illustration_charge_unknown";
    pass.conservativeProvisionUsd = round(
      pass.conservativeProvisionUsd + job.estimateUsd,
    );
  }
  job.costState = outcome;
}
const round = (n: number) => Math.round(n * 1e12) / 1e12;
