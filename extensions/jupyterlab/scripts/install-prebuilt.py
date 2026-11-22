"""Install this project's already-built extension into the selected Python prefix."""
from pathlib import Path
import json
import shutil
import sys

root = Path(__file__).resolve().parent.parent
source = root / "live_tutor_companion" / "labextension"
metadata = json.loads((source / "package.json").read_text(encoding="utf-8"))
assert metadata["name"] == "@live-tutor/jupyterlab-companion"
assert metadata["jupyterlab"].get("_build", {}).get("load"), "Run pnpm build and pnpm build:labextension first."
target = Path(sys.prefix).resolve() / "share" / "jupyter" / "labextensions" / "@live-tutor" / "jupyterlab-companion"
assert target.is_relative_to(Path(sys.prefix).resolve())
shutil.copytree(source, target, dirs_exist_ok=True)
print(f"Installed prebuilt companion 0.1.0 into {target}")
