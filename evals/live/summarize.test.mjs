import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function run(events) {
  const folder = await mkdtemp(join(tmpdir(), 'tutor-metric-unit-'));
  try {
    const file = join(folder, 'unit-events.jsonl');
    await writeFile(file, events.map(event => JSON.stringify({ runId: 'synthetic-unit-only', fixture: false, turnEpoch: 1, turnSequence: 1, ...event })).join('\n'));
    return spawnSync(process.execPath, ['evals/live/summarize.mjs', file], { cwd: process.cwd(), encoding: 'utf8' });
  } finally { await rm(folder, { recursive: true, force: true }); }
}

// These synthetic operational-shaped rows test the collector, never live acceptance.
test('latency collector keeps missing responses in denominators and excludes scheduling proxies', async () => {
  const result = await run([
    { name: 'speech_end', at: 1000 },
    { name: 'audio_scheduled_proxy', at: 1100 },
    { name: 'useful_audio', at: 1500 },
    { name: 'local_interrupt', at: 2000 },
    { name: 'playback_silence', at: 2200 },
    { name: 'speech_end', at: 3000, turnSequence: 2 },
  ]);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(summary.firstUsefulAudio, { observed: 1, failedOrMissing: 1, denominator: 2, medianMs: 500, p95Ms: 500 });
  assert.equal(summary.firstCorrectVisibleChart.observed, 0);
  assert.equal(summary.firstCorrectVisibleChart.denominator, 2);
  assert.equal(summary.interruption.within300Ms, 1);
  assert.equal(summary.costEstimate, null);
});

test('usage collector deduplicates events without inventing a cost', async () => {
  const usage = { name: 'usage', at: 5000, eventId: 'u1', promptTokenCount: 100, responseTokenCount: 50, totalTokenCount: 150, inputAudioTokens: 90 };
  const result = await run([usage, usage]);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.providerUsageEvents.length, 1);
  assert.equal(summary.providerUsageEvents[0].inputTokens, 100);
  assert.equal(summary.providerUsageEvents[0].inputAudioTokens, 90);
  assert.equal(summary.providerUsageEvents[0].outputAudioTokens, null);
});

test('explicit fixture evidence is refused by the live collector', async () => {
  const result = await run([{ name: 'speech_end', at: 1, fixture: true }]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Fixture events cannot/);
});
