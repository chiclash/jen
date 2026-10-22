import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import sharp from 'sharp';
import { createApp } from '../server/index.js';

const traits = { pattern: 'bicolor', coat: 'short', colors: { main: '#7D7D81', second: '#F4EEE8', third: null }, eye: 'green', expression: 'alert', face: 'round', ears: 'medium', markings: { white_muzzle: true, nose_spot: true }, distinctive: ['white left cheek', 'green eyes'], uncertain: [], summary: 'Gray and white cat with an asymmetric cheek marking.' };
const image = await sharp({ create: { width: 24, height: 24, channels: 4, background: '#998877' } }).png().toBuffer();
const fakeProvider = calls => ({
  models: { visionModel: 'fixture-vision', imageModel: 'fixture-image' },
  async analyze(photos) { calls.push({ analyze: photos }); return structuredClone(traits); },
  async generate(request) { calls.push(request); return { bytes: image, mimeType: 'image/png' }; },
});

async function fixture(t, options = {}) {
  const dataDir = options.dataDir || await mkdtemp(path.join(os.tmpdir(), 'charcoal-server-test-'));
  const app = createApp({ dataDir, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); if (!options.dataDir) await rm(dataDir, { recursive: true, force: true }); });
  function client(initial = '') {
    let cookie = initial;
    return {
      get cookie() { return cookie; },
      async request(route, { method = 'GET', data } = {}) {
        const response = await fetch(base + route, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
        const header = response.headers.get('set-cookie');
        if (header) cookie = header.split(';')[0];
        const json = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
        return { status: response.status, json, response };
      },
    };
  }
  return { ...app, base, dataDir, client };
}

async function upload(client) {
  const response = await client.request('/api/cats', { method: 'POST', data: { photos: [{ name: 'test-cat.png', mimeType: 'image/png', data: image.toString('base64') }] } });
  assert.equal(response.status, 201);
  return response.json;
}

const generationRequest = (cat, overrides = {}) => ({ catId: cat.id, revision: cat.revision, mode: 'real', traits, personality: { name: 'Miso', habits: ['curious'], favoriteToy: 'red feather wand', note: 'Likes jumping into boxes' }, ...overrides });
async function terminal(client, id) {
  for (let i = 0; i < 300; i++) {
    const { status, json } = await client.request(`/api/generations/${id}`);
    assert.equal(status, 200);
    if (['complete', 'failed', 'cancelled'].includes(json.status)) return json;
    await pause(5);
  }
  assert.fail('Fixture generation did not finish');
}

test('paid APIs stay disabled by default even with an injected provider; no provider calls occur', async t => {
  const calls = [];
  const app = await fixture(t, { provider: fakeProvider(calls), aiConfigured: true });
  const client = app.client();
  const health = await client.request('/api/health');
  assert.equal(health.json.aiConfigured, true);
  assert.equal(health.json.paidRequestsEnabled, false);
  const cat = await upload(client);
  for (const [route, data] of [[`/api/cats/${cat.id}/analyze`, {}], ['/api/generations', generationRequest(cat)]]) {
    const blocked = await client.request(route, { method: 'POST', data });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.error.code, 'AI_PAID_DISABLED');
    assert.match(blocked.json.error.message, /No request was sent/);
  }
  assert.equal(calls.length, 0);
});

test('explicit test enable still requires credentials/configuration and never reports fake success', async t => {
  const calls = [];
  const app = await fixture(t, { provider: fakeProvider(calls), paidRequestsEnabled: true, aiConfigured: false });
  const client = app.client();
  const cat = await upload(client);
  const response = await client.request(`/api/cats/${cat.id}/analyze`, { method: 'POST', data: {} });
  assert.equal(response.status, 503);
  assert.equal(response.json.error.code, 'AI_NOT_CONFIGURED');
  assert.equal(calls.length, 0);
});

test('uploaded photos and saved UI state are durable and scoped to the browser session', async t => {
  const first = await fixture(t);
  const client = first.client();
  const cat = await upload(client);
  const imageResponse = await client.request(cat.photos[0].url);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.response.headers.get('content-type'), 'image/png');
  assert.equal((await first.client().request(cat.photos[0].url)).status, 404);
  const state = { cat, step: 3, name: 'Miso', traits, selectedCharmIds: [], customizations: { upperOn: false } };
  assert.equal((await client.request('/api/session', { method: 'PUT', data: { state } })).status, 200);
  const cookie = client.cookie;
  await first.close();
  const second = await fixture(t, { dataDir: first.dataDir });
  const restored = await second.client(cookie).request('/api/session');
  assert.deepEqual(restored.json.state, state);
  assert.equal(restored.json.cat.id, cat.id);
  assert.equal((await second.client(cookie).request(cat.photos[0].url)).status, 200);
});

test('uploads reject unreadable image bytes and stale autosaves cannot overwrite a new cat', async t => {
  const app = await fixture(t);
  const client = app.client();
  const invalid = await client.request('/api/cats', { method: 'POST', data: { photos: [{ name: 'not-image.png', mimeType: 'image/png', data: Buffer.from('not an image').toString('base64') }] } });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.json.error.code, 'INVALID_IMAGE');
  const first = await upload(client);
  const second = await upload(client);
  const saved = await client.request('/api/session', { method: 'PUT', data: { state: { cat: first, name: 'Old cat' } } });
  assert.equal(saved.status, 409);
  assert.equal(saved.json.error.code, 'STALE_CAT');
  assert.equal((await client.request('/api/session')).json.cat.id, second.id);
});

test('aborting a fully received upload during normalization preserves the active cat and saved design', async t => {
  const app = await fixture(t);
  const client = app.client();
  const originalCat = await upload(client);
  const state = { cat: originalCat, name: 'Original cat', step: 3 };
  await client.request('/api/session', { method: 'PUT', data: { state } });
  const saveAsset = app.store.saveAsset.bind(app.store);
  let entered, release, normalized, disconnected;
  const didEnter = new Promise(resolve => { entered = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  const didNormalize = new Promise(resolve => { normalized = resolve; });
  const didDisconnect = new Promise(resolve => { disconnected = resolve; });
  app.store.saveAsset = async (...args) => {
    entered();
    await resume;
    try { return await saveAsset(...args); }
    finally { normalized(); }
  };
  app.server.on('request', (req, res) => {
    if (req.headers['x-test-abort-upload']) res.once('close', disconnected);
  });
  const controller = new AbortController();
  const request = fetch(app.base + '/api/cats', {
    method: 'POST', signal: controller.signal,
    headers: { Cookie: client.cookie, 'Content-Type': 'application/json', 'X-Test-Abort-Upload': '1' },
    body: JSON.stringify({ photos: [{ name: 'cancelled-cat.png', mimeType: 'image/png', data: image.toString('base64') }] }),
  }).catch(error => error);
  await didEnter;
  controller.abort();
  await Promise.race([didDisconnect, pause(2000).then(() => assert.fail('Upload connection did not close'))]);
  release();
  await didNormalize;
  await request;
  await pause(25); // Let the abandoned HTTP handler finish after its awaited normalization.
  const session = (await client.request('/api/session')).json;
  assert.equal(session.cat.id, originalCat.id);
  assert.deepEqual(session.state, state);
});

test('fixture generation uses original photo bytes, shares identity between modes, and regenerates just one charm', async t => {
  const calls = [];
  const app = await fixture(t, { provider: fakeProvider(calls), paidRequestsEnabled: true });
  const client = app.client();
  const cat = await upload(client);
  const analyzed = await client.request(`/api/cats/${cat.id}/analyze`, { method: 'POST', data: {} });
  assert.deepEqual(analyzed.json.traits, traits);
  assert.equal(calls[0].analyze.length, 1);
  calls.length = 0;
  const started = await client.request('/api/generations', { method: 'POST', data: generationRequest(cat) });
  assert.equal(started.status, 202);
  const result = await terminal(client, started.json.jobId);
  assert.equal(result.status, 'complete');
  assert.equal(result.result.charms.length, 4);
  assert.equal(typeof result.result.inputFingerprint, 'string');
  assert.deepEqual((await client.request('/api/session')).json.cat.traits, traits);
  assert.deepEqual(calls.map(c => c.kind), ['identity', 'texture', 'face', 'body', 'sleep', 'toy']);
  assert.ok(calls.every(c => c.photos[0].bytes.length > 0 && c.traits.colors.main === traits.colors.main));
  assert.ok(calls.slice(1).every(c => c.identity.bytes.length > 0));
  assert.equal(calls[5].personality.favoriteToy, 'red feather wand');
  assert.equal((await app.client().request(`/api/generations/${started.json.jobId}`)).status, 404);
  calls.length = 0;
  const artJob = await client.request('/api/generations', { method: 'POST', data: generationRequest(cat, { mode: 'art' }) });
  const art = await terminal(client, artJob.json.jobId);
  assert.equal(art.status, 'complete');
  assert.equal(art.result.character.id, result.result.character.id);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(c => c.mode === 'art'));
  calls.length = 0;
  const oldCharm = result.result.charms[1];
  const regenJob = await client.request('/api/generations', { method: 'POST', data: generationRequest(cat, { regenerateCharmId: oldCharm.id }) });
  const regen = await terminal(client, regenJob.json.jobId);
  assert.equal(regen.status, 'complete');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'body');
  assert.equal(regen.result.texture.id, result.result.texture.id);
  assert.equal(regen.result.charms[0].asset.id, result.result.charms[0].asset.id);
  assert.notEqual(regen.result.charms[1].asset.id, oldCharm.asset.id);
  assert.equal(regen.result.inputFingerprint, result.result.inputFingerprint);
  const recovered = (await client.request('/api/session')).json.generations;
  assert.equal(recovered.length, 2);
  const cookie = client.cookie;
  await app.close();
  const restarted = await fixture(t, { dataDir: app.dataDir });
  const restoredClient = restarted.client(cookie);
  const restored = (await restoredClient.request('/api/session')).json;
  assert.equal(restored.paidRequestsEnabled, false);
  assert.equal(restored.generations.length, 2);
  assert.equal(restored.generations.find(g => g.mode === 'real').id, regen.result.id);
  assert.equal((await restoredClient.request(regen.result.charms[1].asset.url)).status, 200);
  const changedSettings = await restoredClient.request('/api/generations', { method: 'POST', data: generationRequest(cat, { personality: { name: 'Miso', favoriteToy: 'different toy' }, regenerateCharmId: oldCharm.id }) });
  // Restoring saved artwork never changes the default paid-request gate.
  assert.equal(changedSettings.status, 403);
});

test('generation failures are explicit and never create preset outputs', async t => {
  const provider = fakeProvider([]);
  provider.generate = async () => { throw Object.assign(new Error('Provider is temporarily unavailable.'), { code: 'AI_UNAVAILABLE', status: 503 }); };
  const app = await fixture(t, { provider, paidRequestsEnabled: true });
  const client = app.client();
  const cat = await upload(client);
  const start = await client.request('/api/generations', { method: 'POST', data: generationRequest(cat) });
  const job = await terminal(client, start.json.jobId);
  assert.equal(job.status, 'failed');
  assert.equal(job.error.code, 'AI_UNAVAILABLE');
  assert.equal(job.result, undefined);
  assert.deepEqual((await client.request('/api/session')).json.generations, []);
});

test('new cat uploads cancel old jobs and old cat requests are rejected', async t => {
  let entered;
  const didEnter = new Promise(resolve => { entered = resolve; });
  const provider = fakeProvider([]);
  provider.generate = async ({ signal }) => {
    entered();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  };
  const app = await fixture(t, { provider, paidRequestsEnabled: true });
  const client = app.client();
  const old = await upload(client);
  const start = await client.request('/api/generations', { method: 'POST', data: generationRequest(old) });
  await didEnter;
  assert.equal((await client.request('/api/session')).json.activeJob.id, start.json.jobId);
  const current = await upload(client);
  const cancelled = await terminal(client, start.json.jobId);
  assert.equal(cancelled.status, 'cancelled');
  const stale = await client.request('/api/generations', { method: 'POST', data: generationRequest(old) });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, 'STALE_CAT');
  const session = (await client.request('/api/session')).json;
  assert.equal(session.cat.id, current.id);
  assert.deepEqual(session.generations, []);
});

test('non-cat provider responses fail validation instead of becoming AI profiles', async t => {
  const provider = fakeProvider([]);
  provider.analyze = async () => ({ ...traits, is_cat: false });
  const app = await fixture(t, { provider, paidRequestsEnabled: true });
  const client = app.client();
  const cat = await upload(client);
  const response = await client.request(`/api/cats/${cat.id}/analyze`, { method: 'POST', data: {} });
  assert.equal(response.status, 422);
  assert.equal(response.json.error.code, 'NOT_A_CAT');
  assert.equal((await client.request('/api/session')).json.cat.traits, null);
});
