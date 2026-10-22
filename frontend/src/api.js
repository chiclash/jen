/** Same-origin transport for the real personalization backend. No AI fallback lives here. */
export class ApiError extends Error {
  constructor(message, { code = 'API_ERROR', status = 0, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function cancelled() {
  return new ApiError('The operation was cancelled.', { code: 'CANCELLED' });
}

function checkSignal(signal) {
  if (signal?.aborted) throw cancelled();
}

function idPath(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
    throw new ApiError('The requested resource is missing an identifier.', { code: 'INVALID_REQUEST' });
  }
  return encodeURIComponent(id);
}

function responseError(payload, status) {
  const error = payload?.error && typeof payload.error === 'object' ? payload.error : payload;
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)
    ? error.code : 'API_ERROR';
  // Only the backend's designated public error field is shown, never a raw response body.
  const message = typeof error?.message === 'string' && error.message.trim()
    ? error.message.slice(0, 500)
    : status === 413 ? 'The uploaded images are too large.'
      : `The server could not complete this request (${status}).`;
  return new ApiError(message, { code, status });
}

async function request(path, { method = 'GET', body, signal, timeoutMs = 30_000 } = {}) {
  checkSignal(signal);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'same-origin',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    checkSignal(signal);
    let payload;
    try { payload = await response.json(); }
    catch {
      if (!response.ok) throw responseError(null, response.status);
      throw new ApiError('The server returned an unreadable response.', { code: 'INVALID_RESPONSE', status: response.status });
    }
    if (!response.ok) throw responseError(payload, response.status);
    if (!payload || typeof payload !== 'object') {
      throw new ApiError('The server returned an incomplete response.', { code: 'INVALID_RESPONSE', status: response.status });
    }
    return payload;
  } catch (error) {
    if (signal?.aborted) throw cancelled();
    if (timedOut) {
      throw new ApiError('The server took too long to respond. Please try again.', { code: 'REQUEST_TIMEOUT', cause: error });
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError('Could not reach the personalization server. Check your connection and try again.', {
      code: 'NETWORK_ERROR', cause: error,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function encodePhoto(input, index, signal) {
  checkSignal(signal);
  const blob = input?.blob || input;
  if (!blob || typeof blob.arrayBuffer !== 'function' || !Number.isFinite(blob.size)) {
    throw new ApiError('Choose a JPEG, PNG or WebP cat photo.', { code: 'INVALID_PHOTO' });
  }
  if (!PHOTO_TYPES.has(blob.type)) {
    throw new ApiError('Use JPEG, PNG or WebP cat photos.', { code: 'INVALID_PHOTO_TYPE' });
  }
  if (!blob.size || blob.size > MAX_PHOTO_BYTES) {
    throw new ApiError('Each cat photo must be nonempty and no larger than 8 MB.', { code: 'PHOTO_TOO_LARGE' });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  checkSignal(signal);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
  const name = String(input.name || blob.name || `cat-photo-${index + 1}.${extension}`)
    .replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200);
  return { name, mimeType: blob.type, data: btoa(binary) };
}

export const api = {
  health: (options = {}) => request('/api/health', options),
  session: (options = {}) => request('/api/session', options),
  saveSession: (state, options = {}) => request('/api/session', { ...options, method: 'PUT', body: { state } }),
  clearSession: (options = {}) => request('/api/session', { ...options, method: 'DELETE' }),
  async uploadCat(files, options = {}) {
    const list = Array.from(files || []);
    if (!list.length || list.length > 3) {
      throw new ApiError('Upload between one and three cat photos.', { code: 'INVALID_PHOTO_COUNT' });
    }
    // Sequential conversion bounds peak memory with large uploads.
    const photos = [];
    for (let i = 0; i < list.length; i++) photos.push(await encodePhoto(list[i], i, options.signal));
    return request('/api/cats', { timeoutMs: 60_000, ...options, method: 'POST', body: { photos } });
  },
  analyzeCat: (catId, options = {}) => request(`/api/cats/${idPath(catId)}/analyze`, {
    timeoutMs: 150_000, ...options, method: 'POST', body: {},
  }),
  startGeneration: (body, options = {}) => request('/api/generations', { ...options, method: 'POST', body }),
  job: (id, options = {}) => request(`/api/generations/${idPath(id)}`, options),
  cancelJob: (id, options = {}) => request(`/api/generations/${idPath(id)}`, {
    timeoutMs: 10_000, ...options, method: 'DELETE',
  }),
};

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    checkSignal(signal);
    const abort = () => { clearTimeout(timer); reject(cancelled()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** onProgress receives the full backend job, including its progress and status. */
export async function pollGeneration(jobId, {
  signal, onProgress, intervalMs = 1000, timeoutMs = 20 * 60_000,
} = {}) {
  const started = Date.now();
  try {
    while (true) {
      checkSignal(signal);
      if (Date.now() - started > timeoutMs) {
        throw new ApiError('Image generation has taken too long. The request was stopped; please try again.', {
          code: 'GENERATION_TIMEOUT',
        });
      }
      const job = await api.job(jobId, { signal });
      onProgress?.(job);
      if (job.status === 'complete') {
        if (!job.result || typeof job.result !== 'object') {
          throw new ApiError('Generation finished without any image assets. Please try again.', { code: 'INVALID_RESPONSE' });
        }
        return job.result;
      }
      if (job.status === 'failed') throw responseError(job, 502);
      if (job.status === 'cancelled') {
        throw new ApiError('Image generation was cancelled.', { code: 'GENERATION_CANCELLED', status: 409 });
      }
      if (job.status !== 'queued' && job.status !== 'running') {
        throw new ApiError('The server returned an invalid generation state.', { code: 'INVALID_RESPONSE' });
      }
      await pause(Math.max(50, intervalMs), signal);
    }
  } catch (error) {
    if (['CANCELLED', 'GENERATION_TIMEOUT'].includes(error.code)) {
      // A disconnected tab must not deliberately leave more image requests running.
      void api.cancelJob(jobId).catch(() => {});
    }
    throw error;
  }
}

/** Native downloads work outside Claude; callers supply JSON, HTML, or a Blob. */
export function downloadFile({ filename, data, type = 'application/octet-stream' }) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = String(filename || 'charcoal-design').replace(/[\\/\u0000-\u001f]/g, '_');
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
