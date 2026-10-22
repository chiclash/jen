import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, stateForCat, serializeState, restoreState, generationFingerprint } from '../frontend/src/state.js';

const cat = { id: 'cat_a', revision: 1, photos: [{ id: 'p1', url: '/api/assets/p1', name: 'cat.png' }] };
test('a new photo identity clears all previous-cat personalization and generated results', () => {
  const old = stateForCat(cat); old.name = 'Old'; old.habits = ['shrimp']; old.favToy = 'fish';
  old.generations.real = { id: 'old' }; old.design.charms = ['old'];
  const fresh = stateForCat({ ...cat, id: 'cat_b' });
  assert.equal(fresh.name, ''); assert.deepEqual(fresh.habits, []);
  assert.equal(fresh.favToy, ''); assert.equal(fresh.generations.real, null);
  assert.deepEqual(fresh.design.charms, []); assert.equal(fresh.profileConfirmed, false);
});
test('saved UI cannot enable paid AI or restore runtime tasks', () => {
  const s = stateForCat(cat); s.busy = true; s.paidRequestsEnabled = true;
  const saved = serializeState(s);
  assert.equal('paidRequestsEnabled' in saved, false); assert.equal('busy' in saved, false);
  const restored = restoreState({ ...saved, paidRequestsEnabled: true }, cat,
    { aiConfigured: true, paidRequestsEnabled: false });
  assert.equal(restored.paidRequestsEnabled, false); assert.equal(restored.busy, false);
});
test('restoration uses authoritative current cat and rejects another cat artwork', () => {
  const s = stateForCat(cat); s.name = 'Cat'; s.generations.real = {
    catId: 'other', revision: 1, mode: 'real', character: { url: '/api/assets/c' },
    texture: { url: '/api/assets/t' }, charms: [] };
  assert.equal(restoreState(serializeState(s), cat).generations.real, null);
  assert.equal(restoreState(serializeState(s), { ...cat, id: 'new' }).name, '');
});
test('generation fingerprint includes photos, face markings, eyes and personality', () => {
  const a = stateForCat(cat), b = structuredClone(a);
  b.traits.eye = 'green'; assert.notEqual(generationFingerprint(a), generationFingerprint(b));
  b.traits = structuredClone(a.traits); b.favToy = 'shrimp';
  assert.notEqual(generationFingerprint(a), generationFingerprint(b));
  assert.notEqual(generationFingerprint(a, 'real'), generationFingerprint(a, 'art'));
  assert.equal(initialState().paidRequestsEnabled, false);
});
