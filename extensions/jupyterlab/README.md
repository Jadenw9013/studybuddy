# Live Tutor JupyterLab companion

This extension shares one open JupyterLab 4 notebook. It can focus a cell, select text and preview a limited replacement. A remote message cannot apply an edit: **Apply edit** is a local button bound to the exact displayed diff. **Keep mine** and **Stop notebook sharing** preserve your text. It never runs a cell or opens a terminal.

Install with Python 3.12 and JupyterLab **4.6.6**. Run these Windows commands from the **repository root** after completing the repository's setup prerequisites. The observed host packages are pinned in `extensions/jupyterlab/host-requirements-windows.lock`:

```powershell
pnpm install --frozen-lockfile
pnpm run setup
.venv/Scripts/python.exe -m venv extensions/jupyterlab/.venv
extensions/jupyterlab/.venv/Scripts/python.exe -m pip install --requirement extensions/jupyterlab/host-requirements-windows.lock
pnpm --dir extensions/jupyterlab build
pnpm --dir extensions/jupyterlab build:labextension
extensions/jupyterlab/.venv/Scripts/python.exe extensions/jupyterlab/scripts/install-prebuilt.py
extensions/jupyterlab/.venv/Scripts/python.exe -m jupyterlab
```

The repository setup creates the root Python 3.12 environment; the next commands create a separate companion host environment. If that host environment is already installed, begin with the two extension build commands. On macOS/Linux use the environment's `bin/python` and install the matching JupyterLab release; the supplied host lock records Windows packages. `JUPYTER_PYTHON` can select another installed host for the federated build. The build uses the installed host's core package metadata and performs no registry lookup.

The prebuilt output is `live_tutor_companion/labextension`. Distribute that directory as a JupyterLab prebuilt extension after the real-notebook release checks pass. The installer copies only that known prebuilt package into the chosen environment's Jupyter labextensions directory. The source package does not install a Python server extension and exposes no local network listener.

1. Open the notebook you want to share in JupyterLab 4.
2. In the tutor lesson choose **Pair Jupyter**, then paste its single-use pairing URL into the **Live Tutor** side panel.
3. Read the course and shared scope. Use the notebook normally. The active cell's text and up to 500 cell IDs, positions and source hashes are sent to your lesson. Other cells' text stays local until you select or navigate to one. Focus/highlight targets must belong to this paired list; edit proposals target only the selected cell.
4. Compare a proposed edit in the local panel. Choose **Apply edit** or **Keep mine**. Native notebook undo remains available.
5. Stop sharing in either application. Closing the companion panel, changing/renaming the notebook, closing the connection or expiration cancels pending edits. Pair again to resume.

HTTPS/WSS is required for remote deployments. `ws://localhost` is permitted for local development only. A cross-origin WSS deployment must allow its origin in JupyterLab's Content Security Policy. The URL is a bearer secret: the panel clears it immediately and never saves it.

Receipts persist locally by action ID using status, source hashes and revision only. Cell contents and inverse edits stay in memory. After a reload, query a receipt to resolve a lost acknowledgement; an inverse that no longer exists must be compared again. Previously received cell text cannot be recalled from a remote device.

From the repository root, run `pnpm test:companion` for the local authority tests. The service/host test runs with `node --import tsx extensions/jupyterlab/evals/real-host.mjs` against a JupyterLab test host exposed on port 8891. Its launch flags are documented in the companion implementation notes. The observed results are **11/11 local authority checks** and **18/18 automated actual-host checks**, with **0 human approvals**. These synthetic checks do not establish human usability. See `docs/implementation/companion.md` at the repository root for the open human gate.
