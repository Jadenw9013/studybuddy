import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Deliberately contains no credentials, raw provider errors, prompts or audio.
// Account discovery is free. Generation requires an explicit --smoke opt-in.
const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const models = { text: process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash', live: process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live' };
const report = { observedAt: new Date().toISOString(), fixture: false, evidenceKind: 'provider-readiness',
  credentialPresent: Boolean(key), configuredModels: models, discovery: 'unavailable', listed: { text: false, live: false },
  text: null, voice: null, gates: { realMicrophone: 'open', usefulAudibleResponse: 'open', interruption: 'open',
    screenFrame: 'open', correctVisibleChart: 'open', forcedReconnect: 'open', twentyMinuteLesson: 'open', invoiceReconciliation: 'open' } };

if (key) {
  try {
    const available = [];
    let page;
    for (let i = 0; i < 10; i++) {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
      url.searchParams.set('pageSize', '1000');
      if (page) url.searchParams.set('pageToken', page);
      const response = await fetch(url, { headers: { 'x-goog-api-key': key }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) { report.discovery = `http_${response.status}`; break; }
      const body = await response.json();
      for (const model of body.models || []) available.push({ name: model.name?.replace(/^models\//, ''), methods: model.supportedGenerationMethods || [] });
      page = body.nextPageToken;
      if (!page) { report.discovery = 'complete'; break; }
    }
    report.listed = { text: available.some(m => m.name === models.text), live: available.some(m => m.name === models.live) };
    report.supportedMethods = {
      text: available.find(m => m.name === models.text)?.methods.includes('generateContent') || false,
      live: available.find(m => m.name === models.live)?.methods.includes('bidiGenerateContent') || false,
    };
    report.relevantModels = available.filter(m => /3\.8|live|native.audio/.test(m.name));
    if (process.argv.includes('--configure')) {
      if (report.discovery !== 'complete' || !report.supportedMethods.text || !report.supportedMethods.live ||
        models.text !== 'gemini-3.8-flash' || models.live !== 'gemini-3.8-live') throw Error('configuration_not_verified');
      if (Date.now() >= Date.parse('2027-01-01T00:00:00Z')) throw Error('reviewed_prices_expired');
      // Official Standard Gemini prices reviewed 2026-11-20. No cache discount
      // is published for Live; full input rates conservatively price its cache.
      const prices = { version: 'google-standard-2026-11-20', currency: 'USD', validUntil: '2027-01-01T00:00:00Z', models: {
        [models.text]: { input: { TEXT: .75, AUDIO: .75, IMAGE: .75 }, output: { TEXT: 3.75 }, cachedInput: { TEXT: .075, AUDIO: .075, IMAGE: .075 } },
        [models.live]: { input: { TEXT: .75, AUDIO: 3, IMAGE: 1 }, output: { TEXT: 4.5, AUDIO: 12 }, cachedInput: { TEXT: .75, AUDIO: 3, IMAGE: 1 } },
      } };
      const counts = (TEXT = 0, AUDIO = 0, IMAGE = 0) => ({ TEXT, AUDIO, IMAGE });
      const limits = { text: { input: counts(16384), output: counts(4096), cachedInput: counts(16384) },
        live: { input: counts(80000, 100000, 10000), output: counts(10000, 30000), cachedInput: counts(80000, 100000, 10000) } };
      const settings = { MODEL_UNIT_PRICES_JSON: JSON.stringify(prices), MODEL_UNIT_LIMITS_JSON: JSON.stringify(limits), ENABLE_LIVE: 'true' };
      const path = resolve('.env');
      let env = await readFile(path, 'utf8');
      for (const [name, value] of Object.entries(settings)) {
        const pattern = new RegExp(`^${name}=.*$`, 'm');
        const line = `${name}='${value}'`;
        env = pattern.test(env) ? env.replace(pattern, () => line) : `${env.trimEnd()}\n${line}\n`;
        process.env[name] = value;
      }
      await writeFile(path, env);
      report.configured = { voiceEnabled: true, pricesVersion: prices.version, validUntil: prices.validUntil, maximumReservationUsd: { text: .027648, live: .775 } };
    }
    if (process.argv.includes('--smoke')) {
      if (report.discovery !== 'complete' || !report.supportedMethods.text || !report.supportedMethods.live || !process.env.MODEL_UNIT_PRICES_JSON ||
        !process.env.MODEL_UNIT_LIMITS_JSON || process.env.PAID_CALLS_ENABLED !== 'true') throw Error('smoke_controls_unavailable');
      const reviewed = JSON.parse(process.env.MODEL_UNIT_PRICES_JSON);
      const bounds = JSON.parse(process.env.MODEL_UNIT_LIMITS_JSON);
      if (!reviewed.version || reviewed.currency !== 'USD' || !reviewed.models?.[models.text] || !reviewed.models?.[models.live] ||
        (reviewed.validUntil && Date.now() >= Date.parse(reviewed.validUntil)) ||
        !(bounds.text?.output?.TEXT >= 128) || !(bounds.live?.output?.AUDIO >= 1024)) throw Error('smoke_controls_unavailable');
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: 'v1beta', timeout: 15_000 } });
      const started = performance.now();
      try {
        const response = await ai.models.generateContent({ model: models.text, contents: 'Reply with exactly READY.',
          config: { maxOutputTokens: 128, thinkingConfig: { thinkingLevel: 'LOW' } } });
        report.text = { status: response.text?.trim() === 'READY' ? 'passed' : 'unexpected_response',
          durationMs: Math.round(performance.now() - started), usage: response.usageMetadata || null };
      } catch { report.text = { status: 'provider_error', durationMs: Math.round(performance.now() - started) }; }
      report.voice = await voiceSmoke(ai);
    }
  } catch { report.failure = 'Provider access or reviewed configuration could not be verified. No raw error was logged.'; }
}
await mkdir(resolve('evals/live/results'), { recursive: true });
await writeFile(resolve('evals/live/results/provider-readiness.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.discovery !== 'complete' || report.failure || (process.argv.includes('--smoke') &&
  (report.text?.status !== 'passed' || report.voice?.status !== 'provider_smoke_passed'))) process.exitCode = 2;

async function voiceSmoke(ai) {
  const result = { status: 'incomplete', connected: false, audioPackets: 0, audioBytes: 0, toolCalls: 0, usageEvents: [], durationMs: 0,
    events: [], basicAudioPackets: 0, toolAudioPackets: 0,
    firstAudioPacketMs: null, firstUsefulAudioMs: null, firstCorrectVisibleChartMs: null,
    evidence: 'Synthetic text-to-audio provider probe; no microphone, browser playback, screen or human lesson.' };
  const started = performance.now();
  let session, finished = false, resolveDone;
  let phase = 'basic';
  const done = new Promise(resolve => { resolveDone = resolve; });
  const timer = setTimeout(() => resolveDone(), 15_000);
  try {
    const connecting = ai.live.connect({ model: models.live, config: { responseModalities: ['AUDIO'], maxOutputTokens: 1024,
      outputAudioTranscription: {},
      contextWindowCompression: { triggerTokens: '8192', slidingWindow: { targetTokens: '4096' } },
      systemInstruction: 'Synthetic integration check. Speak concise audible answers. When asked to run the histogram probe, call probe_histogram with binCount 5, then speak its sample count after receiving the trusted result. Otherwise say only ready.',
      tools: [{ functionDeclarations: [{ name: 'probe_histogram', description: 'Trusted synthetic counts, no chart is displayed.',
        behavior: 'NON_BLOCKING',
        parameters: { type: 'OBJECT', properties: { binCount: { type: 'INTEGER' } }, required: ['binCount'] } }] }] },
      callbacks: {
        onmessage(message) {
          if (finished) return;
          if (result.events.length < 60) result.events.push({ phase, atMs: Math.round(performance.now() - started), keys: Object.keys(message),
            contentKeys: Object.keys(message.serverContent || {}), turnComplete: Boolean(message.serverContent?.turnComplete),
            parts: (message.serverContent?.modelTurn?.parts || []).map(part => ({ keys: Object.keys(part), thought: Boolean(part.thought),
              mime: part.inlineData?.mimeType || null, base64Length: part.inlineData?.data?.length || 0 })) });
          for (const part of message.serverContent?.modelTurn?.parts || []) if (part.inlineData?.mimeType?.startsWith('audio/pcm')) {
            const bytes = Buffer.from(part.inlineData.data || '', 'base64').length;
            if (bytes) { result.audioPackets++; result.audioBytes += bytes; result.firstAudioPacketMs ??= Math.round(performance.now() - started);
              if (phase === 'basic') result.basicAudioPackets++; else result.toolAudioPackets++; }
          }
          for (const call of message.toolCall?.functionCalls || []) if (session && call.id && call.name === 'probe_histogram' && call.args?.binCount === 5 && result.toolCalls < 1) {
            result.toolCalls++;
            session.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, scheduling: 'INTERRUPT', willContinue: false,
              response: { result: { counts: [2, 3, 1, 2, 2], n: 10, shown: false } } }] });
          }
          if (message.usageMetadata) result.usageEvents.push(message.usageMetadata);
          if (message.serverContent?.turnComplete && phase === 'basic' && session) {
            phase = 'tool';
            session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: 'Run the histogram probe with five bins, then say its sample count aloud.' }] }], turnComplete: true });
          } else if (message.serverContent?.turnComplete && result.basicAudioPackets && result.toolAudioPackets && result.toolCalls) {
            result.status = 'provider_smoke_passed'; resolveDone();
          }
        },
        onerror(error) { result.status = 'provider_error'; result.diagnostic = diagnostic(error); resolveDone(); },
        onclose(event) { result.close = { code: event.code, reason: diagnostic({ message: event.reason }).message }; resolveDone(); },
      } });
    void connecting.then(value => { if (finished) value.close(); }).catch(() => undefined);
    session = await Promise.race([connecting, done.then(() => undefined)]);
    if (session) { result.connected = true;
      session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: 'Say ready aloud.' }] }], turnComplete: true }); await done; }
  } catch (error) { result.status = 'provider_error'; result.diagnostic = diagnostic(error); }
  finally { finished = true; clearTimeout(timer); session?.close(); result.durationMs = Math.round(performance.now() - started); }
  return result;
}

function diagnostic(error) {
  let message = String(error?.message || error?.error?.message || 'Provider connection failed');
  if (key) message = message.split(key).join('[credential-redacted]');
  message = message.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[provider-url-redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/AIza[\w-]+/g, '[credential-redacted]');
  return { name: String(error?.name || 'Error').slice(0, 80), code: typeof error?.code === 'number' ? error.code : null,
    message: message.slice(0, 500) };
}
