import {canonical} from '../../../packages/contracts/index.ts';
import type { FastifyInstance } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { uid, lesson, fail, type Store } from "./store.ts";
import type { Config } from "./config.ts";
type Pair = {
  id: string;
  owner: string;
  lessonId: string;
  expiresAt: number;
  secretHash: string;
  socket?: any;
  snapshot?: any;
  revoked: boolean;
  pending: Map<string, any>;
  requests: Map<string, string>;
};
export async function registerCompanion(
  app: FastifyInstance,
  deps: {
    config: Config;
    store: Store;
    auth: (req: any) => Promise<{ owner: string }>;
  },
) {
  const pairs = new Map<string, Pair>();
  const digest = (s: string) => createHash("sha256").update(s).digest("hex");
  const getPair = (owner: string, id: string) =>
    [...pairs.values()].find(
      (p) =>
        p.owner === owner &&
        p.lessonId === id &&
        !p.revoked &&
        p.expiresAt > Date.now(),
    );
  const revoke = (p: Pair) => {
    p.revoked = true;
    p.socket?.send(JSON.stringify({ type: "revoked" }));
    p.socket?.close();
    p.pending.clear();
    delete p.snapshot;
    void deps.store.transact(p.owner,s=>{const grant=s.grants?.find(g=>g.id===p.id);if(grant)grant.revokedAt=Date.now();}).catch(()=>{});
  };
  app.post<{ Params: { id: string } }>("/api/lessons/:id/pair", async (req) => {
    const a = await deps.auth(req);
    const l = await deps.store.transact(a.owner, (s) =>
      lesson(s, req.params.id),
    );
    if (!deps.config.companion)
      fail("unsupported", "The notebook companion is disabled.");
    const old = getPair(a.owner, l.id);
    if (old) revoke(old);
    const secret = randomBytes(32).toString("base64url");
    const p: Pair = {
      id: uid(),
      owner: a.owner,
      lessonId: l.id,
      expiresAt: Date.now() + 5 * 60_000,
      secretHash: digest(secret),
      revoked: false,
      pending: new Map(),
      requests: new Map(),
    };
    pairs.set(p.id, p);
    await deps.store.transact(a.owner,s=>{s.grants??=[];s.grants.push({id:p.id,lessonId:l.id,scopes:['watch','point','propose'],nonceDigest:p.secretHash,expiresAt:p.expiresAt});});
    return {
      pairId: p.id,
      secret,
      expiresAt: p.expiresAt,
      url:
        deps.config.origin
          .replace(/^http/, "ws")
          .replace(":3000", ":" + deps.config.port) +
        "/companion?secret=" +
        secret,
    };
  });
  app.get<{ Params: { id: string } }>(
    "/api/lessons/:id/companion",
    async (req) => {
      const a = await deps.auth(req);
      await deps.store.transact(a.owner, (s) => lesson(s, req.params.id));
      const p = getPair(a.owner, req.params.id);
      return {
        paired: Boolean(p?.socket?.readyState === 1),
        snapshot: p?.snapshot ?? null,
        expiresAt: p?.expiresAt,
      };
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/lessons/:id/companion",
    async (req) => {
      const a = await deps.auth(req);
      await deps.store.transact(a.owner, (s) => lesson(s, req.params.id));
      const p = getPair(a.owner, req.params.id);
      if (p) revoke(p);
      return { revoked: true };
    },
  );
  const dispatch = async (owner: string, lessonId: string, input: any) => {
    const l = await deps.store.transact(owner, (s) => lesson(s, lessonId));
    const p = getPair(owner, l.id),
      b: any = input;
    if (!p?.socket || p.socket.readyState !== 1 || !p.snapshot)
      fail("target_changed", "Pair your active notebook first.");
    if (
      ![
        "notebook.focus",
        "notebook.highlight",
        "notebook.propose",
        "notebook.undo",
      ].includes(b?.type)
    )
      fail("unsupported", "This notebook action is not allowed.");
    if (
      typeof b.actionId !== "string" ||
      b.actionId.length > 128 ||
      b.turnEpoch !== l.epoch
    )
      fail("stale_turn", "The notebook request expired.");
    const fingerprint = digest(canonical({
      type: b.type,
      turnEpoch: b.turnEpoch,
      args: b.args ?? {},
    }));
    const saved=l.receipts[b.actionId];
    if(saved){let prior:any;try{prior=JSON.parse(saved.payload);}catch{}if(prior?.fingerprint!==fingerprint)fail('payload_conflict','This notebook action ID was reused.');return ['preview_requested','previewed','preview','checking_edit'].includes(saved.receipt.status)?{status:'checking_edit',actionId:b.actionId}:saved.receipt;}
    const earlier = p.requests.get(b.actionId);
    if (earlier) {
      if (earlier !== fingerprint)
        fail("payload_conflict", "This notebook action ID was reused.");
      return { status: "checking_edit", actionId: b.actionId };
    }
    const snapshot = p.snapshot;
    const action = {
      actionId: b.actionId,
      type: b.type,
      documentId: snapshot.documentId,
      cellId: snapshot.cellId,
      baseHash: snapshot.baseHash,
      expiresAt: Math.min(p.expiresAt, Date.now() + 60_000),
      args: b.args ?? {},
    };
    if(action.args.cellId!==undefined){if(!['notebook.focus','notebook.highlight'].includes(action.type)||typeof action.args.cellId!=='string')fail('invalid_params','Only focus and highlight may select another cell.',400);const target=(snapshot.cells??[{cellId:snapshot.cellId,baseHash:snapshot.baseHash}]).find((cell:any)=>cell.cellId===action.args.cellId);if(!target)fail('target_changed','That cell is outside the paired notebook.');action.cellId=target.cellId;action.baseHash=target.baseHash;action.args={...action.args};delete action.args.cellId;}
    if (
      Object.keys(action.args).some(
        (k) =>
          ![
            "replacement",
            "start",
            "end",
            "expectedHash",
            "undoActionId",
          ].includes(k),
      ) ||
      JSON.stringify(action.args).length > 20000
    )
      fail("invalid_params", "Use one limited cell edit.", 400);
    if (action.type === "notebook.propose") {
      if (typeof action.args.replacement !== "string")
        fail("invalid_params", "Enter a cell replacement.", 400);
      action.args.expectedHash = digest(action.args.replacement);
    }
    if (action.type === "notebook.undo") {
      const original = p.pending.get(action.args.undoActionId);
      if (!original)
        fail("target_changed", "The approved edit is unavailable.");
      action.args.expectedHash = original.baseHash;
    }
    p.requests.set(b.actionId, fingerprint);
    const prior = p.pending.get(b.actionId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(action))
      fail("payload_conflict", "This notebook action ID was reused.");
    if (!prior) {
      const intent={...action,args:{expectedHash:action.args.expectedHash}};
      await deps.store.transact(owner,s=>{const current=lesson(s,lessonId);if(current.epoch!==b.turnEpoch||p.revoked)fail('stale_turn','The notebook request expired.');current.receipts[b.actionId]={payload:JSON.stringify({fingerprint,action:intent}),receipt:{actionId:b.actionId,status:'preview_requested',external:true}};});
      p.pending.set(b.actionId, action);
      if(p.revoked||p.socket.readyState!==1)fail('target_changed','Notebook connection changed. Query the original action before retrying.');
      p.socket.send(JSON.stringify({ type: "command", action }));
    }
    return { status: "preview_requested", actionId: b.actionId };
  };
  app.post<{ Params: { id: string }; Body: any }>(
    "/api/lessons/:id/companion/actions",
    async (req) => {
      const a = await deps.auth(req);
      return dispatch(a.owner, req.params.id, req.body);
    },
  );
  app.get<{ Params: { id: string; actionId: string } }>(
    "/api/lessons/:id/companion/actions/:actionId",
    async (req) => {
      const a = await deps.auth(req);
      const l = await deps.store.transact(a.owner, (s) =>
        lesson(s, req.params.id),
      );
      const receipt = l.receipts[req.params.actionId];
      if (receipt&&!['preview_requested','preview','previewed','checking_edit'].includes(receipt.receipt.status)) return receipt.receipt;
      const p = getPair(a.owner, l.id);
      p?.socket?.send(
        JSON.stringify({
          type: "receipt-query",
          actionId: req.params.actionId,
        }),
      );
      return { status: "checking_edit" };
    },
  );
  app.get("/companion", { websocket: true }, (socket, req) => {
    const secret = (req.query as any)?.secret;
    const hash = typeof secret === "string" ? digest(secret) : "";
    const p = [...pairs.values()].find(
      (p) =>
        !p.revoked &&
        !p.socket &&
        p.secretHash === hash &&
        p.expiresAt > Date.now(),
    );
    if (!p) {
      socket.close(1008, "Pairing expired");
      return;
    }
    p.secretHash = "consumed";
    p.socket = socket;
    p.expiresAt = Date.now() + 20 * 60_000;
    socket.send(
      JSON.stringify({
        type: "paired",
        pairId: p.id,
        lessonId: p.lessonId,
        courseName: "Your private statistics lesson",
        expiresAt: p.expiresAt,
        scopes: ["watch", "point", "propose"],
      }),
    );
    socket.on("message", async (raw) => {
      try {
        const e = JSON.parse(raw.toString());
        if (p.revoked || p.expiresAt < Date.now()) {
          revoke(p);
          return;
        }
        if (e.type === "revoke" || e.type === "stop") {
          revoke(p);
          return;
        }
        if (e.type === "snapshot") {
          if (
            !e.documentId ||
            !e.cellId ||
            typeof e.source !== "string" ||
            e.source.length > 20000 ||
            digest(e.source) !== e.baseHash
          ) {
            socket.close(1008, "Invalid snapshot");
            return;
          }
          if (p.snapshot && p.snapshot.documentId !== e.documentId) {
            revoke(p);
            return;
          }
          p.snapshot = e;
        }
        if (e.type === "receipt") {
          const receipt = e.receipt ?? e;
          let action = p.pending.get(receipt.actionId);
          if(!action){const saved=await deps.store.transact(p.owner,s=>lesson(s,p.lessonId).receipts[receipt.actionId]);if(saved?.receipt.external){try{action=JSON.parse(saved.payload).action;}catch{}}}
          if (!action) return;
          const allowed = [
            "applied",
            "rejected",
            "dismissed",
            "target_changed",
            "expired",
            "revoked",
            "focused",
            "highlighted",
            "undone",
            "preview",
            "previewed",
          ];
          if (!allowed.includes(receipt.status)) return;
          if (
            ["applied", "undone"].includes(receipt.status) &&
            receipt.newHash !== action.args.expectedHash
          )
            return;
          if(receipt.baseHash&&receipt.baseHash!==action.baseHash)return;
          await deps.store.transact(p.owner, (s) => {
            const l = lesson(s, p.lessonId);
            const previous=l.receipts[receipt.actionId];
            if(!previous?.receipt.external)return;
            if(!['preview_requested','preview','previewed','checking_edit'].includes(previous.receipt.status))return;
            l.receipts[receipt.actionId] = {
              payload: previous.payload,
              receipt: {
                actionId: receipt.actionId,
                status: receipt.status,
                newHash: receipt.newHash,
                revision: receipt.revision,
                external: true,
              },
            };
          });
        }
      } catch {
        socket.close(1008, "Invalid companion event");
      }
    });
    socket.on("close", () => {
      p.revoked = true;
      delete p.snapshot;
      p.pending.clear();
    });
  });
  app.addHook("onClose", async () => {
    for (const p of pairs.values()) revoke(p);
  });
  return {
    dispatch,
    snapshot: (owner: string, lessonId: string) =>
      getPair(owner, lessonId)?.snapshot ?? null,
    revokeLesson: (owner: string, lessonId: string) => {
      for (const p of pairs.values())
        if (p.owner === owner && p.lessonId === lessonId && !p.revoked)
          revoke(p);
    },
  };
}
