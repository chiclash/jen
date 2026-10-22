/** Browser integration tests use only explicitly injected image fixtures, never paid AI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import { chromium as playwright } from 'playwright-core';
import sharp from 'sharp';
import { createApp } from '../server/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const catPhoto = path.join(root, 'frontend/a/cat-portrait.webp');
const secondPhoto = path.join(root, 'frontend/a/cat-jacket.webp');
const traits = {
  pattern: 'solid', coat: 'short', colors: { main: '#8E8C91', second: '#6A696F', third: '#B4B1B4' },
  eye: 'copper', expression: 'unimpressed', face: 'round', ears: 'small',
  markings: { white_muzzle: true }, distinctive: ['Small white muzzle', 'Round copper eyes'], uncertain: [],
  summary: 'Browser test fixture: gray cat with copper eyes and a small white muzzle.',
};
async function launch(t, { fixtureProvider = false, holdFirstImage = false } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'charcoal-browser-test-'));
  const calls = [];
  let releaseGeneration = () => {};
  const firstImageBarrier = holdFirstImage ? new Promise(resolve => { releaseGeneration = resolve; }) : Promise.resolve();
  const fixture = {
    models: { vision: 'test-fixture-vision', image: 'test-fixture-image' },
    async analyze(photos) {
      assert.ok(photos.length > 0 && photos.every(photo => Buffer.isBuffer(photo.bytes) && photo.bytes.length));
      calls.push({ kind: 'analyze', photoCount: photos.length });
      return structuredClone(traits);
    },
    async generate(request) {
      assert.ok(request.photos.length > 0 && request.photos.every(photo => Buffer.isBuffer(photo.bytes)));
      calls.push({ kind: request.kind, mode: request.mode, personality: request.personality, identity: Boolean(request.identity) });
      if (request.kind === 'identity') await firstImageBarrier;
      const fill = request.mode === 'art' ? '#c08a58' : '#85828c';
      const svg = request.kind === 'texture'
        ? `<svg width="128" height="128"><rect width="128" height="128" fill="${fill}"/><path d="M0 15L128 65M0 75L128 125" stroke="#bdb5bd" stroke-width="12"/></svg>`
        : `<svg width="128" height="128"><circle cx="64" cy="67" r="42" fill="${fill}"/><path d="M25 48L28 8L55 29M73 29L100 8L104 48" fill="${fill}"/><circle cx="47" cy="61" r="5" fill="#c9772b"/><circle cx="81" cy="61" r="5" fill="#c9772b"/><ellipse cx="64" cy="85" rx="16" ry="9" fill="#f6f1e8"/></svg>`;
      return { bytes: await sharp(Buffer.from(svg)).png().toBuffer(), mimeType: 'image/png' };
    },
  };
  const app = createApp({ dataDir, ...(fixtureProvider ? { provider: fixture, aiConfigured: true, paidRequestsEnabled: true } : { aiConfigured: false, paidRequestsEnabled: false }) });
  let browser, context;
  // Register cleanup before startup so a launch failure cannot leave a listening server.
  t.after(async () => {
    releaseGeneration();
    await context?.close();
    await browser?.close();
    app.server.closeAllConnections();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [], outsideRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/') || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
    outsideRequests.push(url);
    return route.abort();
  });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('#fileIn').waitFor({ state: 'attached' });
  return { app, page, context, origin, calls, errors, outsideRequests, releaseGeneration };
}

async function currentStep(page, step) {
  await page.locator(`#steps [data-step="${step}"][aria-current="step"]`).waitFor({ timeout: 20_000 });
}
async function next(page, step) {
  await page.waitForFunction(() => {
    const next = document.querySelector('#nextBtn');
    return next && !next.disabled && !next.hidden;
  });
  await page.locator('#nextBtn').click();
  await currentStep(page, step);
}
async function upload(page, photo = catPhoto, name = 'Miso') {
  const uploaded = page.waitForResponse(response => response.url().endsWith('/api/cats') && response.request().method() === 'POST' && response.status() === 201);
  await page.locator('#fileIn').setInputFiles(photo);
  await uploaded;
  await page.waitForFunction(() => document.querySelector('#fileIn') && !document.querySelector('#fileIn').disabled && !document.querySelector('#nextBtn').disabled);
  await page.locator('#catName').fill(name);
  await next(page, 2);
  await page.locator('#trait-color-main').waitFor({ timeout: 20_000 });
}
async function session(page) {
  return page.evaluate(async () => (await fetch('/api/session')).json());
}
async function assertCanvas(page) {
  await page.locator('#canvas canvas').waitFor({ timeout: 15_000 });
  assert.ok(await page.locator('#canvas canvas').evaluate(canvas => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return canvas.width > 100 && canvas.height > 100 && data.some((value, index) => index % 4 === 3 && value > 0);
  }), 'Footwear canvas has visible pixels');
}
async function canvasSignature(page) {
  await assertCanvas(page);
  return page.locator('#canvas canvas').evaluate(canvas => canvas.toDataURL('image/png'));
}
async function waitSaved(page, predicate) {
  for (let i = 0; i < 30; i++) {
    const snapshot = await session(page);
    if (predicate(snapshot)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('Expected design state was not persisted');
}

test('disabled-AI browser flow preserves sections, six steps, original footwear and saved edits without paid calls', { timeout: 90_000 }, async t => {
  const { page, calls, errors, outsideRequests } = await launch(t);
  for (const id of ['top', 'charcoal', 'customize', 'how', 'connection', 'family']) {
    assert.equal(await page.locator(`#${id}`).count(), 1, `Original ${id} section remains`);
  }
  assert.equal(await page.locator('#steps [data-step]').count(), 6);
  await upload(page);
  assert.match(await page.locator('#panel').innerText(), /disabled|not configured|manual|not recognized/i);
  await page.locator('[data-trait="eye"]').selectOption('green');
  await page.locator('[data-trait="face"]').selectOption('wedge');
  await page.locator('[data-action="confirm-profile"]').click();
  await next(page, 3);
  await page.locator('[data-habit="playful"]').click();
  await page.locator('#favToy').fill('purple feather wand');
  await page.locator('#catNote').fill('Loves jumping after feathers.');
  await next(page, 4);
  assert.match(await page.locator('#panel').innerText(), /disabled|not configured/i);
  assert.equal(await page.locator('[data-action="generate"]').isDisabled(), true);
  assert.equal(await page.locator('#panel img[src^="/api/assets/"]').count(), 0, 'Disabled AI does not claim generated charm results');
  await next(page, 5);
  await assertCanvas(page);
  await page.evaluate(() => document.querySelector('#customize').scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: '/tmp/charcoal-ui-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.querySelector('#studio').scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: '/tmp/charcoal-ui-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('[data-action="strap-toggle"]').click();
  await page.locator('[data-action="upper-toggle"]').click();
  for (const view of ['side', 'top', 'back', 'bottom']) {
    await page.locator(`#viewSeg [data-view="${view}"]`).click();
    await assertCanvas(page);
    assert.equal(await page.locator(`#viewSeg [data-view="${view}"]`).getAttribute('aria-pressed'), 'true');
  }
  const saved = await waitSaved(page, snapshot => snapshot.state?.design?.strapOn === false && snapshot.state?.design?.upperOn === false);
  assert.equal(saved.state.traits.eye, 'green');
  assert.equal(saved.state.traits.face, 'wedge');
  const firstCat = saved.cat.id;
  await page.reload({ waitUntil: 'networkidle' });
  await currentStep(page, 5);
  assert.equal(await page.locator('[data-action="strap-toggle"]').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('[data-action="upper-toggle"]').getAttribute('aria-checked'), 'false');
  await next(page, 6);
  const download = page.waitForEvent('download');
  await page.locator('[data-action="download-json"]').click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  assert.equal(exported.state.name, 'Miso');
  assert.equal(exported.state.traits.eye, 'green');
  assert.ok(Object.keys(exported.embeddedAssets).length > 0, 'Portable JSON includes actual photo bytes');
  await page.locator('[data-action="restart"]').click();
  await currentStep(page, 1);
  assert.equal(await page.locator('#catName').inputValue(), '');
  await upload(page, secondPhoto, 'New cat');
  await page.locator('[data-action="confirm-profile"]').click();
  await next(page, 3);
  assert.equal(await page.locator('#favToy').inputValue(), '');
  assert.equal(await page.locator('[data-habit="playful"]').getAttribute('aria-pressed'), 'false');
  const fresh = await session(page);
  assert.notEqual(fresh.cat.id, firstCat);
  assert.deepEqual(fresh.generations, []);
  assert.equal(calls.length, 0);
  assert.ok(!outsideRequests.some(url => /api\.openai\.com/.test(url)));
  assert.deepEqual(errors, []);
});

test('explicit fixture-provider browser flow consumes generated assets for both modes and restores the saved cat', { timeout: 90_000 }, async t => {
  const { page, calls, errors, outsideRequests } = await launch(t, { fixtureProvider: true });
  await upload(page, catPhoto, 'Charcoal fixture');
  await page.locator('[data-action="analyze"]').click();
  await page.waitForFunction(() => document.querySelector('#panel')?.innerText.includes('Recognized from your uploaded photos'));
  await page.locator('[data-action="confirm-profile"]').click();
  await next(page, 3);
  await page.locator('[data-habit="curious"]').click();
  await page.locator('#favToy').fill('a favorite red ball');
  await next(page, 4);
  await page.locator('[data-action="generate"]').click();
  await page.waitForFunction(async () => {
    const data = await (await fetch('/api/session')).json();
    return data.generations?.some(generation => generation.mode === 'real');
  }, undefined, { timeout: 30_000 });
  await page.locator('#panel img[src^="/api/assets/"]').first().waitFor({ timeout: 30_000 });
  assert.equal(calls.filter(call => call.kind === 'identity').length, 1);
  assert.equal(calls.filter(call => call.kind === 'face').length, 1);
  assert.ok(calls.filter(call => call.kind !== 'identity' && call.kind !== 'analyze').every(call => call.identity));
  assert.ok(calls.filter(call => call.kind === 'toy').every(call => call.personality.favoriteToy === 'a favorite red ball'));
  await page.locator('[data-mode="art"]').click();
  await page.locator('[data-action="generate"]').click();
  await page.waitForFunction(async () => {
    const data = await (await fetch('/api/session')).json();
    return data.generations?.some(generation => generation.mode === 'art');
  }, undefined, { timeout: 30_000 });
  await next(page, 5);
  await assertCanvas(page);
  await page.evaluate(() => document.querySelector('#customize').scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: '/tmp/charcoal-ui-fixture.png' });
  const artPixels = await canvasSignature(page);
  await page.locator('[data-mode="real"]').click();
  await page.waitForFunction(previous => document.querySelector('#canvas canvas')?.toDataURL('image/png') !== previous, artPixels);
  const realPixels = await canvasSignature(page);
  await page.locator('[data-mode="art"]').click();
  await page.waitForFunction(previous => document.querySelector('#canvas canvas')?.toDataURL('image/png') !== previous, realPixels);
  for (const view of ['side', 'top', 'back', 'bottom']) {
    await page.locator(`#viewSeg [data-view="${view}"]`).click();
    await assertCanvas(page);
  }
  const saved = await waitSaved(page, snapshot => snapshot.state?.step === 5 && snapshot.generations?.length === 2);
  const characterIds = new Set(saved.generations.map(generation => generation.character.id));
  assert.equal(characterIds.size, 1, 'Both modes reuse the same generated cat identity');
  assert.equal(calls.filter(call => call.kind === 'identity').length, 1);
  assert.ok(calls.some(call => call.kind === 'texture' && call.mode === 'real'));
  assert.ok(calls.some(call => call.kind === 'texture' && call.mode === 'art'));
  const ids = saved.generations.map(generation => generation.id).sort();
  await page.reload({ waitUntil: 'networkidle' });
  await currentStep(page, 5);
  assert.deepEqual((await session(page)).generations.map(generation => generation.id).sort(), ids);
  await assertCanvas(page);
  assert.ok(!outsideRequests.some(url => /api\.openai\.com/.test(url)));
  assert.deepEqual(errors, []);
});

test('fixture generation reconnects after reload and one-charm regeneration preserves saved customization', { timeout: 90_000 }, async t => {
  const { page, calls, errors, outsideRequests, releaseGeneration } = await launch(t, { fixtureProvider: true, holdFirstImage: true });
  await upload(page, catPhoto, 'Reload fixture');
  await page.locator('[data-action="confirm-profile"]').click();
  await next(page, 3);
  await page.locator('#favToy').fill('a green mouse toy');
  await next(page, 4);
  await waitSaved(page, snapshot => snapshot.state?.step === 4 && snapshot.state.favToy === 'a green mouse toy');
  await page.locator('[data-action="generate"]').click();
  await page.waitForFunction(async () => {
    const snapshot = await (await fetch('/api/session')).json();
    return snapshot.activeJob?.status === 'running';
  });
  const jobId = (await session(page)).activeJob.id;
  await page.reload({ waitUntil: 'networkidle' });
  await currentStep(page, 4);
  await page.locator('[data-action="cancel"]').waitFor();
  assert.equal((await session(page)).activeJob.id, jobId, 'Reload reconnects to the same job instead of creating a new one');
  assert.equal(calls.filter(call => call.kind === 'identity').length, 1);
  releaseGeneration();
  await page.waitForFunction(() => !document.querySelector('#nextBtn').disabled, undefined, { timeout: 30_000 });
  await next(page, 5);
  await assertCanvas(page);
  const first = (await session(page)).generations.find(generation => generation.mode === 'real');
  assert.equal(first.charms.length, 4);
  await page.locator('[data-action="strap-toggle"]').click();
  await page.locator(`[data-remove-charm="${first.charms[2].id}"]`).click();
  await page.locator('[data-down="0"]').click();
  const edited = await waitSaved(page, snapshot => snapshot.state?.design?.strapOn === false && snapshot.state.design.charms.length === 3);
  const selected = edited.state.design.charms;
  const originalCalls = calls.length;
  await page.locator(`[data-regenerate-charm="${first.charms[0].id}"]`).click();
  const regenerated = await waitSaved(page, snapshot => {
    const latest = snapshot.generations.find(generation => generation.mode === 'real');
    return latest?.id !== first.id && snapshot.state?.generations?.real?.id === latest.id;
  });
  const latest = regenerated.generations.find(generation => generation.mode === 'real');
  assert.equal(calls.length, originalCalls + 1, 'Regenerating one charm requests exactly one fixture image');
  assert.equal(calls.at(-1).kind, 'face');
  assert.equal(latest.character.id, first.character.id);
  assert.equal(latest.texture.id, first.texture.id);
  assert.notEqual(latest.charms[0].asset.id, first.charms[0].asset.id);
  for (let index = 1; index < first.charms.length; index++) assert.equal(latest.charms[index].asset.id, first.charms[index].asset.id);
  assert.equal(regenerated.state.design.strapOn, false);
  assert.deepEqual(regenerated.state.design.charms, selected, 'Regeneration preserves removed charms and customized order');
  await page.reload({ waitUntil: 'networkidle' });
  await currentStep(page, 5);
  assert.equal(await page.locator('[data-action="strap-toggle"]').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('.order li').count(), 3);
  assert.ok(!outsideRequests.some(url => /api\.openai\.com/.test(url)));
  assert.deepEqual(errors, []);
});
