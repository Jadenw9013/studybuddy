import { readFile } from 'node:fs/promises';

if (!process.argv[2]) throw new Error('Usage: node evals/live/summarize.mjs <events.jsonl>');
const raw = (await readFile(process.argv[2], 'utf8')).trim();
const events = raw ? raw.split(/\r?\n/).map(line => JSON.parse(line)) : [];
const rows = new Map();
const turns = new Map();
const errors = {};
const settlements = new Set();
let actualSeconds = 0;
let firstModel;
const distributions = { usefulAudio: [], correctVisibleChart: [], interruption: [] };
for (const event of events) {
  if (event.fixture === true) throw new Error('Fixture events cannot be summarized as live evidence.');
  if (typeof event.at !== 'number' || typeof event.name !== 'string') throw new Error('Invalid event: expected numeric at and name.');
  if (event.model) firstModel ??= event.model;
  const key = `${event.runId || 'unknown'}:${event.turnEpoch ?? 'unknown'}:${event.turnSequence ?? 'unknown'}`;
  const row = turns.get(key) || {};
  row[event.name] ??= event.at;
  turns.set(key, row);
  if (event.name === 'usage' && typeof event.eventId === 'string' && !rows.has(event.eventId)) rows.set(event.eventId, event);
  if (event.name === 'session_settled' && typeof event.meterId === 'string' && !settlements.has(event.meterId)) {
    settlements.add(event.meterId); actualSeconds += event.activeSeconds || 0;
  }
  if (event.name === 'error') errors[event.code || 'unknown'] = (errors[event.code || 'unknown'] || 0) + 1;
}
const failed = { usefulAudio: 0, correctVisibleChart: 0, interruption: 0 };
for (const row of turns.values()) {
  if (row.speech_end !== undefined) {
    for (const [metric, end] of [['usefulAudio', 'useful_audio'], ['correctVisibleChart', 'correct_visible_chart']]) {
      if (row[end] !== undefined && row[end] >= row.speech_end) distributions[metric].push(row[end] - row.speech_end);
      else failed[metric]++;
    }
  }
  if (row.local_interrupt !== undefined) {
    if (row.playback_silence !== undefined && row.playback_silence >= row.local_interrupt) distributions.interruption.push(row.playback_silence - row.local_interrupt);
    else failed.interruption++;
  }
}
function summarize(values, missing) {
  const sorted = [...values].sort((a, b) => a - b);
  return { observed: sorted.length, failedOrMissing: missing, denominator: sorted.length + missing,
    medianMs: sorted.length ? sorted[Math.floor((sorted.length - 1) * .5)] : null,
    p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null };
}
const usageEvents = [...rows.values()].map(e => ({ eventId: e.eventId, turnEpoch: e.turnEpoch,
  inputTokens: e.promptTokenCount ?? null, outputTokens: e.responseTokenCount ?? null, totalTokens: e.totalTokenCount ?? null,
  cachedContentTokenCount: e.cachedContentTokenCount ?? null,
  inputTextTokens: e.inputTextTokens ?? null, inputAudioTokens: e.inputAudioTokens ?? null, inputImageTokens: e.inputImageTokens ?? null,
  outputTextTokens: e.outputTextTokens ?? null, outputAudioTokens: e.outputAudioTokens ?? null }));
console.log(JSON.stringify({ evidenceKind: 'live-operational-summary', model: firstModel || null, eventCount: events.length,
  firstUsefulAudio: summarize(distributions.usefulAudio, failed.usefulAudio),
  firstCorrectVisibleChart: summarize(distributions.correctVisibleChart, failed.correctVisibleChart),
  interruption: { ...summarize(distributions.interruption, failed.interruption), within300Ms: distributions.interruption.filter(x => x <= 300).length },
  activeSeconds: actualSeconds, errors, providerUsageEvents: usageEvents,
  costEstimate: null, costReason: 'Requires a versioned current rate table and invoice reconciliation; token totals are not an invoice.',
}, null, 2));
