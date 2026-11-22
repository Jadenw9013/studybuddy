import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const publicDirectory = path.join(root, "apps", "web", "public");
mkdirSync(publicDirectory, { recursive: true });
copyFileSync(
  require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"),
  path.join(publicDirectory, "pdf.worker.min.mjs"),
);

// A hosting environment can accidentally supply development. The production
// build must select the matching React and Next.js production implementations.
const result = spawnSync(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "build", "apps/web", ...process.argv.slice(2)],
  {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "inherit",
    windowsHide: true,
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
