import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { Widget } from '@lumino/widgets';
import { LocalCompanion, pairingURL, sha256 } from './core.mjs';

type CellSnapshot = {documentId: string; notebookPath: string; cellId: string; cellIndex: number; source: string; revision: number; baseHash: string; cells?: {cellId: string; cellIndex: number; baseHash: string}[]};

class CompanionPanel extends Widget {
  private socket: WebSocket | null = null;
  private notebook: NotebookPanel | null = null;
  private documentId = '';
  private revisions = new Map<string, number>();
  private readonly status: HTMLParagraphElement;
  private readonly input: HTMLInputElement;
  private readonly preview: HTMLDivElement;
  private readonly stop: HTMLButtonElement;
  private readonly engine: LocalCompanion;
  private timer: ReturnType<typeof setInterval>;
  private sending = false;
  private previousFingerprint = '';

  constructor(private app: JupyterFrontEnd, private tracker: INotebookTracker) {
    super();
    this.id = 'live-tutor-companion';
    this.title.label = 'Live Tutor';
    this.title.caption = 'One notebook, locally approved edits';
    this.title.closable = true;
    this.node.style.cssText = 'padding:16px;overflow:auto;font:14px var(--jp-ui-font-family);min-width:240px;';
    const heading = document.createElement('h2'); heading.textContent = 'Study alongside your tutor';
    const note = document.createElement('p'); note.textContent = 'Share this notebook’s cell positions and selected cell text. Other cell text stays local until selected. Edits wait here for your Apply edit. The tutor cannot run cells.';
    const label = document.createElement('label'); label.textContent = 'Pairing URL from your lesson';
    this.input = document.createElement('input'); this.input.type = 'password'; this.input.autocomplete = 'off'; this.input.placeholder = 'wss://…/companion?secret=…'; this.input.style.width = '100%'; label.append(this.input);
    const connect = this.button('Pair this notebook', () => void this.connect());
    this.stop = this.button('Stop notebook sharing', () => this.disconnect('Notebook sharing stopped.'));
    this.stop.disabled = true;
    this.status = document.createElement('p'); this.status.setAttribute('role', 'status'); this.status.textContent = 'Open the notebook you want help with, then pair it.';
    this.preview = document.createElement('div');
    this.node.append(heading, note, label, connect, this.stop, this.status, this.preview);
    let receipts: any[] = [];
    try { receipts = JSON.parse(localStorage.getItem('live-tutor-companion-receipts-v1') || '[]'); } catch { /* invalid storage is not authority */ }
    this.engine = new LocalCompanion({
      read: (documentId: string, cellId: string) => this.read(documentId, cellId),
      focus: (cellId: string) => this.focusCell(cellId),
      highlight: (cellId: string, start: number, end: number) => this.highlight(cellId, start, end),
      write: (documentId: string, cellId: string, before: string, after: string) => this.write(documentId, cellId, before, after)
    }, {
      receipts,
      persist: (value: unknown) => { try { localStorage.setItem('live-tutor-companion-receipts-v1', JSON.stringify(value)); } catch { this.status.textContent = 'Receipt storage unavailable. Keep this panel open until the edit is confirmed.'; } },
      changed: () => this.renderPreview()
    });
    this.tracker.currentChanged.connect(this.onDocumentChanged, this);
    this.timer = setInterval(() => void this.refresh(), 1000);
  }

  private button(text: string, click: () => void) { const b = document.createElement('button'); b.textContent = text; b.style.cssText = 'min-height:44px;margin:8px 8px 8px 0;'; b.onclick = click; return b; }
  private send(value: unknown) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value)); }
  private onDocumentChanged() { if (this.notebook && this.tracker.currentWidget !== this.notebook) this.disconnect('Notebook changed. Pair again to share the new notebook.'); }
  private identity(panel: NotebookPanel) { return `${panel.id}:${panel.context.path}`; }

  private async connect() {
    try {
      const panel = this.tracker.currentWidget;
      if (!panel || panel.isDisposed || !panel.content.model) throw new Error('Open a JupyterLab 4 notebook first.');
      const url = pairingURL(this.input.value.trim());
      this.disconnect('Pairing…');
      this.notebook = panel; this.documentId = this.identity(panel); this.previousFingerprint = '';
      this.input.value = ''; // single-use bearer secret is not retained
      const socket = new WebSocket(url.toString()); this.socket = socket;
      socket.onmessage = event => void this.message(event.data);
      socket.onerror = () => this.disconnect('Connection failed. Return to your lesson for a new pairing URL.');
      socket.onclose = () => { if (this.socket === socket) this.disconnect('Connection lost. Pair again; pending edits were canceled.'); };
      this.status.textContent = 'Connecting to your lesson…';
    } catch (error) { this.status.textContent = error instanceof Error ? error.message : 'Pairing failed.'; }
  }

  private async message(raw: unknown) {
    try {
      if (typeof raw !== 'string' || raw.length > 50000) throw new Error('Invalid command.');
      const message = JSON.parse(raw);
      if (message.type === 'paired') {
        if (!this.notebook || !message.scopes?.every((scope: string) => ['watch', 'point', 'propose'].includes(scope))) throw new Error('Invalid notebook grant.');
        this.engine.pair(message, this.documentId); this.stop.disabled = false;
        this.status.textContent = `Sharing this notebook with ${String(message.courseName).slice(0, 120)}. Every edit needs your approval.`;
        await this.refresh();
      } else if (message.type === 'command') {
        const receipt = await this.engine.command(message.action); this.send({ type: 'receipt', receipt });
        if (['target_changed', 'expired', 'revoked'].includes(receipt.status)) this.status.textContent = 'Your cell or permission changed. Compare again.';
      } else if (message.type === 'receipt-query') {
        const receipt = this.engine.receipt(message.actionId);
        if (receipt) this.send({ type: 'receipt', receipt });
      } else if (message.type === 'revoked') this.disconnect('Notebook permission was revoked.');
      else throw new Error('Unsupported notebook command.');
    } catch { this.disconnect('The notebook command could not be verified. Pair again.'); }
  }

  private async read(documentId: string, cellId: string): Promise<CellSnapshot | null> {
    const panel = this.notebook;
    if (!panel || panel.isDisposed || this.tracker.currentWidget !== panel || this.identity(panel) !== documentId || !panel.content.model) return null;
    const cellIndex = panel.content.widgets.findIndex(cell => cell.model.id === cellId);
    const cell = panel.content.widgets[cellIndex]; if (!cell) return null;
    const source = cell.model.sharedModel.getSource();
    return { documentId, notebookPath: panel.context.path, cellId, cellIndex, source, revision: this.revisions.get(cellId) || 0, baseHash: await sha256(source) };
  }

  private async refresh() {
    if (!this.engine.grant || !this.notebook || this.sending) return;
    if (this.engine.grant.expiresAt <= Date.now()) { this.disconnect('Notebook permission expired. Pair again.'); return; }
    if (this.identity(this.notebook) !== this.documentId || this.tracker.currentWidget !== this.notebook) { this.disconnect('Notebook changed. Pair again.'); return; }
    const cell = this.notebook.content.activeCell; if (!cell) return;
    const panel = this.notebook, pairId = this.engine.grant.pairId;
    this.sending = true;
    try {
      const snapshot = await this.read(this.documentId, cell.model.id); if (!snapshot) return;
      if (snapshot.source.length > 20000) { this.disconnect('This cell is too large to share. Select a cell with fewer than 20,000 characters and pair again.'); return; }
      const cells = await Promise.all(panel.content.widgets.slice(0, 500).map(async (item, cellIndex) => ({ cellId: item.model.id, cellIndex, baseHash: await sha256(item.model.sharedModel.getSource()) })));
      if (this.notebook !== panel || !this.engine.grant || this.engine.grant.pairId !== pairId || this.identity(panel) !== this.documentId) return;
      snapshot.cells = cells;
      const fingerprint = `${snapshot.cellId}:${snapshot.baseHash}:${JSON.stringify(cells)}`;
      if (fingerprint !== this.previousFingerprint) {
        if (this.previousFingerprint) this.revisions.set(snapshot.cellId, (this.revisions.get(snapshot.cellId) || 0) + 1);
        snapshot.revision = this.revisions.get(snapshot.cellId) || 0;
        this.previousFingerprint = fingerprint;
        if (this.engine.pending && (this.engine.pending.action.cellId !== snapshot.cellId || this.engine.pending.action.baseHash !== snapshot.baseHash)) {
          const receipt = this.engine.dismiss('target_changed'); if (receipt) this.send({ type: 'receipt', receipt });
          this.status.textContent = 'Your cell changed. Compare again.';
        }
        this.send({ type: 'snapshot', ...snapshot });
      }
    } finally { this.sending = false; }
  }

  private focusCell(cellId: string) {
    if (!this.notebook) return;
    const index = this.notebook.content.widgets.findIndex(cell => cell.model.id === cellId);
    if (index >= 0) { this.notebook.content.activeCellIndex = index; this.app.shell.activateById(this.notebook.id); }
  }
  private highlight(cellId: string, start: number, end: number) {
    this.focusCell(cellId);
    const editor = this.notebook?.content.activeCell?.editor; if (!editor) return;
    const from = editor.getPositionAt(start), to = editor.getPositionAt(end);
    if (from && to) editor.setSelection({ start: from, end: to });
  }
  private write(documentId: string, cellId: string, before: string, after: string) {
    const panel = this.notebook;
    if (!this.engine.grant || this.engine.grant.expiresAt <= Date.now() || !panel || panel.isDisposed ||
        this.tracker.currentWidget !== panel || this.identity(panel) !== documentId || !panel.content.model) return null;
    const cell = panel.content.widgets.find(item => item.model.id === cellId);
    if (!cell || panel.content.activeCell?.model.id !== cellId || cell.model.sharedModel.getSource() !== before) return null;
    // JupyterLab defaults to per-cell text undo. Use the cell's host
    // transaction origin; wrapping this in a notebook transaction would bypass
    // the cell undo manager when document-wide undo is disabled.
    const shared = cell.model.sharedModel;
    const undo = (shared as typeof shared & {undoManager?: {stopCapturing(): void}}).undoManager;
    undo?.stopCapturing();
    shared.transact(() => cell.model.sharedModel.setSource(after));
    undo?.stopCapturing();
    const revision = (this.revisions.get(cellId) || 0) + 1; this.revisions.set(cellId, revision);
    return { revision };
  }

  private renderPreview() {
    if (!this.preview || !this.engine) return;
    this.preview.replaceChildren();
    const pending = this.engine.pending; if (!pending) return;
    const heading = document.createElement('h3'); heading.textContent = pending.undoOf ? 'Undo this one edit?' : 'Compare this cell edit';
    const beforeLabel = document.createElement('h4'); beforeLabel.textContent = 'Your current cell';
    const before = document.createElement('pre'); before.textContent = pending.before;
    const afterLabel = document.createElement('h4'); afterLabel.textContent = 'Proposed cell';
    const after = document.createElement('pre'); after.textContent = pending.after;
    for (const pre of [before, after]) pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;background:var(--jp-layout-color2);padding:12px;';
    const token = pending.token;
    const apply = this.button('Apply edit', () => { apply.disabled = true; void this.engine.apply(token).then(receipt => { this.send({ type: 'receipt', receipt }); this.status.textContent = receipt.status === 'applied' || receipt.status === 'undone' ? 'Edit applied in this notebook. Native undo is available.' : 'Your cell changed. Compare again.'; void this.refresh(); }); });
    const reject = this.button('Keep mine', () => { const receipt = this.engine.dismiss('rejected'); if (receipt) this.send({ type: 'receipt', receipt }); this.status.textContent = 'Kept your cell unchanged.'; });
    const controls = document.createElement('div');
    controls.style.cssText = 'position:sticky;top:0;background:var(--jp-layout-color1);padding:4px 0;z-index:1;';
    controls.append(apply, reject);
    this.preview.append(heading, controls, beforeLabel, before, afterLabel, after);
  }

  private disconnect(message: string) {
    this.engine?.revoke(); this.send({ type: 'revoke' });
    const socket = this.socket; this.socket = null; socket?.close(1000, 'local_stop');
    this.notebook = null; this.documentId = ''; this.previousFingerprint = '';
    this.stop.disabled = true; this.status.textContent = message;
  }
  protected onCloseRequest() { this.dispose(); }
  dispose() { if (this.isDisposed) return; clearInterval(this.timer); this.disconnect('Notebook sharing stopped.'); this.tracker.currentChanged.disconnect(this.onDocumentChanged, this); super.dispose(); }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: '@live-tutor/jupyterlab-companion:plugin', autoStart: true, requires: [INotebookTracker],
  activate: (app: JupyterFrontEnd, tracker: INotebookTracker) => {
    let panel: CompanionPanel | null = null;
    app.commands.addCommand('live-tutor:open', { label: 'Live Tutor: pair this notebook', execute: () => {
      if (!panel || panel.isDisposed) { panel = new CompanionPanel(app, tracker); app.shell.add(panel, 'right', { rank: 800 }); }
      app.shell.activateById(panel.id);
    } });
    // Keep the entry point visible; this opens no network connection or grant.
    panel = new CompanionPanel(app, tracker); app.shell.add(panel, 'right', { rank: 800 });
  }
};
export default plugin;
