import test from 'node:test';
import assert from 'node:assert/strict';
import { BflError, generateIllustration, type BflInput } from '../src/bfl.ts';

// All HTTP responses are synthetic. No environment key, network or paid job is used.
const task = 'synthetic-task-1';
const polling = `https://api.us3.bfl.ai/v1/get_result?id=${task}`;
const delivery = 'https://delivery.us3.bfl.ai/results/synthetic.png?signature=unit-only';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6uQAAAAASUVORK5CYII=', 'base64');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const raster = (data = png, mime = 'image/png') => new Response(new Uint8Array(data), { headers: { 'Content-Type': mime } });
const input = (overrides: Partial<BflInput> = {}): BflInput => ({
  key: 'synthetic-key-never-real', model: 'flux-2-klein-9b', baseUrl: 'https://api.bfl.ai',
  prompt: 'Original synthetic illustration prompt', width: 768, height: 512, signal: new AbortController().signal, ...overrides,
});
type Request = { url: string; init: RequestInit };
function mocked(responses: (Response | ((request: Request) => Response | Promise<Response>))[]) {
  const requests: Request[] = [];
  const fetcher = (async (value: string | URL | globalThis.Request, options?: RequestInit) => {
    const request = { url: String(value), init: options ?? {} }; requests.push(request);
    const response = responses.shift();
    if (!response) throw new Error('Unexpected synthetic request');
    return typeof response === 'function' ? response(request) : response;
  }) as typeof fetch;
  return { requests, deps: { fetch: fetcher, sleep: async () => undefined } };
}
function code(expected: string, submitted?: boolean, definiteRejection?: boolean) {
  return (error: unknown) => {
    assert.ok(error instanceof BflError);
    assert.equal(error.code, expected);
    if (submitted !== undefined) assert.equal(error.submitted, submitted);
    if (definiteRejection !== undefined) assert.equal(error.definiteRejection, definiteRejection);
    assert.equal(error.message.includes('synthetic-key-never-real'), false);
    assert.equal(error.message.includes('Original synthetic illustration prompt'), false);
    return true;
  };
}

test('Klein submission occurs once, polls supplied URL and downloads bytes without credentials', async () => {
  const http = mocked([json({ id: task, polling_url: polling }), json({ id: task, status: 'Pending' }),
    json({ id: task, status: 'Ready', result: { sample: delivery } }), raster()]);
  const submitted: string[] = [];
  const output = await generateIllustration(input({ onSubmitted: id => { submitted.push(id); } }), http.deps);
  assert.deepEqual(submitted, [task]);
  assert.equal(output.providerId, task);
  assert.deepEqual(output.bytes, png);
  assert.deepEqual([output.mime, output.width, output.height], ['image/png', 1, 1]); // actual header dimensions, not a fabricated request echo.
  assert.equal(http.requests.filter(request => request.init.method === 'POST').length, 1);
  assert.equal(http.requests[0].url, 'https://api.bfl.ai/v1/flux-2-klein-9b');
  assert.equal(http.requests[1].url, polling);
  assert.deepEqual(JSON.parse(String(http.requests[0].init.body)), { prompt: 'Original synthetic illustration prompt', width: 768, height: 512, output_format: 'png', safety_tolerance: 2 });
  assert.equal(new Headers(http.requests[1].init.headers).get('x-key'), 'synthetic-key-never-real');
  const assetHeaders = new Headers(http.requests.at(-1)!.init.headers);
  assert.equal(assetHeaders.get('x-key'), null);
  assert.equal(assetHeaders.get('authorization'), null);
  assert.equal(http.requests.every(request => request.init.redirect === 'error' && request.init.credentials === 'omit'), true);
  assert.equal(http.requests.some(request => request.url.includes('synthetic-key-never-real')), false);
});

test('input validation and already-aborted requests never reach a provider', async () => {
  const http = mocked([]);
  for (const overrides of [{ model: 'flux-3-image' }, { width: 0 }, { width: 8192 }, { prompt: '' }, { key: 'bad\r\nheader' }])
    await assert.rejects(generateIllustration(input(overrides), http.deps), code('bfl_invalid_request', false, true));
  const controller = new AbortController(); controller.abort('private abort reason');
  await assert.rejects(generateIllustration(input({ signal: controller.signal }), http.deps), code('bfl_aborted', false, true));
  assert.equal(http.requests.length, 0);
});

test('base URL rejects private addresses, lookalikes, credentials, ports, paths and query', async () => {
  const http = mocked([]);
  for (const baseUrl of ['http://api.bfl.ai', 'https://127.0.0.1', 'https://169.254.169.254', 'https://localhost',
    'https://api.bfl.ai.evil.test', 'https://api.bfl.ai@evil.test', 'https://user:secret@api.bfl.ai',
    'https://api.bfl.ai:444', 'https://api.bfl.ai/v1', 'https://api.bfl.ai?key=value', 'https://api.bfl.ai#fragment'])
    await assert.rejects(generateIllustration(input({ baseUrl }), http.deps), code('bfl_unsafe_url', false, true));
  assert.equal(http.requests.length, 0);
});

test('unsafe or mismatched polling URLs never receive the API key', async () => {
  for (const pollingUrl of [
    `http://api.bfl.ai/v1/get_result?id=${task}`, `https://127.0.0.1/v1/get_result?id=${task}`,
    `https://api.bfl.ai.evil.test/v1/get_result?id=${task}`, `https://delivery.eu.bfl.ai/v1/get_result?id=${task}`,
    `https://api.bfl.ai:444/v1/get_result?id=${task}`, 'https://api.bfl.ai/v1/get_result?id=other-task',
    `https://api.bfl.ai/v1/credits?id=${task}`, `https://api.bfl.ai/v1/get_result?id=${task}&id=other`,
    `https://api.bfl.ai/v1/get_result?id=${task}&extra=opaque`,
  ]) {
    const http = mocked([json({ id: task, polling_url: pollingUrl })]);
    const ids: string[] = [];
    await assert.rejects(generateIllustration(input({ onSubmitted: id => { ids.push(id); } }), http.deps), code('bfl_unsafe_url', true, false));
    assert.deepEqual(ids, [task], 'confirmed paid ID is retained even when its subsequent URL is refused');
    assert.equal(http.requests.length, 1);
  }
});

test('download is restricted to documented delivery region namespace, with no redirected requests', async () => {
  for (const sample of ['http://delivery.eu.bfl.ai/image.png', 'https://delivery.eu.bfl.ai.evil.test/image.png',
    'https://delivery.eu.extra.bfl.ai/image.png', 'https://api.bfl.ai/image.png', 'https://127.0.0.1/image.png',
    'https://delivery.eu.bfl.ai:444/image.png', 'https://user:secret@delivery.eu.bfl.ai/image.png']) {
    const http = mocked([json({ id: task, polling_url: polling }), json({ status: 'Ready', result: { sample } })]);
    await assert.rejects(generateIllustration(input(), http.deps), code('bfl_unsafe_url', true, false));
    assert.equal(http.requests.length, 2);
  }
  const http = mocked([json({ id: task, polling_url: polling }), json({ status: 'Ready', result: { sample: delivery } }),
    new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/private' } })]);
  await assert.rejects(generateIllustration(input(), http.deps), code('bfl_redirect_denied', true, false));
  assert.equal(http.requests.length, 3);
});

test('explicit pre-task HTTP denials are definite rejections, never resubmitted', async () => {
  for (const [status, expected] of [[401, 'bfl_auth_failed'], [402, 'bfl_quota_exhausted'], [403, 'bfl_auth_failed'], [422, 'bfl_invalid_request'], [429, 'bfl_rate_limited']] as const) {
    const http = mocked([json({ raw: 'synthetic-key-never-real Original synthetic illustration prompt' }, status)]);
    await assert.rejects(generateIllustration(input(), http.deps), code(expected, false, true));
    assert.equal(http.requests.length, 1);
  }
});

test('ambiguous POST transport failures and server errors stay submitted with unknown cost', async () => {
  const http = mocked([() => { throw new Error('private transport text synthetic-key-never-real'); }]);
  await assert.rejects(generateIllustration(input(), http.deps), code('bfl_unavailable', true, false));
  assert.equal(http.requests.length, 1);
  const server = mocked([json({ prompt: 'private provider echo' }, 503)]);
  await assert.rejects(generateIllustration(input(), server.deps), code('bfl_unavailable', true, false));
  assert.equal(server.requests.length, 1);
});

test('polling authentication failure cannot refund an already accepted task', async () => {
  const http = mocked([json({ id: task, polling_url: polling }), json({ detail: 'private error' }, 401)]);
  await assert.rejects(generateIllustration(input(), http.deps), code('bfl_auth_failed', true, false));
  assert.equal(http.requests.length, 2);
});

test('moderation, missing tasks, failed generations and unknown statuses are honest terminal failures', async () => {
  for (const [status, expected] of [['Request Moderated', 'bfl_moderated'], ['Content Moderated', 'bfl_moderated'],
    ['Error', 'bfl_generation_failed'], ['Failed', 'bfl_generation_failed'], ['No Card Generated', 'bfl_generation_failed'],
    ['Task not found', 'bfl_task_not_found'], ['Unrecognized', 'bfl_invalid_response']] as const) {
    const http = mocked([json({ id: task, polling_url: polling }), json({ status, details: { prompt: 'private echoed content' } })]);
    await assert.rejects(generateIllustration(input(), http.deps), code(expected, true, false));
    assert.equal(http.requests.length, 2);
  }
});

test('bounded poll count times out without another generation request', async () => {
  let posts = 0, polls = 0;
  const fake = (async (_url: any, init?: RequestInit) => {
    if (init?.method === 'POST') { posts++; return json({ id: task, polling_url: polling }); }
    polls++; return json({ status: 'Generating' });
  }) as typeof fetch;
  await assert.rejects(generateIllustration(input(), { fetch: fake, sleep: async () => undefined }), code('bfl_timeout', true, false));
  assert.equal(posts, 1); assert.equal(polls, 180);
});

test('abort during pending submission ends promptly and conservatively marks possible submission', async () => {
  const controller = new AbortController();
  let requested = 0;
  const fake = (async () => { requested++; queueMicrotask(() => controller.abort('private reason')); return new Promise<Response>(() => {}); }) as typeof fetch;
  await assert.rejects(generateIllustration(input({ signal: controller.signal }), { fetch: fake }), code('bfl_aborted', true, false));
  assert.equal(requested, 1);
});

test('failed onSubmitted persistence retains confirmed task ID and cannot resubmit', async () => {
  const http = mocked([json({ id: task, polling_url: polling })]);
  await assert.rejects(generateIllustration(input({ onSubmitted: () => { throw new Error('private persistence failure synthetic-key-never-real'); } }), http.deps), error => {
    code('bfl_submission_record_failed', true, false)(error); assert.equal((error as BflError).providerId, task); return true;
  });
  assert.equal(http.requests.length, 1);
});

test('image download rejects an advertised size above 8MB before reading content', async () => {
  let canceled = false;
  const response = new Response(new ReadableStream({ cancel() { canceled = true; } }), {
    headers: { 'Content-Length': String(8 * 1024 * 1024 + 1), 'Content-Type': 'image/png' },
  });
  const http = mocked([json({ id: task, polling_url: polling }), json({ status: 'Ready', result: { sample: delivery } }), response]);
  await assert.rejects(generateIllustration(input(), http.deps), code('bfl_image_too_large', true, false));
  assert.equal(canceled, true);
});

test('streamed download limit applies when Content-Length is absent', async () => {
  let chunk = 0, canceled = false;
  const response = new Response(new ReadableStream({ pull(controller) {
    if (chunk++ < 1000) controller.enqueue(new Uint8Array(65_536)); else controller.close();
  }, cancel() { canceled = true; } }), { headers: { 'Content-Type': 'image/png' } });
  const http = mocked([json({ id: task, polling_url: polling }), json({ status: 'Ready', result: { sample: delivery } }), response]);
  await assert.rejects(generateIllustration(input(), http.deps), code('bfl_image_too_large', true, false));
  assert.equal(canceled, true);
  assert.ok(chunk < 1000);
});

test('SVG, HTML, fake raster MIME and malformed image headers are not returned as images', async () => {
  for (const response of [new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
    new Response('<html>private provider error</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response('<svg/>', { headers: { 'Content-Type': 'image/png' } }), raster(Buffer.from('not an image')),
    raster(png, 'text/html')]) {
    const http = mocked([json({ id: task, polling_url: polling }), json({ status: 'Ready', result: { sample: delivery } }), response]);
    await assert.rejects(generateIllustration(input(), http.deps), code('bfl_invalid_image', true, false));
  }
});

test('JPEG and WebP magic/header variants report their actual dimensions', async () => {
  const jpeg = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 64, 0, 80, 1, 1, 17, 0, 255, 217]);
  const webp = Buffer.alloc(26); webp.write('RIFF'); webp.writeUInt32LE(18, 4); webp.write('WEBP', 8); webp.write('VP8L', 12);
  webp.writeUInt32LE(5, 16); webp[20] = 47; webp.writeUInt32LE(79 | (63 << 14), 21);
  for (const [data, mime] of [[jpeg, 'image/jpeg'], [webp, 'image/webp']] as const) {
    const http = mocked([json({ id: task, polling_url: polling }), json({ status: 'Ready', result: { sample: delivery } }), raster(data, mime)]);
    const output = await generateIllustration(input(), http.deps);
    assert.deepEqual([output.mime, output.width, output.height], [mime, 80, 64]);
  }
});

test('oversized or malformed API metadata is redacted and cannot lead to another paid POST', async () => {
  for (const response of [new Response('not JSON synthetic-key-never-real'), new Response(JSON.stringify({ id: task, filler: 'x'.repeat(65_536) }))]) {
    const http = mocked([response]);
    await assert.rejects(generateIllustration(input(), http.deps), code('bfl_invalid_response', true, false));
    assert.equal(http.requests.length, 1);
  }
});

test('a malformed receipt cannot persist a credential as its task ID', async () => {
  const http = mocked([json({ id: 'synthetic-key-never-real', polling_url: polling })]);
  let recorded = false;
  await assert.rejects(generateIllustration(input({ onSubmitted: () => { recorded = true; } }), http.deps), error => {
    code('bfl_invalid_response', true, false)(error);
    assert.equal((error as BflError).providerId, undefined);
    return true;
  });
  assert.equal(recorded, false);
});
