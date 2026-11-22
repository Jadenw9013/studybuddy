# Approved DSA voice allowance change

The user explicitly approved this bounded change. It has been applied and verified; all previous records remain intact.

The final observed session stopped after 70 active seconds because its recorded input text provision crossed the configured **80,000 tokens per live reservation**: 76,122 + 6,928 = 83,050. The reservation spans reconnects. This was the configured token circuit breaker, not a provider credit denial or exhausted lesson minutes.

The read-only audit matched all 15 unique provider observations to their single stored settlement. It found no duplicate settlement charge or unknown cost. The session's conservative application estimate was $0.1558275; its frozen maximum was $0.775. Review confirmed no pending holds and sufficient remaining lesson time within the unchanged $7.60 application ceiling. Detailed account balances and ledger snapshots remain local. These are application provisions, not an invoice reconciliation.

## Applied approved scope

1. Changed only `MODEL_UNIT_LIMITS_JSON.live.input.TEXT` from **80,000 to 160,000** in the local development environment.
2. Kept every other unit limit, model rate, lesson time allowance and the **$7.60 application ceiling** unchanged. At the configured $0.75 per million input text tokens, the additional maximum input-text exposure is **$0.06 per live reservation**; the corresponding reservation maximum is $0.835. This does not promise that the entire 20-minute gate will fit.
3. Cleared only the reviewed current pass's `provider_unit_ceiling_exceeded` pause after rechecking its audit, known cost, completed settlement and unchanged financial ceiling. Preserved all recorded usage, spending, failed histories and frozen old reservations. No minutes were refilled and the pass was not reset.
4. Used **one additional individually reviewed, 120-second browser verification** of the same nine-turn sequence. Retained the three earlier provider attempts and two infrastructure preflights. This was an explicitly approved extension of the original three-attempt cap, with no reset or automatic retry.

Maintenance proved that only the specified input-text limit and reviewed pause changed. All other environment bytes, old reservations, frozen rates/limits, remaining minutes and normalized usage records were preserved. The extra test was used once: it failed at a repeated create-on-existing-board operation, rather than a usage ceiling. No further paid retry was performed. See [the current voice results](dsa-voice-switching.md).

The read-only audit utility is `evals/live/dsa-budget-audit.ts`. Detailed evidence, approval and one-use maintenance remain local and excluded from Git.
