/** A transport-free local authority. No remote message can call apply(). */
export class LocalCompanion {
  constructor(host, options = {}) {
    this.host = host;
    this.now = options.now || Date.now;
    this.hash = options.hash || sha256;
    this.persist = options.persist || (() => {});
    this.changed = options.changed || (() => {});
    const saved = Array.isArray(options.receipts) ? options.receipts : [];
    this.receipts = new Map(saved.slice(-200).filter(entry => Array.isArray(entry) && entry.length === 2 &&
      typeof entry[0] === 'string' && /^[a-f0-9]{64}$/.test(entry[1]?.payload || '') &&
      entry[1]?.receipt?.actionId === entry[0] && typeof entry[1]?.receipt?.status === 'string'));
    this.actions = new Map();
    this.inverses = new Map();
    this.grant = null;
    this.lessonId = null;
    this.pending = null;
    this.serial = Promise.resolve();
  }

  pair(grant, documentId) {
    if (!grant || !Array.isArray(grant.scopes) || grant.expiresAt <= this.now() || !documentId) throw new Error('Pairing expired.');
    this.revoke();
    this.grant = { ...grant, documentId };
    this.lessonId = grant.lessonId || null;
    this.changed();
  }

  revoke() {
    this.grant = null;
    this.pending = null;
    this.inverses.clear();
    this.changed();
  }

  receipt(actionId) {
    const prior = this.receipts.get(actionId);
    return this.grant && prior?.lessonId === this.lessonId ? prior.receipt : null;
  }

  finish(action, payload, status, details = {}) {
    const receipt = { actionId: action.actionId, status, ...details };
    this.receipts.set(action.actionId, { payload, receipt, lessonId: this.lessonId });
    // Receipts intentionally contain hashes and status only, never cell source.
    this.persist([...this.receipts.entries()].slice(-200));
    this.changed();
    return receipt;
  }

  live(action, scope) {
    return Boolean(this.grant && this.grant.expiresAt > this.now() &&
      action.expiresAt > this.now() && action.expiresAt <= this.grant.expiresAt &&
      this.grant.documentId === action.documentId && this.grant.scopes.includes(scope));
  }

  async target(action) {
    const snapshot = await this.host.read(action.documentId, action.cellId);
    if (!snapshot || snapshot.documentId !== action.documentId || snapshot.cellId !== action.cellId ||
        await this.hash(snapshot.source) !== action.baseHash) return null;
    return snapshot;
  }

  command(action) {
    const work = this.serial.then(() => this.commandOnce(action));
    this.serial = work.catch(() => {});
    return work;
  }

  async commandOnce(action) {
    const allowed = ['notebook.focus', 'notebook.highlight', 'notebook.propose', 'notebook.undo'];
    if (!action || typeof action.actionId !== 'string' || !/^[\w-]{1,128}$/.test(action.actionId) ||
        !allowed.includes(action.type) || typeof action.documentId !== 'string' || typeof action.cellId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(action.baseHash || '') || !Number.isFinite(action.expiresAt) ||
        !action.args || typeof action.args !== 'object' || Array.isArray(action.args) ||
        Object.keys(action.args).some(key => !['replacement', 'start', 'end', 'expectedHash', 'undoActionId'].includes(key))) {
      return { actionId: action?.actionId, status: 'invalid_params' };
    }
    const payload = await this.hash(JSON.stringify({ lessonId: this.lessonId, action }));
    const prior = this.receipts.get(action.actionId);
    if (prior) return prior.payload === payload ? prior.receipt : { actionId: action.actionId, status: 'payload_conflict' };
    if (this.actions.has(action.actionId) && this.actions.get(action.actionId) !== payload)
      return { actionId: action.actionId, status: 'payload_conflict' };
    this.actions.set(action.actionId, payload);
    const scope = action.type === 'notebook.focus' ? 'watch' : action.type === 'notebook.highlight' ? 'point' : 'propose';
    if (!this.live(action, scope)) return this.finish(action, payload, this.grant ? 'expired' : 'revoked');
    const current = await this.target(action);
    if (!current || !this.live(action, scope)) return this.finish(action, payload, 'target_changed');
    if (action.type === 'notebook.focus') {
      await this.host.focus(action.cellId);
      return this.finish(action, payload, 'focused', { baseHash: action.baseHash, revision: current.revision });
    }
    if (action.type === 'notebook.highlight') {
      const { start, end } = action.args;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > current.source.length)
        return this.finish(action, payload, 'invalid_params');
      await this.host.highlight(action.cellId, start, end);
      return this.finish(action, payload, 'highlighted', { baseHash: action.baseHash, revision: current.revision });
    }
    let replacement = action.args.replacement;
    let undoOf;
    if (action.type === 'notebook.undo') {
      const inverse = this.inverses.get(action.args.undoActionId);
      if (!inverse || inverse.documentId !== action.documentId || inverse.cellId !== action.cellId || inverse.newHash !== action.baseHash)
        return this.finish(action, payload, 'target_changed');
      replacement = inverse.before;
      undoOf = action.args.undoActionId;
    }
    if (typeof replacement !== 'string' || replacement.length > 20000 || !/^[a-f0-9]{64}$/.test(action.args.expectedHash || '') ||
        await this.hash(replacement) !== action.args.expectedHash)
      return this.finish(action, payload, 'invalid_params');
    if (this.pending && this.pending.action.actionId !== action.actionId) this.dismiss('dismissed');
    this.pending = { action, payload, before: current.source, after: replacement, undoOf, token: crypto.randomUUID() };
    this.changed();
    return { actionId: action.actionId, status: 'previewed', baseHash: action.baseHash, revision: current.revision };
  }

  dismiss(status = 'dismissed') {
    if (!this.pending) return null;
    const pending = this.pending;
    this.pending = null;
    return this.finish(pending.action, pending.payload, status);
  }

  /** Called only by the local UI button, with the token of the visible diff. */
  async apply(token) {
    const pending = this.pending;
    if (!pending || pending.token !== token) return { status: 'revoked' };
    this.pending = null; // consume locally before the first await
    const { action, payload } = pending;
    if (!this.live(action, 'propose')) return this.finish(action, payload, 'expired');
    const current = await this.target(action);
    if (!current || current.source !== pending.before || !this.live(action, 'propose')) return this.finish(action, payload, 'target_changed');
    // host.write must synchronously recheck the exact source and current document.
    const result = this.host.write(action.documentId, action.cellId, pending.before, pending.after);
    if (!result) return this.finish(action, payload, 'target_changed');
    // The replacement was hashed before preview. Keep write + durable receipt in
    // one synchronous task so an acknowledgement loss cannot invite a replay.
    const newHash = action.args.expectedHash;
    this.inverses.set(action.actionId, { documentId: action.documentId, cellId: action.cellId, before: pending.before, newHash });
    if (pending.undoOf) this.inverses.delete(pending.undoOf);
    return this.finish(action, payload, pending.undoOf ? 'undone' : 'applied', { baseHash: action.baseHash, newHash, revision: result.revision });
  }
}

export async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function pairingURL(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.pathname !== '/companion' || (url.protocol !== 'wss:' && !(local && url.protocol === 'ws:')) ||
      url.username || url.password || url.hash || !/^[A-Za-z0-9_-]{43,128}$/.test(url.searchParams.get('secret') || '') ||
      [...url.searchParams.keys()].some(key => key !== 'secret')) throw new Error('Paste the secure pairing URL from your lesson.');
  return url;
}
