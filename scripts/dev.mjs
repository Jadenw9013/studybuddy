import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import "dotenv/config";
const fixture = process.argv.includes("--fixture");
if (fixture) {
  process.env.APP_MODE = "fixture";
  process.env.NODE_ENV = "development";
  process.env.DEV_AUTH_BYPASS = "false";
  process.env.INTERNAL_WORKER_SECRET ||= "local-worker-development-secret";
}
process.env.APP_MODE ||= "live";
const children = [];
const launch = (command, args) => {
  const p = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  });
  children.push(p);
  p.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`${command} stopped (${code})`);
      stop();
    }
  });
  p.on("error", (e) => {
    console.error(e.message);
    stop();
  });
};
const node = process.execPath;
launch(node, ["--import", "tsx", "apps/api/src/index.ts"]);
launch(node, [
  "node_modules/next/dist/bin/next",
  "dev",
  "apps/web",
  "-p",
  "3000",
  "--hostname",
  "127.0.0.1",
]);
const python =
  process.env.PYTHON_PATH ||
  (process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python");
if (existsSync(python)) launch(python, ["apps/worker/runner.py"]);
else
  console.error(
    "Worker environment missing. Run pnpm run setup; uploads will remain indexing.",
  );
function stop() {
  for (const p of children) p.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
