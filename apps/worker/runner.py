"""Separate, bounded ingestion process. API owns leases and fenced publication."""
from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error

API = os.environ.get("API_INTERNAL_ORIGIN", "http://127.0.0.1:3001").rstrip("/")
SECRET = os.environ.get("INTERNAL_WORKER_SECRET", "local-worker-development-secret")
if os.environ.get("NODE_ENV") == "production" and SECRET == "local-worker-development-secret":
    raise SystemExit("Set INTERNAL_WORKER_SECRET before production ingestion.")


def request(path: str, data=None, binary=False):
    target = path if path.startswith(API + "/") else API + path
    if not target.startswith(API + "/"):
        raise ValueError("Worker download must come from the configured API.")
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(target, data=body,
        headers={"Authorization": "Bearer " + SECRET, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as response:
        value = response.read(30 * 1024 * 1024)
        return value if binary else (json.loads(value) if value else None)


def once() -> bool:
    job = request("/internal/jobs/claim", {})
    if not job or not job.get("id"):
        return False
    payload = {"id": job["id"], "leaseToken": job["leaseToken"]}
    temporary = None
    try:
        path = job.get("path")
        if not path:
            # Construct the internal route; a job cannot nominate a remote URL.
            raw = request(f"/internal/jobs/{job['id']}/content", binary=True)
            with tempfile.NamedTemporaryFile(delete=False) as handle:
                handle.write(raw); temporary = handle.name
            path = temporary
        process = subprocess.run([sys.executable, str(Path(__file__).with_name("parser.py")), path, job["originalName"]],
                                 capture_output=True, text=True, encoding="utf-8", timeout=45)
        parsed = json.loads(process.stdout)
        if process.returncode or parsed.get("error"):
            payload["error"] = parsed.get("error", "This file could not be read.")
        else:
            if os.environ.get("ENABLE_HYBRID") == "true":
                embedded = subprocess.run([sys.executable, str(Path(__file__).with_name("embeddings.py"))],
                    input=json.dumps({"passages": parsed["passages"],"namespace":job["id"]}), capture_output=True, text=True,
                    encoding="utf-8", timeout=60)
                values = json.loads(embedded.stdout)
                if embedded.returncode or values.get("error"):
                    raise ValueError("The configured pinned semantic index is unavailable.")
                parsed["passages"] = values["passages"]
                parsed["embeddingRevision"] = values["embeddingRevision"]
            payload["result"] = parsed
    except subprocess.TimeoutExpired:
        payload["error"] = "Parsing timed out. Try a smaller file."
    except Exception:
        payload["error"] = "This file could not be read. Try uploading it again."
    finally:
        if temporary:
            Path(temporary).unlink(missing_ok=True)
    request("/internal/jobs/publish", payload)
    return True


if __name__ == "__main__":
    print("Ingestion worker ready (raw course data is not logged).", flush=True)
    while True:
        try:
            if not once():
                request("/internal/purges/run", {})
                time.sleep(0.5)
        except KeyboardInterrupt:
            break
        except Exception:
            print("Worker API unavailable; retrying shortly.", flush=True)
            time.sleep(2)
