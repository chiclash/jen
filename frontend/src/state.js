/** Serializable design state. Photos and artwork reference durable backend assets. */
import { generationInputKey } from './identity.js';
export const MODES = ['real', 'art'];
const ASSET_URL = /^\/api\/assets\/[A-Za-z0-9_-]+$/;
export const isAssetUrl = value => typeof value === 'string' && ASSET_URL.test(value);

export function manualTraits() {
  return { pattern: 'solid', coat: 'short', colors: { main: '#8E8C91', second: null, third: null },
    eye: 'gold', expression: 'alert', face: 'classic', ears: 'medium', markings: {}, distinctive: [],
    uncertain: ['pattern', 'colors', 'eye', 'face', 'markings'],
    summary: 'Manual profile. These fields have not been recognized by AI.' };
}

export function defaultDesign(traits = manualTraits(), mode = 'real', generation = null) {
  const eyeColors = { copper:'#C9772B', gold:'#D6A43A', green:'#7DA552', hazel:'#A39445', blue:'#6EA2D6', odd:'#6EA2D6' };
  return { direction: mode, upperOn: true, strapOn: true, strapStyle: 'match', scale: 1,
    texture: mode === 'art' ? 'velvet' : traits.coat === 'long' ? 'plush' : 'fine',
    colors: { base: traits.colors.main, m1: traits.colors.second || traits.colors.main,
      m2: traits.colors.third || traits.colors.main }, accent: eyeColors[traits.eye] || eyeColors.gold,
    charms: generation?.charms?.map(charm => charm.id) || [] };
}

export function initialState() {
  return { schemaVersion: 1, step: 1, max: 1, name: '', photos: [], cat: null,
    traits: null, profileConfirmed: false, source: null, sourceNote: '', habits: [], favToy: '', note: '',
    generations: { real: null, art: null }, designs: { real: null, art: null }, direction: 'real',
    design: defaultDesign(), view: 'side', busy: false, operation: null, progress: null, error: null,
    aiConfigured: false, paidRequestsEnabled: false, savedAt: null, persistenceError: null };
}

/** No previous-cat selections, personalities, or artwork may cross this boundary. */
export function stateForCat(cat, capability = {}) {
  const s = initialState();
  s.cat = { id: cat.id, revision: cat.revision };
  s.photos = cat.photos.map(photo => ({ id: photo.id, url: photo.url, name: photo.name,
    width: photo.width, height: photo.height }));
  s.traits = cat.traits || manualTraits();
  s.source = cat.traits ? 'ai' : 'manual';
  s.sourceNote = cat.traits ? '' : 'AI analysis is not active. Review and confirm the profile yourself.';
  s.max = 2;
  s.design = defaultDesign(s.traits);
  s.aiConfigured = Boolean(capability.aiConfigured);
  s.paidRequestsEnabled = Boolean(capability.paidRequestsEnabled);
  return s;
}

export function generationFingerprint(s, mode = s.direction) {
  return generationInputKey({ catId: s.cat?.id, revision: s.cat?.revision, traits: s.traits || {}, mode,
    personality: { name: s.name, habits: s.habits, favoriteToy: s.favToy, note: s.note } });
}

export function serializeState(s) {
  const keys = ['schemaVersion', 'step', 'max', 'name', 'photos', 'cat', 'traits', 'profileConfirmed',
    'source', 'sourceNote', 'habits', 'favToy', 'note', 'generations', 'designs', 'direction', 'design', 'view'];
  return JSON.parse(JSON.stringify(Object.fromEntries(keys.map(key => [key, s[key]]))));
}

function validGeneration(g, cat) {
  return g && g.catId === cat.id && g.revision === cat.revision && MODES.includes(g.mode)
    && isAssetUrl(g.character?.url) && isAssetUrl(g.texture?.url)
    && Array.isArray(g.charms) && g.charms.every(charm => isAssetUrl(charm.asset?.url));
}

export function restoreState(saved, cat, capability = {}) {
  if (!cat?.id || !cat.photos?.length || !cat.photos.every(photo => isAssetUrl(photo.url))) {
    return { ...initialState(), ...capability };
  }
  const base = stateForCat(cat, capability);
  if (saved?.schemaVersion !== 1 || saved?.cat?.id !== cat.id || saved.cat.revision !== cat.revision) return base;
  const s = { ...base, ...serializeState({ ...base, ...saved }), ...capability };
  // Runtime permissions, operation state and photo ownership come from the server, never saved UI data.
  s.cat = base.cat;
  s.photos = base.photos;
  s.direction = MODES.includes(s.direction) ? s.direction : 'real';
  s.name = String(s.name || '').slice(0, 60);
  s.favToy = String(s.favToy || '').slice(0, 60);
  s.note = String(s.note || '').slice(0, 600);
  s.habits = Array.isArray(s.habits) ? s.habits.filter(x => typeof x === 'string').slice(0, 8) : [];
  s.step = Math.max(1, Math.min(6, Number(s.step) || 1));
  s.max = Math.max(2, Math.min(6, Number(s.max) || 2));
  s.step = Math.min(s.step, s.max);
  s.generations = Object.fromEntries(MODES.map(mode => [mode,
    validGeneration(s.generations?.[mode], cat) ? s.generations[mode] : null]));
  s.designs = Object.fromEntries(MODES.map(mode => {
    const generation = s.generations[mode];
    const design = { ...defaultDesign(s.traits, mode, generation), ...(s.designs?.[mode] || {}) };
    const ids = new Set(generation?.charms.map(charm => charm.id) || []);
    design.charms = Array.isArray(design.charms) ? design.charms.filter(id => ids.has(id)) : [];
    design.scale = Math.max(0.5, Math.min(2, Number(design.scale) || 1));
    design.direction = mode;
    return [mode, design];
  }));
  s.design = s.designs[s.direction];
  s.view = ['side', 'top', 'back', 'bottom', 'detail'].includes(s.view) ? s.view : 'side';
  return s;
}
