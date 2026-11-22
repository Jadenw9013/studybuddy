import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import "dotenv/config";
const python =
  process.env.PYTHON_PATH ||
  (process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python");
const p = spawnSync(python, ["scripts/generate-fixtures.py"], {
  stdio: "inherit",
  windowsHide: true,
});
process.exit(p.status ?? 1);
