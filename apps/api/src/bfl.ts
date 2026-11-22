/** BFL HTTP adapter, reviewed against the public Klein schema and polling guide.
 * https://api.bfl.ai/openapi.json
 * https://docs.bfl.ai/quick_start/generating_images
 * No automatic resubmission: an ambiguous paid POST must be reconciled by its caller.
 */
export type BflInput = {
  key: string;
  model: string;
  baseUrl: string;
  prompt: string;
  width: number;
  height: number;
  signal: AbortSignal;
  onSubmitted?: (id: string) => Promise<void> | void;
};

type Dependencies = { fetch?: typeof fetch; sleep?: (ms: number, signal: AbortSignal) => Promise<void> };
type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
const models = new Set(['flux-2-klein-9b', 'flux-2-klein-9b-preview', 'flux-2-klein-4b']);
const apiHosts = new Set(['api.bfl.ai', 'api.eu.bfl.ai', 'api.us.bfl.ai']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_PIXELS = 4 * 1024 * 1024;
const DEADLINE_MS = 90_000;
const POLL_INTERVAL_MS = 500;
const MAX_POLLS = DEADLINE_MS / POLL_INTERVAL_MS;

const messages: Record<string, string> = {
  bfl_invalid_request: 'The illustration request is outside the supported image settings.',
  bfl_auth_failed: 'The illustration provider could not authenticate this request.',
  bfl_quota_exhausted: 'The illustration provider has no available credits.',
  bfl_rate_limited: 'The illustration provider is busy. No second generation was submitted.',
  bfl_unavailable: 'The illustration provider could not finish this request.',
  bfl_invalid_response: 'The illustration provider returned an unsupported response.',
  bfl_unsafe_url: 'The illustration provider returned an unapproved delivery location.',
  bfl_redirect_denied: 'The illustration request was stopped at an unexpected redirect.',
  bfl_moderated: 'The illustration provider declined this image request.',
  bfl_generation_failed: 'The illustration provider did not produce an image.',
  bfl_task_not_found: 'The illustration provider could not find the submitted task.',
  bfl_image_too_large: 'The generated illustration exceeded the download limit.',
  bfl_invalid_image: 'The illustration provider did not return a supported raster image.',
  bfl_submission_record_failed: 'The submitted illustration could not be recorded. No second generation was submitted.',
  bfl_timeout: 'The illustration did not finish within 90 seconds. No second generation was submitted.',
  bfl_aborted: 'The illustration request was stopped.',
};

export class BflError extends Error {
  constructor(public code: string, public providerId?: string, public submitted = false, public definiteRejection = false) {
    super(messages[code] ?? messages.bfl_unavailable);
  }
}
function fail(code: string, providerId?: string): never { throw new BflError(code, providerId); }

function secureUrl(value: unknown, kind: 'base' | 'poll' | 'image', key: string, providerId?: string): URL {
  if (typeof value !== 'string' || value.length > 8192) fail('bfl_unsafe_url', providerId);
  let url: URL;
  try { url = new URL(value); } catch { return fail('bfl_unsafe_url', providerId); }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.hash) fail('bfl_unsafe_url', providerId);
  // Never transmit a credential embedded in an unexpected returned URL.
  if (url.href.includes(key) || url.href.includes(encodeURIComponent(key))) fail('bfl_unsafe_url', providerId);
  if (kind === 'base') {
    if (!apiHosts.has(url.hostname) || url.pathname !== '/' || url.search) fail('bfl_unsafe_url', providerId);
  } else if (kind === 'poll') {
    // Global/regional submit endpoints return a cluster-specific polling URL.
    // Restrict it to BFL's API service namespace, never a broad *.bfl.ai match.
    const cluster = /^api\.(?:us|eu)[1-9][0-9]?\.bfl\.ai$/.test(url.hostname);
    if ((!apiHosts.has(url.hostname) && !cluster) || url.pathname !== '/v1/get_result'
      || url.searchParams.getAll('id').length !== 1 || url.searchParams.get('id') !== providerId
      || [...url.searchParams.keys()].some(name => name !== 'id')) fail('bfl_unsafe_url', providerId);
  } else {
    // BFL explicitly documents region-changing delivery.*.bfl.ai hosts.
    if (!/^delivery\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.bfl\.ai$/.test(url.hostname)) fail('bfl_unsafe_url', providerId);
  }
  return url;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new BflError('bfl_aborted'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(new BflError('bfl_aborted')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new BflError('bfl_aborted'));
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new BflError('bfl_aborted')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function bytes(response: Response, limit: number, signal: AbortSignal, providerId?: string): Promise<Buffer> {
  const advertised = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > limit) {
    void response.body?.cancel().catch(() => undefined);
    fail(limit === MAX_IMAGE_BYTES ? 'bfl_image_too_large' : 'bfl_invalid_response', providerId);
  }
  if (!response.body) fail('bfl_invalid_response', providerId);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) fail(limit === MAX_IMAGE_BYTES ? 'bfl_image_too_large' : 'bfl_invalid_response', providerId);
      chunks.push(Buffer.from(part.value));
    }
    if (!length) fail('bfl_invalid_response', providerId);
    return Buffer.concat(chunks, length);
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}

async function json(response: Response, signal: AbortSignal, providerId?: string): Promise<Record<string, any>> {
  const raw = await bytes(response, MAX_JSON_BYTES, signal, providerId);
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('bfl_invalid_response', providerId);
    return parsed;
  } catch { return fail('bfl_invalid_response', providerId); }
}

function http(response: Response, providerId?: string, submission = false) {
  if (response.redirected || (response.status >= 300 && response.status < 400)) fail('bfl_redirect_denied', providerId);
  if (response.ok) return;
  void response.body?.cancel().catch(() => undefined);
  const rejected = (code: string): never => { throw new BflError(code, providerId, !submission, submission); };
  if (response.status === 401 || response.status === 403) rejected('bfl_auth_failed');
  if (response.status === 402) rejected('bfl_quota_exhausted');
  if (response.status === 429) rejected('bfl_rate_limited');
  if (response.status === 400 || response.status === 422) rejected('bfl_invalid_request');
  fail('bfl_unavailable', providerId);
}

function imageInfo(data: Buffer, providerId: string): { mime: ImageMime; width: number; height: number } {
  let mime: ImageMime | undefined, width = 0, height = 0;
  if (data.length >= 33 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && data.readUInt32BE(8) === 13 && data.toString('ascii', 12, 16) === 'IHDR') {
    mime = 'image/png'; width = data.readUInt32BE(16); height = data.readUInt32BE(20);
  } else if (data.length >= 14 && data[0] === 255 && data[1] === 216 && data[2] === 255 && data[data.length - 2] === 255 && data[data.length - 1] === 217) {
    let offset = 2;
    while (offset + 3 < data.length) {
      if (data[offset++] !== 255) fail('bfl_invalid_image', providerId);
      while (offset < data.length && data[offset] === 255) offset++;
      const marker = data[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > data.length) break;
      const size = data.readUInt16BE(offset);
      if (size < 2 || offset + size > data.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && size >= 8) {
        mime = 'image/jpeg'; height = data.readUInt16BE(offset + 3); width = data.readUInt16BE(offset + 5); break;
      }
      offset += size;
    }
  } else if (data.length >= 25 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' && data.readUInt32LE(4) + 8 === data.length) {
    const chunk = data.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && data.length >= 30 && data.readUInt32LE(16) === 10) {
      width = data.readUIntLE(24, 3) + 1; height = data.readUIntLE(27, 3) + 1; mime = 'image/webp';
    } else if (chunk === 'VP8L' && data[20] === 47) {
      const packed = data.readUInt32LE(21);
      width = (packed & 16383) + 1; height = ((packed >>> 14) & 16383) + 1; mime = 'image/webp';
    } else if (chunk === 'VP8 ' && data.length >= 30 && data[23] === 157 && data[24] === 1 && data[25] === 42) {
      width = data.readUInt16LE(26) & 16383; height = data.readUInt16LE(28) & 16383; mime = 'image/webp';
    }
  }
  if (!mime || !width || !height || width > 4096 || height > 4096 || width * height > MAX_PIXELS) fail('bfl_invalid_image', providerId);
  return { mime, width, height };
}

export async function generateIllustration(input: BflInput, deps: Dependencies = {}): Promise<{
  bytes: Buffer; mime: ImageMime; providerId: string; width: number; height: number;
}> {
  let base: URL;
  try {
    if (typeof input.key !== 'string' || !input.key || input.key.length > 512 || /[\s\x00-\x1f\x7f]/.test(input.key) || !models.has(input.model)
      || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 8000 || input.prompt.includes('\0')
      || ![input.width, input.height].every(size => Number.isInteger(size) && size >= 64 && size <= 4096)
      || input.width * input.height > MAX_PIXELS) fail('bfl_invalid_request');
    base = secureUrl(input.baseUrl, 'base', input.key);
    if (input.signal.aborted) fail('bfl_aborted');
  } catch (error) { throw new BflError(error instanceof BflError ? error.code : 'bfl_invalid_request', undefined, false, true); }
  const fetcher = deps.fetch ?? fetch;
  const wait = deps.sleep ?? sleep;
  const controller = new AbortController();
  let timedOut = false, postAttempted = false, providerId: string | undefined;
  const abort = () => controller.abort();
  input.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, DEADLINE_MS);
  const signal = controller.signal;
  const request = async (url: URL, options: RequestInit) => {
    if (signal.aborted) fail('bfl_aborted', providerId);
    const submission = options.method === 'POST';
    if (submission) postAttempted = true;
    const response = await abortable(fetcher(url, { ...options, signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' }), signal);
    http(response, providerId, submission);
    return response;
  };
  try {
    const submitted = await json(await request(new URL(`/v1/${input.model}`, base), {
      method: 'POST', headers: { 'x-key': input.key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ prompt: input.prompt, width: input.width, height: input.height, output_format: 'png', safety_tolerance: 2 }),
    }), signal);
    if (typeof submitted.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(submitted.id) || submitted.id === input.key) fail('bfl_invalid_response');
    providerId = submitted.id;
    if (input.onSubmitted) {
      try { await abortable(Promise.resolve(input.onSubmitted(providerId)), signal); }
      catch { if (signal.aborted) fail('bfl_aborted', providerId); fail('bfl_submission_record_failed', providerId); }
    }
    const pollingUrl = secureUrl(submitted.polling_url, 'poll', input.key, providerId);
    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      await abortable(wait(POLL_INTERVAL_MS, signal), signal);
      const result = await json(await request(pollingUrl, { method: 'GET', headers: { 'x-key': input.key, Accept: 'application/json' } }), signal, providerId);
      if (result.id !== undefined && result.id !== providerId) fail('bfl_invalid_response', providerId);
      if (result.status === 'Ready') {
        const delivery = secureUrl(result.result?.sample, 'image', input.key, providerId);
        const response = await request(delivery, { method: 'GET', headers: { Accept: 'image/png,image/jpeg,image/webp', 'Accept-Encoding': 'identity' } });
        const claimedMime = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
        if (claimedMime && !['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'].includes(claimedMime)) fail('bfl_invalid_image', providerId);
        const data = await bytes(response, MAX_IMAGE_BYTES, signal, providerId);
        const info = imageInfo(data, providerId);
        return { bytes: data, providerId, ...info };
      }
      if (['Request Moderated', 'Content Moderated'].includes(result.status)) fail('bfl_moderated', providerId);
      if (result.status === 'Task not found') fail('bfl_task_not_found', providerId);
      if (['Error', 'Failed', 'No Card Generated'].includes(result.status)) fail('bfl_generation_failed', providerId);
      if (!['Pending', 'Reasoning', 'Generating'].includes(result.status)) fail('bfl_invalid_response', providerId);
    }
    fail('bfl_timeout', providerId);
  } catch (error) {
    if (error instanceof BflError && error.definiteRejection && !providerId) throw error;
    if (input.signal.aborted) throw new BflError('bfl_aborted', providerId, postAttempted, !postAttempted);
    if (timedOut) throw new BflError('bfl_timeout', providerId, postAttempted, !postAttempted);
    if (error instanceof BflError) throw new BflError(error.code, providerId ?? error.providerId, postAttempted, !postAttempted);
    throw new BflError('bfl_unavailable', providerId, postAttempted, !postAttempted);
  } finally { clearTimeout(timer); input.signal.removeEventListener('abort', abort); controller.abort(); }
}
