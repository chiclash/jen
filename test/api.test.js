import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, pollGeneration } from '../frontend/src/api.js';

async function withTransport(transport, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = transport;
  try { await run(); } finally { globalThis.fetch = previous; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

test('API transport uses same-origin cookies and does not cache personalized responses', async () => {
  await withTransport(async (url, options) => {
    assert.equal(url, '/api/session');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    return json({ state: null, cat: null, aiConfigured: false });
  }, async () => assert.equal((await api.session()).aiConfigured, false));
});

test('photo upload transports the exact supplied image bytes and name', async () => {
  const bytes = Uint8Array.from([0, 1, 2, 127, 128, 254, 255]);
  const file = new File([bytes], 'my-cat.png', { type: 'image/png' });
  await withTransport(async (url, options) => {
    assert.equal(url, '/api/cats');
    assert.equal(options.method, 'POST');
    const { photos } = JSON.parse(options.body);
    assert.equal(photos.length, 1);
    assert.equal(photos[0].name, 'my-cat.png');
    assert.equal(photos[0].mimeType, 'image/png');
    assert.deepEqual(Buffer.from(photos[0].data, 'base64'), Buffer.from(bytes));
    return json({ id: 'cat-one', revision: 1, photos: [] });
  }, async () => assert.equal((await api.uploadCat([{ blob: file, name: 'my-cat.png' }])).id, 'cat-one'));
});

test('upload validation rejects unsupported, oversized, or absent photos before transport', async () => {
  await withTransport(async () => assert.fail('Invalid photos must never reach the server'), async () => {
    await assert.rejects(api.uploadCat([]), { code: 'INVALID_PHOTO_COUNT' });
    await assert.rejects(api.uploadCat([new File(['gif'], 'cat.gif', { type: 'image/gif' })]), { code: 'INVALID_PHOTO_TYPE' });
    await assert.rejects(api.uploadCat([new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'image/png' })]), { code: 'PHOTO_TOO_LARGE' });
  });
});

test('missing API configuration remains a real error without fake image results', async () => {
  await withTransport(async () => json({ error: { code: 'AI_NOT_CONFIGURED', message: 'Configure the server API key.' } }, 503), async () => {
    await assert.rejects(api.startGeneration({ catId: 'one', mode: 'real' }), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'AI_NOT_CONFIGURED');
      assert.equal(error.status, 503);
      assert.equal(error.message, 'Configure the server API key.');
      return true;
    });
  });
});

test('paid-request gate surfaces as a configuration error without retrying or enabling AI', async () => {
  let requests = 0;
  await withTransport(async () => {
    requests++;
    return json({ error: { code: 'AI_PAID_DISABLED', message: 'Paid AI requests are disabled on this server.' } }, 403);
  }, async () => {
    await assert.rejects(api.analyzeCat('cat-one'), { code: 'AI_PAID_DISABLED', status: 403 });
    assert.equal(requests, 1);
  });
});

test('malformed successful responses are rejected', async () => {
  await withTransport(async () => new Response('<html>proxy page</html>', { status: 200 }), async () => {
    await assert.rejects(api.health(), { code: 'INVALID_RESPONSE' });
  });
});

test('caller cancellation aborts fetch and surfaces a cancellation error', async () => {
  const controller = new AbortController();
  await withTransport(async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    controller.abort();
  }), async () => {
    await assert.rejects(api.analyzeCat('cat-one', { signal: controller.signal }), { code: 'CANCELLED' });
  });
});

test('polling returns only the actual completed backend result', async () => {
  let count = 0;
  const observed = [];
  const result = { id: 'generation-one', catId: 'cat-one', texture: { url: '/api/assets/texture' } };
  await withTransport(async () => json(++count === 1
    ? { id: 'job-one', status: 'running', progress: { completed: 1, total: 6 } }
    : { id: 'job-one', status: 'complete', result }), async () => {
    assert.deepEqual(await pollGeneration('job-one', { intervalMs: 1, onProgress: job => observed.push(job.status) }), result);
    assert.deepEqual(observed, ['running', 'complete']);
  });
});

test('failed generation propagates the public backend error instead of returning a preset', async () => {
  await withTransport(async () => json({ status: 'failed', error: { code: 'AI_RATE_LIMITED', message: 'Please try again later.' } }), async () => {
    await assert.rejects(pollGeneration('job-one'), { code: 'AI_RATE_LIMITED', status: 502 });
  });
});

test('aborting polling requests server-side cancellation', async () => {
  const controller = new AbortController();
  let cancelled = false;
  await withTransport(async (_url, options) => {
    if (options.method === 'DELETE') { cancelled = true; return json({ status: 'cancelled' }); }
    return json({ id: 'job-one', status: 'running', progress: { completed: 0, total: 6 } });
  }, async () => {
    await assert.rejects(pollGeneration('job-one', {
      signal: controller.signal, onProgress: () => controller.abort(),
    }), { code: 'CANCELLED' });
    assert.equal(cancelled, true);
  });
});
