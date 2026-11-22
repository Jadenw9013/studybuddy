import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleGenAI, Modality } from '@google/genai';

test('locked SDK emits the exact documented Live v1beta endpoint before network', async () => {
  const ai = new GoogleGenAI({ apiKey: 'synthetic-not-a-credential', httpOptions: { apiVersion: 'v1beta' } });
  let pathname = '', hostname = '';
  // Diagnostic only: intercept immediately before socket construction, so this
  // regression neither calls a provider nor records the credential query string.
  const factory = (ai.live as unknown as { webSocketFactory: { create(url: string): never } }).webSocketFactory;
  factory.create = (value: string) => {
    const url = new URL(value);
    pathname = url.pathname; hostname = url.hostname;
    throw Error('synthetic stop before network');
  };
  await assert.rejects(ai.live.connect({ model: 'gemini-3.8-live', config: { responseModalities: [Modality.AUDIO] }, callbacks: { onmessage() {} } }), /synthetic stop/);
  assert.equal(hostname, 'generativelanguage.googleapis.com');
  assert.equal(pathname, '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent');
});
