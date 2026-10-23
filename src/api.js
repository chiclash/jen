/** Local prototype adapter. Every operation runs in this browser; there is no API transport. */
import { readLocal, updateLocal, storageWarning } from './local-store.js';
import { localPhoto, estimateProfile, materialPreview, photoKeepsake, toyPreview } from './demo-art.js';
import { generationInputKey } from './identity.js';
export class ApiError extends Error {
  constructor(message, { code = 'DEMO_ERROR', status = 0 } = {}) { super(message); this.code = code; this.status = status; }
}
const jobs = new Map();
const clone = value => structuredClone(value);
const capability = { demo: true, aiConfigured: false, paidRequestsEnabled: false };
const checkSignal = signal => { if (signal?.aborted) throw new ApiError('Prototype action cancelled.', { code: 'CANCELLED' }); };
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    checkSignal(signal); const timer = setTimeout(done, ms);
    function done() { signal?.removeEventListener('abort', abort); resolve(); }
    function abort() { clearTimeout(timer); reject(new ApiError('Prototype action cancelled.', { code: 'CANCELLED' })); }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
function cancelAll() { for (const job of jobs.values()) if (['queued', 'running'].includes(job.status)) { job.controller.abort(); job.status = 'cancelled'; } }
function currentCat(record, id, revision) {
  if (!record.cat || record.cat.id !== id || (revision !== undefined && record.cat.revision !== revision)) {
    throw new ApiError('These are photos from an earlier cat. Please use your current photos.', { code: 'STALE_CAT' });
  }
  return record.cat;
}
function publicJob(job) { const { controller, ...view } = job; return clone(view); }
export const api = {
  async health() { return { ok: true, ...capability }; },
  async session() {
    const record = await readLocal();
    return { ...capability, state: record.state, cat: record.cat, generations: Object.values(record.generations),
      activeJob: null, lastJob: null, storageWarning: storageWarning() };
  },
  async saveSession(state) {
    await updateLocal(record => {
      if (state.cat) currentCat(record, state.cat.id, state.cat.revision);
      else if (record.cat) throw new ApiError('Save the current cat, rather than an earlier empty state.', { code: 'STALE_CAT' });
      record.state = clone(state);
    });
    if (storageWarning()) throw new ApiError(storageWarning(), { code: 'LOCAL_SAVE_UNAVAILABLE' });
    return { saved: true, local: true };
  },
  async clearSession() {
    cancelAll(); await updateLocal(record => { record.cat = null; record.state = null; record.generations = {}; record.variation = {}; record.identity = null; record.identitySignature = null; });
    return { cleared: true };
  },
  async uploadCat(files, { signal } = {}) {
    const list = Array.from(files || []);
    if (!list.length || list.length > 3) throw new ApiError('Choose one to three photos.', { code: 'INVALID_PHOTOS' });
    const photos = [];
    for (const file of list) { checkSignal(signal); photos.push(await localPhoto(file)); }
    checkSignal(signal); cancelAll();
    const cat = { id: crypto.randomUUID(), revision: 1, photos, traits: null };
    await updateLocal(record => { checkSignal(signal); record.cat = cat; record.state = null; record.generations = {}; record.variation = {}; record.identity = null; record.identitySignature = null; });
    return clone(cat);
  },
  async analyzeCat(id, { signal } = {}) {
    const record = await readLocal(), cat = currentCat(record, id);
    await pause(350, signal); const traits = await estimateProfile(cat.photos); checkSignal(signal);
    await updateLocal(current => { currentCat(current, id).traits = traits; });
    return { catId: id, revision: cat.revision, traits, simulated: true };
  },
  async startGeneration(request, { signal } = {}) {
    checkSignal(signal); const record = await readLocal(), cat = currentCat(record, request.catId, request.revision);
    if (!['real', 'art'].includes(request.mode)) throw new ApiError('Choose a demo design direction.');
    if (!request.traits?.colors?.main) throw new ApiError('Confirm your cat profile before simulating the design.');
    cancelAll();
    const job = { id: crypto.randomUUID(), catId: cat.id, revision: cat.revision, mode: request.mode,
      inputFingerprint: generationInputKey(request), status: 'queued', simulated: true,
      progress: { completed: 0, total: request.regenerateCharmId ? 1 : 6, label: 'Starting browser-only design demonstration' },
      controller: new AbortController() };
    jobs.set(job.id, job);
    // This is a local interaction animation and canvas processing, not an AI request.
    runDemo(job, clone(request)).catch(error => {
      job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
      job.error = { code: error.code || 'DEMO_FAILED', message: error.message || 'The demo could not create its local preview.' };
    });
    if (jobs.size > 20) for (const [id, old] of jobs) if (!['queued', 'running'].includes(old.status) && jobs.size > 12) jobs.delete(id);
    return { jobId: job.id };
  },
  async job(id) { const job = jobs.get(id); if (!job) throw new ApiError('The browser demo was interrupted. Run the simulation again.', { code: 'DEMO_INTERRUPTED' }); return publicJob(job); },
  async cancelJob(id) { const job = jobs.get(id); if (job) { job.controller.abort(); job.status = 'cancelled'; return publicJob(job); } return { status: 'cancelled' }; },
};
async function runDemo(job, request) {
  job.status = 'running'; const signal = job.controller.signal;
  const record = await readLocal(), cat = currentCat(record, job.catId, job.revision);
  const old = record.generations[job.mode];
  const variation = (record.variation[job.mode] || 0) + 1;
  const step = async (label, make) => {
    checkSignal(signal); currentCat(await readLocal(), job.catId, job.revision);
    job.progress.label = `${label} · prototype simulation`;
    await pause(120, signal); const value = await make(); checkSignal(signal);
    job.progress.completed++; return value;
  };
  const personality = request.personality || {}, name = personality.name || 'Your cat';
  const signature = JSON.stringify([cat.id, request.traits]);
  const character = await step('Preparing your uploaded photo reference', async () => record.identitySignature === signature
    ? record.identity : photoKeepsake(cat.photos[0], request.traits, 'real', 'face', 0));
  const makeCharm = async (kind, previous) => {
    const id = previous?.id || crypto.randomUUID();
    if (kind === 'toy') {
      const result = await step('Selecting original favorite-object artwork', () => toyPreview(personality, job.mode));
      return { id, kind, title: result.label + ' · demo accessory', why: result.why, material: 'Original accessory artwork · prototype', asset: result.asset, simulated: true };
    }
    const photo = cat.photos[kind === 'body' && cat.photos.length > 1 ? 1 : 0];
    const asset = await step('Composing a photo keepsake', () => photoKeepsake(photo, request.traits, job.mode, kind, variation));
    const titles = { face: 'photo portrait', body: 'personality photo keepsake', sleep: 'sleepy photo keepsake' };
    return { id, kind, title: `${name} · ${titles[kind]}`, why: kind === 'sleep' ? 'Your photo with the original moon artwork; no sleeping pose was generated.' : 'Your uploaded photo inside a locally drawn keepsake frame. This is a simulated Jibbitz concept.', material: job.mode === 'real' ? 'Photo keepsake · cream frame' : 'Photo keepsake · artistic frame', asset, simulated: true };
  };
  let result;
  if (request.regenerateCharmId) {
    const previous = old?.charms.find(charm => charm.id === request.regenerateCharmId);
    if (!previous) throw new ApiError('This demo charm is no longer available. Simulate the direction again.');
    job.progress.completed = 0; job.progress.total = 1;
    const replacement = await makeCharm(previous.kind, previous);
    result = { ...old, id: crypto.randomUUID(), charms: old.charms.map(charm => charm.id === previous.id ? replacement : charm) };
  } else {
    const texture = await step('Drawing a material swatch from the confirmed colors', () => materialPreview(request.traits, job.mode, variation));
    const charms = [];
    for (const kind of ['face', 'body', 'sleep', 'toy']) charms.push(await makeCharm(kind));
    result = { id: crypto.randomUUID(), catId: cat.id, revision: cat.revision, mode: job.mode,
      character, texture, charms, model: 'Browser-only UX prototype (no AI)', simulated: true };
  }
  result.createdAt = new Date().toISOString(); result.inputFingerprint = generationInputKey(request);
  checkSignal(signal);
  await updateLocal(current => { checkSignal(signal); currentCat(current, cat.id, cat.revision).traits = request.traits;
    current.generations[job.mode] = result; current.variation[job.mode] = variation;
    current.identity = character; current.identitySignature = signature; });
  job.result = result; job.status = 'complete'; job.progress.completed = job.progress.total; job.progress.label = 'Prototype preview ready · no AI service used';
}
export async function pollGeneration(id, { signal, onProgress } = {}) {
  try {
    while (true) {
      checkSignal(signal); const job = await api.job(id); onProgress?.(job);
      if (job.status === 'complete') return job.result;
      if (job.status === 'failed' || job.status === 'cancelled') throw new ApiError(job.error?.message || 'Prototype action cancelled.', { code: job.error?.code || 'CANCELLED' });
      await pause(100, signal);
    }
  } catch (error) { if (signal?.aborted) await api.cancelJob(id); throw error; }
}
export function downloadFile({ filename, data, type = 'application/octet-stream' }) {
  const url = URL.createObjectURL(new Blob([data], { type })), a = document.createElement('a');
  a.href = url; a.download = filename.replace(/[\\/\u0000-\u001f]/g, '_'); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
