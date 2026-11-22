/** Explicit bounded paid BFL probe. Synthetic content; never logs keys or delivery URLs. */
import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { generateIllustration } from "../apps/api/src/bfl.ts";
const file = "evals/results/illustration-live.json";
await mkdir("evals/results", { recursive: true });
await mkdir(".data", { recursive: true });
let report: any = {
  kind: "real-bfl-synthetic-content",
  attempts: [],
  invoiceReconciled: false,
};
try {
  report = JSON.parse(await readFile(file, "utf8"));
} catch {}
if (!process.env.BFL_API_KEY) {
  console.log("BFL credential absent; real illustration gate remains open.");
  process.exit(2);
}
if (report.attempts.length >= 3)
  throw Error(
    "Three-attempt probe limit reached. Review existing evidence before another paid probe.",
  );
const observation: any = {
  at: new Date().toISOString(),
  model: process.env.ILLUSTRATION_MODEL ?? "flux-2-klein-9b",
  status: "started",
  estimatedUsd: 0.015,
  priceVersion: "bfl-public-2026-11-19-768px",
  fixture: false,
};
report.attempts.push(observation);
await writeFile(file, JSON.stringify(report, null, 2));
const started = performance.now();
try {
  const result = await generateIllustration({
    key: process.env.BFL_API_KEY,
    baseUrl: process.env.BFL_BASE_URL ?? "https://api.bfl.ai",
    model: observation.model,
    width: 768,
    height: 768,
    signal: AbortSignal.timeout(95000),
    prompt:
      "A clean editorial illustration for an adult introductory statistics lesson: two transparent jars on a light neutral desk, containing a varied assortment of teal and amber wooden beads. A hand draws a small sample into a shallow tray beside the jars. Clear simple shapes, restrained teal and warm cream palette, spacious composition. Conceptual sampling illustration only; no charts, equations, numbers, labels, logos or text.",
    onSubmitted: (id) => {
      observation.taskDigest = createHash("sha256")
        .update(id)
        .digest("hex")
        .slice(0, 16);
    },
  });
  observation.status = "ready";
  observation.width = result.width;
  observation.height = result.height;
  observation.mime = result.mime;
  observation.bytes = result.bytes.length;
  const extension =
    result.mime === "image/png"
      ? "png"
      : result.mime === "image/jpeg"
        ? "jpg"
        : "webp";
  observation.localArtifact = `.data/live-illustration.${extension}`;
  await writeFile(observation.localArtifact, result.bytes);
} catch (e: any) {
  observation.status = "failed";
  observation.code = /^bfl_[a-z_]+$/.test(e.code) ? e.code : "provider_error";
  observation.chargeUnknown = e.submitted !== false;
  process.exitCode = 1;
}
observation.elapsedMs = Math.round(performance.now() - started);
await writeFile(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify(observation, null, 2));
