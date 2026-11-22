import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveAudio } from '../../apps/web/components/live.js';

// Synthetic browser lifecycle tests. These do not measure actual microphone or playback latency.
function browser(t: any, options: { provider?: boolean; pendingMic?: Promise<any> } = {}) {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: any) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  let requested = 0, tracksStopped = 0;
  const track = { onended: null as (() => void) | null, stop() { tracksStopped++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const contexts: any[] = [], sockets: FakeSocket[] = [], nodes: any[] = [];
  class FakeContext {
    currentTime = 0; destination = {}; closed = false;
    audioWorklet = { addModule: async () => undefined };
    constructor() { contexts.push(this); }
    async resume() {}
    async close() { this.closed = true; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createBuffer(_channels: number, length: number, rate: number) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { const node = { buffer: null, onended: null, stopped: false, startedAt: undefined as number | undefined, connect() {}, disconnect() {}, start(when: number) { this.startedAt = when; }, stop() { this.stopped = true; } }; nodes.push(node); return node; }
  }
  class FakeWorklet {
    port = { onmessage: null, postMessage() {} };
    connect() {} disconnect() {}
  }
  class FakeSocket {
    static OPEN = 1;
    readyState = 0; bufferedAmount = 0;
    onopen: null | (() => void) = null;
    onclose: null | ((event: any) => void) = null;
    onerror: null | (() => void) = null;
    onmessage: null | ((event: any) => void) = null;
    sent: any[] = [];
    constructor(public url: string) { sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(data: any) { this.sent.push(data); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: 'end' }); }
    message(data: any) { this.onmessage?.({ data: JSON.stringify(data) }); }
  }
  install('window', { location: { origin: 'http://localhost:3000' }, addEventListener() {}, removeEventListener() {} });
  install('navigator', { mediaDevices: { getUserMedia: async () => { requested++; return options.pendingMic ?? stream; } } });
  install('AudioContext', FakeContext); install('AudioWorkletNode', FakeWorklet); install('WebSocket', FakeSocket);
  install('fetch', async () => ({ ok: options.provider !== false, json: async () => options.provider === false
    ? { message: 'Live voice is unavailable. Continue by typing.' }
    : { wsPath: '/live?ticket=synthetic-only', expiresAt: Date.now() + 30_000 } }));
  t.after(() => { for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as any)[name]; } });
  return { contexts, sockets, nodes, stream, track, requested: () => requested, tracksStopped: () => tracksStopped };
}

test('streamed captions accumulate within a speaker turn and playback remains speaking until drained', async t => {
  const env = browser(t), captions: string[] = [], states: string[] = [];
  const live = new LiveAudio(value => states.push(value), value => captions.push(value), () => {});
  await live.start('lesson-test', 'http://localhost:3001');
  t.after(() => live.stop());
  const socket = env.sockets[0];
  socket.message({ type: 'state', state: 'listening', turnEpoch: 1 });
  socket.message({ type: 'caption', speaker: 'tutor', text: 'The peak ', turnEpoch: 1 });
  socket.message({ type: 'caption', speaker: 'tutor', text: 'is a density.', turnEpoch: 1 });
  assert.equal(captions.at(-1), 'The peak is a density.');
  socket.message({ type: 'audio', sampleRate: 24000, data: Buffer.alloc(480).toString('base64'), turnEpoch: 1 });
  socket.message({ type: 'state', state: 'listening', turnEpoch: 1 });
  assert.equal(states.at(-1), 'Tutor speaking');
  env.nodes[0].onended();
  assert.equal(states.at(-1), 'Listening');
  socket.message({ type: 'caption', speaker: 'student', text: 'Why?', turnEpoch: 1 });
  assert.equal(captions.at(-1), 'Why?');
});

test('a normal eight-second audio burst stays continuous without requesting interruption or reconnect', async t => {
  const env = browser(t), states: string[] = [], captions: string[] = [];
  const live = new LiveAudio(status => states.push(status), text => captions.push(text), () => {});
  await live.start('lesson-test', 'http://localhost:3001');
  t.after(() => live.stop());
  const socket = env.sockets[0];
  socket.message({ type: 'state', state: 'listening', turnEpoch: 1 });
  socket.message({ type: 'caption', speaker: 'tutor', text: 'A continuous explanation.', turnEpoch: 1 });
  const audio = { type: 'audio', sampleRate: 24000, data: Buffer.alloc(24000).toString('base64'), turnEpoch: 1 };
  for (let chunk = 0; chunk < 16; chunk++) socket.message(audio);
  assert.equal(env.nodes.length, 16, 'all eight seconds must be queued, rather than restarting at five seconds');
  assert.equal(env.nodes.every(node => !node.stopped), true);
  for (let chunk = 1; chunk < env.nodes.length; chunk++) {
    assert.ok(Math.abs(env.nodes[chunk].startedAt - env.nodes[chunk - 1].startedAt - 0.5) < 1e-9);
  }
  assert.equal(live.closed, false);
  assert.equal(socket.sent.some(raw => typeof raw === 'string' && ['interrupt', 'reconnect'].includes(JSON.parse(raw).type)), false);
  socket.message({ type: 'state', state: 'listening', turnEpoch: 1 });
  assert.equal(states.at(-1), 'Tutor speaking');
  assert.equal(captions.at(-1), 'A continuous explanation.');
  env.contexts[0].currentTime = live.next;
  for (const node of env.nodes) node.onended();
  assert.equal(live.playing.size, 0);
  assert.equal(states.at(-1), 'Listening');
});

test('an excessive playback backlog stops voice visibly instead of silently restarting a lesson', async t => {
  const env = browser(t), states: string[] = [];
  const live = new LiveAudio(status => states.push(status), () => {}, () => {});
  await live.start('lesson-test', 'http://localhost:3001');
  t.after(() => live.stop());
  const socket = env.sockets[0];
  socket.message({ type: 'state', state: 'listening', turnEpoch: 1 });
  const audio = { type: 'audio', sampleRate: 24000, data: Buffer.alloc(24000).toString('base64'), turnEpoch: 1 };
  for (let chunk = 0; chunk < 122 && !live.closed; chunk++) socket.message(audio);
  assert.equal(live.closed, true, 'more than a minute of unplayed PCM must stay bounded');
  assert.equal(live.playing.size, 0);
  assert.equal(env.nodes.every(node => node.stopped), true);
  assert.equal(env.tracksStopped(), 1);
  const controls = socket.sent.filter(raw => typeof raw === 'string').map(raw => JSON.parse(raw).type);
  assert.equal(controls.includes('interrupt'), false);
  assert.equal(controls.includes('reconnect'), false);
  assert.equal(controls.filter(type => type === 'end').length, 1);
  assert.match(states.at(-1)!, /too much audio is waiting to play/i);
});

test('many tiny PCM chunks cannot create an unbounded playback graph', async t => {
  const env = browser(t);
  const live = new LiveAudio(() => {}, () => {}, () => {});
  await live.start('lesson-test', 'http://localhost:3001');
  t.after(() => live.stop());
  const socket = env.sockets[0];
  socket.message({ type: 'state', state: 'listening', turnEpoch: 1 });
  const audio = { type: 'audio', sampleRate: 24000, data: Buffer.alloc(2).toString('base64'), turnEpoch: 1 };
  for (let chunk = 0; chunk < 5000 && !live.closed; chunk++) socket.message(audio);
  assert.equal(live.closed, true);
  assert.ok(env.nodes.length < 5000, 'bound graph nodes independently of total PCM duration');
  assert.equal(env.nodes.every(node => node.stopped), true);
  assert.equal(live.playing.size, 0);
});

test('a genuine provider interruption clears a burst immediately without replaying it', async t => {
  const env = browser(t);
  const live = new LiveAudio(() => {}, () => {}, () => {});
  await live.start('lesson-test', 'http://localhost:3001');
  t.after(() => live.stop());
  const socket = env.sockets[0];
  socket.message({ type: 'state', state: 'listening', turnEpoch: 3 });
  const audio = { type: 'audio', sampleRate: 24000, data: Buffer.alloc(24000).toString('base64') };
  for (let chunk = 0; chunk < 16; chunk++) socket.message({ ...audio, turnEpoch: 3 });
  assert.equal(live.playing.size, 16);
  socket.message({ type: 'interrupted', turnEpoch: 4 });
  assert.equal(live.playing.size, 0);
  assert.equal(env.nodes.every(node => node.stopped), true);
  socket.message({ ...audio, turnEpoch: 3 });
  assert.equal(env.nodes.length, 16, 'late pre-interruption audio stays rejected');
  socket.message({ type: 'state', state: 'listening', turnEpoch: 4 });
  socket.message({ ...audio, turnEpoch: 4 });
  assert.equal(env.nodes.length, 17);
  assert.equal(env.nodes[16].startedAt, 0.02, 'new speech must not wait behind the cancelled backlog');
  assert.equal(socket.sent.some(raw => typeof raw === 'string' && ['interrupt', 'reconnect'].includes(JSON.parse(raw).type)), false);
});

test('unavailable provider never asks for microphone access', async t => {
  const env = browser(t, { provider: false });
  const live = new LiveAudio(() => {}, () => {}, () => {});
  await assert.rejects(live.start('lesson-test', 'http://localhost:3001'), /unavailable/);
  assert.equal(env.requested(), 0);
  assert.equal(live.closed, true);
  assert.equal(env.contexts.every(context => context.closed), true);
});

test('stop during a permission prompt releases a microphone that resolves later', async t => {
  let accept!: (stream: any) => void;
  const mic = new Promise(resolve => { accept = resolve; });
  const env = browser(t, { pendingMic: mic });
  const live = new LiveAudio(() => {}, () => {}, () => {});
  const started = live.start('lesson-test', 'http://localhost:3001');
  while (!env.requested()) await new Promise(resolve => setImmediate(resolve));
  live.stop(); accept(env.stream); await started;
  assert.equal(env.tracksStopped(), 1);
  assert.equal(env.sockets.length, 0);
  assert.equal(live.closed, true);
});

test('interrupt silences locally and rejects late audio until the new confirmed epoch', async t => {
  const env = browser(t);
  const live = new LiveAudio(() => {}, () => {}, () => {});
  await live.start('lesson-test', 'http://localhost:3001');
  t.after(() => live.stop());
  const socket = env.sockets[0];
  const audio = { type: 'audio', sampleRate: 24000, data: Buffer.alloc(480).toString('base64') };
  socket.message({ type: 'state', state: 'listening', turnEpoch: 2 });
  socket.message({ ...audio, turnEpoch: 2 });
  assert.equal(env.nodes.length, 1);
  live.interrupt();
  assert.equal(env.nodes[0].stopped, true);
  assert.equal(live.playing.size, 0);
  socket.message({ ...audio, turnEpoch: 2 });
  assert.equal(env.nodes.length, 1);
  socket.message({ type: 'interrupted', turnEpoch: 3 });
  socket.message({ type: 'state', state: 'listening', turnEpoch: 3 });
  socket.message({ ...audio, turnEpoch: 3 });
  socket.message({ ...audio, turnEpoch: 2 });
  assert.equal(env.nodes.length, 2);
  live.stop();
  assert.equal(env.tracksStopped(), 1);
  assert.equal(env.nodes.every(node => node.stopped), true);
  assert.equal(env.contexts.every(context => context.closed), true);
  assert.equal(live.ws, undefined);
});

test('transport recovery retries once and then releases microphone and playback', async t => {
  const env = browser(t);
  const statuses: string[] = [];
  const live = new LiveAudio(status => statuses.push(status), () => {}, () => {});
  await live.start('lesson-test', 'http://localhost:3001');
  t.after(() => live.stop());
  env.sockets[0].readyState = 3;
  env.sockets[0].onclose?.({ code: 1006, reason: '' });
  while (env.sockets.length < 2) await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  env.sockets[1].readyState = 3;
  env.sockets[1].onclose?.({ code: 1006, reason: '' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.sockets.length, 2);
  assert.equal(live.closed, true);
  assert.equal(env.tracksStopped(), 1);
  assert.equal(statuses.some(status => status.includes('Reconnecting once')), true);
  assert.equal(statuses.at(-1)?.includes('Voice stopped'), true);
});
