import { spawn } from "node:child_process";
import path from "node:path";
/** App-owned local adapter. Query text is stdin data, never shell input. */
export async function queryEmbedding(
  query: string,
): Promise<number[] | undefined> {
  if (process.env.ENABLE_HYBRID !== "true") return undefined;
  const python =
    process.env.PYTHON_PATH ??
    (process.platform === "win32"
      ? ".venv/Scripts/python.exe"
      : ".venv/bin/python");
  return new Promise((resolve, reject) => {
    const child = spawn(
      python,
      [path.resolve("apps/worker/embeddings.py"), "--query"],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: process.env },
    );
    let result = "";
    let failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill();
      reject(
        Error(
          "The semantic index could not answer in time. Disable hybrid retrieval or prepare the pinned local model.",
        ),
      );
    }, 20000);
    child.stdout.on("data", (b) => {
      result += b;
      if (result.length > 100000) {
        failed = true;
        child.kill();
      }
    });
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      reject(Error("The local embedding environment is unavailable."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed || code !== 0)
        return reject(
          Error(
            "The pinned local embedding model is unavailable. Prepare it or use lexical retrieval.",
          ),
        );
      try {
        resolve(JSON.parse(result).embedding);
      } catch {
        reject(Error("The embedding worker returned an invalid result."));
      }
    });
    child.stdin.end(JSON.stringify({ query }));
  });
}
