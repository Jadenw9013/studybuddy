import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const run = (cmd, args) => {
  const p = spawnSync(cmd, args, {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, UV_PROJECT_ENVIRONMENT: path.resolve(".venv") },
  });
  if (p.status !== 0) process.exit(p.status ?? 1);
};
if (!existsSync(".env")) copyFileSync(".env.example", ".env");
process.env.UV_PROJECT_ENVIRONMENT = path.resolve(".venv");
const uvArgs = [
  "sync",
  "--frozen",
  "--project",
  "apps/worker",
  "--python",
  "3.12.12",
];
if (existsSync("apps/worker/.tools/bin/uv.exe"))
  run("apps/worker/.tools/bin/uv.exe", uvArgs);
else run("python", ["-m", "uv", ...uvArgs]);
mkdirSync("apps/web/public", { recursive: true });
copyFileSync(
  require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"),
  "apps/web/public/pdf.worker.min.mjs",
);
console.log(
  "Worker dependency environment installed. Run pnpm seed:demo. For Chromium: pnpm exec playwright install chromium. For live development: start Docker and supabase start; fill .env then pnpm db:migrate.",
);
