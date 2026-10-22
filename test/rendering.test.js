import test from 'node:test';
import assert from 'node:assert/strict';
import { compositeTexturePixels, maskRegion, normalizeView, selectedGenerationCharms, VIEW_CONFIG } from '../frontend/src/rendering.js';

test('material edits preserve soles, ventilation holes, rims and original alpha', () => {
  // Separate rows keep the vent boundary check from excluding the upper test.
  const base = new Uint8ClampedArray([
    240, 230, 210, 255, 200, 190, 180, 255, 30, 25, 20, 255,
    230, 225, 210, 255, 220, 210, 200, 255, 40, 30, 20, 0,
  ]);
  const map = new Uint8ClampedArray([
    0, 128, 0, 255, 255, 128, 0, 255, 255, 128, 255, 255,
    255, 128, 60, 255, 255, 128, 128, 255, 255, 128, 0, 255,
  ]);
  const result = compositeTexturePixels({ base, map, texture: new Uint8ClampedArray([120, 60, 30, 255]),
    width: 3, height: 2, textureWidth: 1, textureHeight: 1 });
  assert.deepEqual([...result.slice(0, 4)], [...base.slice(0, 4)], 'sole is unchanged');
  assert.deepEqual([...result.slice(8, 12)], [...base.slice(8, 12)], 'vent is unchanged');
  assert.deepEqual([...result.slice(16, 20)], [...base.slice(16, 20)], 'rim is unchanged');
  assert.deepEqual([...result.slice(20, 24)], [...base.slice(20, 24)], 'transparent silhouette remains unchanged');
  assert.deepEqual([...result.slice(12, 16)], [120, 60, 30, 255], 'generated texture appears on strap');
});

test('upper and strap layers can be removed independently', () => {
  const base = new Uint8ClampedArray([230, 225, 210, 255, 230, 225, 210, 255]);
  const map = new Uint8ClampedArray([255, 128, 0, 255, 255, 128, 60, 255]);
  const args = { base, map, texture: new Uint8ClampedArray([100, 50, 25, 255]), width: 2, height: 1, textureWidth: 1, textureHeight: 1 };
  const strapOnly = compositeTexturePixels({ ...args, upperOn: false, strapOn: true });
  assert.deepEqual([...strapOnly], [230, 225, 210, 255, 100, 50, 25, 255]);
  const upperOnly = compositeTexturePixels({ ...args, upperOn: true, strapOn: false });
  assert.deepEqual([...upperOnly], [100, 50, 25, 255, 230, 225, 210, 255]);
  assert.deepEqual([...base], [230, 225, 210, 255, 230, 225, 210, 255], 'source pixels are not mutated');
});

test('UV projection consumes generated image colors rather than a preset palette', () => {
  const base = new Uint8ClampedArray([200, 200, 200, 255, 200, 200, 200, 255]);
  const result = compositeTexturePixels({ base, map: new Uint8ClampedArray([255, 128, 0, 255, 255, 128, 0, 255]),
    uv: new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 0, 255]), texture: new Uint8ClampedArray([80, 30, 10, 255, 20, 100, 150, 255]),
    width: 2, height: 1, textureWidth: 2, textureHeight: 1 });
  assert.deepEqual([...result], [80, 30, 10, 255, 20, 100, 150, 255]);
});

test('texture zoom and strap accent affect editable material without recoloring the base', () => {
  const base = new Uint8ClampedArray([230, 225, 210, 255, 230, 225, 210, 255, 230, 225, 210, 255]);
  const args = { base, map: new Uint8ClampedArray([255, 128, 0, 255, 255, 128, 60, 255, 0, 128, 0, 255]),
    uv: new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255]),
    texture: new Uint8ClampedArray([80, 30, 10, 255, 20, 100, 150, 255]), width: 3, height: 1, textureWidth: 2, textureHeight: 1 };
  const original = compositeTexturePixels(args);
  const adjusted = compositeTexturePixels({ ...args, textureScale: 2, strapTint: [100, 50, 25] });
  assert.notDeepEqual([...adjusted.slice(0, 4)], [...original.slice(0, 4)], 'UV zoom changes the material projection');
  assert.notDeepEqual([...adjusted.slice(4, 8)], [...original.slice(4, 8)], 'strap accent changes its material only');
  assert.deepEqual([...adjusted.slice(8, 12)], [...base.slice(8, 12)], 'base cream is locked');
});

test('all views use original product geometry; outsole has no customization layer', () => {
  assert.equal(VIEW_CONFIG.bottom.base, 'g-soles.webp');
  assert.equal(VIEW_CONFIG.bottom.map, null);
  assert.deepEqual(VIEW_CONFIG.bottom.slots, []);
  for (const config of Object.values(VIEW_CONFIG)) assert.doesNotMatch(config.base, /^(?:f-|v-|jb\/)/);
  assert.equal(normalizeView('close'), 'detail');
  assert.throws(() => normalizeView('unknown'), /Unsupported/);
  assert.equal(maskRegion(255, 255), 'protected');
});

test('charms come from the selected generation, preserve ordering, and never fall back to library artwork', () => {
  const generation = { charms: [{ id: 'face', asset: { url: '/api/assets/face' } }, { id: 'sleep', asset: { url: '/api/assets/sleep' } }] };
  assert.deepEqual(selectedGenerationCharms({ charms: ['sleep', 'face'] }, generation).map(c => c.id), ['sleep', 'face']);
  assert.throws(() => selectedGenerationCharms({ charms: ['jb:bsh-face'] }, generation), { code: 'GENERATED_CHARM_MISSING' });
});
