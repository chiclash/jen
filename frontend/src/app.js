import { api, pollGeneration, downloadFile, ApiError } from './api.js';
import { renderPersonalizedShoe } from './rendering.js';
import { renderPanel, escapeHtml as esc, STEPS, EYES } from './ui.js';
import { initialState, stateForCat, restoreState, serializeState, defaultDesign, generationFingerprint } from './state.js';

const $ = selector => document.querySelector(selector);
const panel = $('#panel'), stage = $('#canvas');
let S = initialState();
let epoch = 0, renderToken = 0, taskController = null, activeJob = null;
let saveTimer = null, saveChain = Promise.resolve(), ready = false;
const activeGeneration = () => S.generations[S.direction];
const capabilities = () => ({ aiConfigured: S.aiConfigured, paidRequestsEnabled: S.paidRequestsEnabled });

function publicError(error) {
  return { code: error?.code || 'UNEXPECTED_ERROR', message: error?.message || 'Something went wrong. Please try again.' };
}
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}
function syncDesign() { S.designs[S.direction] = structuredClone(S.design); }
function snapshot() { syncDesign(); return serializeState(S); }

function saveNow() {
  clearTimeout(saveTimer);
  if (!ready) return saveChain;
  const state = snapshot(), token = epoch;
  saveChain = saveChain.catch(() => {}).then(async () => {
    if (token !== epoch) return;
    try {
      await api.saveSession(state);
      if (token === epoch) { S.savedAt = new Date().toISOString(); S.persistenceError = null; updateSaveStatus(); }
    } catch (error) {
      if (token === epoch) { S.persistenceError = error.message; updateSaveStatus(); toast('Your changes could not be saved. Keep this tab open and retry.'); }
    }
  });
  return saveChain;
}
function scheduleSave() { if (ready) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); } }
function updateSaveStatus() {
  const target = document.getElementById('saveStatus');
  if (target) {
    target.className = `note ${S.persistenceError ? 'est' : 'ai'}`;
    target.innerHTML = S.persistenceError
      ? `<b>Changes could not be saved</b>${esc(S.persistenceError)} <button type="button" class="textbtn" data-action="retry-save">Retry saving</button>`
      : '<b>Design saved</b>Your photos, artwork and customization are saved for this browser session.';
  }
}

function invalidateArtwork() {
  // Keep outputs on disk, but never present images from an earlier profile as the current identity.
  S.generations = { real: null, art: null }; S.designs = { real: null, art: null };
  S.design = defaultDesign(S.traits || undefined, S.direction);
}
function profileChanged() {
  S.profileConfirmed = false; S.max = 2; invalidateArtwork();
  const confirm = panel.querySelector('[data-action="confirm-profile"]');
  if (confirm) confirm.textContent = 'Confirm this profile';
}
function guardAI() {
  if (!S.paidRequestsEnabled) throw new ApiError(
    'Paid AI requests are disabled. No request was sent. A USD cost estimate and your explicit approval are required before activation.',
    { code: 'AI_PAID_DISABLED', status: 403 });
  if (!S.aiConfigured) throw new ApiError('The server has no image-service API key configured.',
    { code: 'AI_NOT_CONFIGURED', status: 503 });
}
function cancelTask() {
  epoch++; taskController?.abort(); taskController = null;
  if (activeJob) api.cancelJob(activeJob).catch(() => {});
  activeJob = null; S.busy = false; S.operation = null; S.progress = null;
}
async function task(label, operation) {
  if (S.busy) return;
  const token = ++epoch;
  taskController = new AbortController(); const signal = taskController.signal;
  S.busy = true; S.operation = label; S.error = null; draw();
  try { await operation({ signal, token, current: () => token === epoch }); }
  catch (error) {
    if (token === epoch && error.code !== 'CANCELLED' && error.code !== 'AI_CANCELLED') S.error = publicError(error);
  } finally {
    if (token === epoch) { S.busy = false; S.operation = null; S.progress = null; taskController = null; activeJob = null; draw(); scheduleSave(); }
  }
}

async function upload(files, { replace = false, sample = false } = {}) {
  const incoming = Array.from(files || []);
  if (!incoming.length) return;
  if (incoming.length > 3 || (!replace && S.photos.length + incoming.length > 3)) {
    toast('Use up to three photos. Remove a photo before adding another.'); return;
  }
  cancelTask(); await saveNow();
  await task('Saving cat photos', async ({ signal, current }) => {
    const existing = [];
    if (!replace) for (const photo of S.photos) {
      const response = await fetch(photo.url, { signal });
      if (!response.ok) throw new Error('A previous photo could not be read. Upload the photos again.');
      existing.push({ blob: await response.blob(), name: photo.name });
    }
    const cat = await api.uploadCat([...existing, ...incoming], { signal });
    if (!current()) return;
    const cap = capabilities(); S = stateForCat(cat, cap); S.busy = true; S.operation = 'Saving cat photos';
    if (sample) S.name = 'Charcoal';
    toast('Photos saved. Review your cat’s profile next.');
  });
}
async function removePhoto(id) {
  const remaining = S.photos.filter(photo => photo.id !== id);
  if (!remaining.length) return restart();
  const files = [];
  for (const photo of remaining) {
    const response = await fetch(photo.url); files.push({ blob: await response.blob(), name: photo.name });
  }
  return upload(files, { replace: true });
}
async function loadSample() {
  try {
    const files = [];
    for (const name of ['cat-portrait.webp', 'cat-toy.webp', 'cat-jacket.webp']) {
      const response = await fetch(`/a/${name}`);
      if (!response.ok) throw new Error('The sample photos could not be loaded.');
      files.push({ blob: await response.blob(), name });
    }
    await upload(files, { replace: true, sample: true });
  } catch (error) { S.error = publicError(error); draw(); }
}
async function analyze() {
  try { guardAI(); } catch (error) { S.error = publicError(error); draw(); return; }
  if (!S.cat) return;
  const catId = S.cat.id;
  await task('Analyzing cat photos', async ({ signal, current }) => {
    const result = await api.analyzeCat(catId, { signal });
    if (!current() || S.cat.id !== catId) return;
    S.traits = result.traits; S.source = 'ai'; S.sourceNote = result.traits.summary;
    S.profileConfirmed = false; invalidateArtwork();
  });
}
function applyGeneration(result, regenerateCharmId) {
  const mode = result.mode;
  if (result.catId !== S.cat?.id || result.revision !== S.cat.revision
    || result.inputFingerprint !== generationFingerprint(S, mode)) return false;
  const oldGeneration = S.generations[mode], oldDesign = S.designs[mode] || S.design;
  S.generations[mode] = result;
  let design;
  if (regenerateCharmId && oldGeneration) {
    const newIds = result.charms.map(charm => charm.id), oldIds = new Set(oldGeneration.charms.map(charm => charm.id));
    const replacement = newIds.find(id => !oldIds.has(id)) || regenerateCharmId;
    design = { ...oldDesign, charms: oldDesign.charms.map(id => id === regenerateCharmId ? replacement : id) };
  } else design = defaultDesign(S.traits, mode, result);
  design.accent = (EYES[S.traits.eye] || EYES.gold)[1];
  S.designs[mode] = design;
  if (S.direction === mode) S.design = design;
  return true;
}
async function generate(regenerateCharmId) {
  try { guardAI(); } catch (error) { S.error = publicError(error); draw(); return; }
  if (!S.cat || !S.profileConfirmed) { toast('Confirm your cat’s profile first.'); return; }
  const catId = S.cat.id, mode = S.direction, fingerprint = generationFingerprint(S);
  await task(regenerateCharmId ? 'Regenerating one Jibbitz' : 'Generating personalized artwork', async ({ signal, current }) => {
    const { jobId } = await api.startGeneration({ catId, revision: S.cat.revision, mode,
      traits: S.traits, personality: { name: S.name, habits: S.habits, favoriteToy: S.favToy, note: S.note },
      ...(regenerateCharmId ? { regenerateCharmId } : {}) }, { signal });
    activeJob = jobId;
    const result = await pollGeneration(jobId, { signal, onProgress(job) {
      if (!current()) return;
      S.progress = job.progress; drawPanel();
    } });
    if (!current() || S.cat?.id !== catId || generationFingerprint(S, mode) !== fingerprint) return;
    if (applyGeneration(result, regenerateCharmId)) toast('Personalized images generated and saved.');
  });
}
async function restart() {
  cancelTask(); clearTimeout(saveTimer); await saveChain.catch(() => {});
  try { await api.clearSession(); S = { ...initialState(), ...capabilities() }; draw(); }
  catch (error) { S.error = publicError(error); draw(); }
}

function drawPanel() {
  panel.innerHTML = renderPanel(S);
  if (S.busy && !panel.querySelector('[data-action="cancel"]')) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'textbtn';
    button.dataset.action = 'cancel'; button.textContent = 'Cancel'; panel.appendChild(button);
  }
}
function drawNav() {
  $('#steps').innerHTML = STEPS.map((label, i) => {
    const step = i + 1;
    return `<li><button type="button" data-step="${step}" ${step > S.max || S.busy ? 'disabled' : ''} ${step === S.step ? 'aria-current="step"' : ''}><span class="dot">${step}</span><span class="lbl">${label}</span></button></li>`;
  }).join('');
  $('#trackFill').style.width = `${(S.step - 1) / 5 * 100}%`;
  $('#prevBtn').disabled = S.step === 1 || S.busy;
  $('#nextBtn').hidden = S.step === 6;
  $('#nextBtn').disabled = S.busy || (S.step === 1 && !S.photos.length) || (S.step === 2 && !S.profileConfirmed);
  $('#nextBtn').textContent = S.step === 4 && !activeGeneration() ? 'Continue with footwear preview' : S.step === 5 ? 'Review design' : 'Next';
}
async function drawStage() {
  const token = ++renderToken, generation = activeGeneration();
  const isProfile = (S.step === 2 || S.step === 3) && S.photos.length;
  $('#clogRow').hidden = true; // The original cream clog base stays protected.
  $('#viewSeg').hidden = Boolean(isProfile);
  $('#viewSeg').querySelectorAll('[data-view]').forEach(button => {
    button.hidden = false; button.setAttribute('aria-pressed', String(button.dataset.view === S.view));
  });
  $('#stageThumbs').innerHTML = S.photos.map(photo => `<img src="${esc(photo.url)}" alt="${esc(photo.name || 'Uploaded cat photo')}">`).join('');
  if (isProfile) {
    const character = generation?.character?.url;
    stage.innerHTML = `<div class="pf fade"><img class="pf-photo" src="${esc(S.photos[0].url)}" alt="Your uploaded cat"><div class="pf-side">${character ? `<img src="${esc(character)}" alt="Generated character of your cat">` : '<p class="pf-note">Your original photo.<br>No AI character has been generated yet.</p>'}</div></div>`;
    $('#stageBadge').textContent = character ? 'Your photo + generated identity' : 'Your uploaded cat · no preset character';
    $('#caption').textContent = S.source === 'ai' ? 'Photo analysis completed. Review the individual details before generation.' : 'Manual profile · AI analysis has not been performed.';
    updateMini(); return;
  }
  $('#stageBadge').textContent = generation ? 'Personalized artwork · original footwear' : 'Original footwear · no AI artwork generated';
  $('#caption').textContent = S.view === 'bottom' ? 'Original paw-shaped outsole. The base and outsole are unchanged.' :
    generation ? `${S.name || 'Your cat'} · ${S.direction === 'real' ? 'Realistic Fur' : 'Artistic Interpretation'} · generated materials and Jibbitz on the original shoe.` :
      'Footwear preview only. Neutral fabric shows the removable parts; it is not an AI result.';
  try {
    const design = S.step === 1 ? { ...S.design, upperOn: false, strapOn: false, charms: [] } : S.design;
    const canvas = await renderPersonalizedShoe({ view: S.view, design, generation: S.step === 1 ? null : generation });
    if (token !== renderToken) return;
    stage.replaceChildren(canvas); updateMini();
  } catch (error) {
    if (token !== renderToken) return;
    stage.innerHTML = '<div class="busy"><span>The footwear preview could not be loaded. Try another view.</span></div>';
    console.error('Footwear rendering failed:', error.message);
  }
}
function draw() { drawPanel(); drawNav(); drawStage(); }
function go(step) {
  if (S.busy || step < 1 || step > 6 || step > S.max || (step > 2 && !S.profileConfirmed)) return;
  S.step = step; S.error = null; draw(); scheduleSave();
  const heading = panel.querySelector('h3');
  if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  if (innerWidth < 960) $('#customize').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function next() {
  if (S.busy || (S.step === 1 && !S.photos.length) || (S.step === 2 && !S.profileConfirmed)) return;
  S.max = Math.max(S.max, Math.min(6, S.step + 1)); go(Math.min(6, S.step + 1));
}
function switchMode(mode) {
  if (!['real', 'art'].includes(mode) || S.busy || S.direction === mode) return;
  syncDesign(); S.direction = mode;
  S.design = S.designs[mode] || defaultDesign(S.traits || undefined, mode, S.generations[mode]);
  draw(); scheduleSave();
}

async function dataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('A saved image could not be exported.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
}
async function exportJson() {
  try {
    await saveNow(); const state = snapshot(); const assets = new Map(S.photos.map(photo => [photo.id, photo]));
    for (const generation of Object.values(S.generations).filter(Boolean)) {
      for (const asset of [generation.character, generation.texture, ...generation.charms.map(charm => charm.asset)]) assets.set(asset.id, asset);
    }
    const embeddedAssets = {};
    for (const [id, asset] of assets) embeddedAssets[id] = { ...asset, dataUrl: await dataUrl(asset.url) };
    downloadFile({ filename: `${S.name || 'cat'}-pair-design.json`, type: 'application/json',
      data: JSON.stringify({ exportedAt: new Date().toISOString(), state, embeddedAssets,
        note: activeGeneration() ? 'Personalized artwork and original footwear preview.' : 'Manual footwear design. No AI artwork generated.' }, null, 2) });
  } catch (error) { S.error = publicError(error); drawPanel(); }
}
async function exportHtml() {
  try {
    const views = [];
    for (const view of ['side', 'top', 'back', 'bottom']) {
      const canvas = await renderPersonalizedShoe({ view, design: S.design, generation: activeGeneration() });
      views.push(`<figure><img src="${canvas.toDataURL('image/png')}" alt="${view} view"><figcaption>${view}</figcaption></figure>`);
    }
    const catPhoto = S.photos[0] ? `<img class="cat" src="${await dataUrl(S.photos[0].url)}" alt="Your cat">` : '';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(S.name || 'Your cat')} · pair spec</title><style>body{background:#F7F3EB;color:#2F2D2C;font:16px/1.6 Georgia,serif;max-width:1000px;margin:40px auto;padding:20px}section{display:grid;grid-template-columns:1fr 1fr}img{max-width:100%}.cat{max-width:180px}figcaption{text-transform:capitalize}</style></head><body><p>CHARCOAL × Crocs · Concept prototype</p><h1>${esc(S.name || 'Your cat')}’s pair</h1><p>${activeGeneration() ? 'Personalized AI artwork on the original footwear.' : 'Manual footwear preview. No AI artwork has been generated.'}</p>${catPhoto}<p>${esc(S.traits?.summary || '')}</p><p>Direction: ${S.direction === 'real' ? 'Realistic Fur' : 'Artistic Interpretation'} · Cream clog and paw-shaped outsole preserved.</p><p>Plush upper: ${S.design.upperOn ? 'on' : 'off'} · Removable strap cover: ${S.design.strapOn ? 'on' : 'off'}</p><section>${views.join('')}</section><p>Design preview only. No production request has been sent.</p></body></html>`;
    downloadFile({ filename: `${S.name || 'cat'}-pair-spec.html`, data: html, type: 'text/html' });
  } catch (error) { S.error = publicError(error); drawPanel(); }
}

panel.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  const d = button.dataset, action = d.action;
  if (action === 'cancel') { cancelTask(); S.error = { code: 'CANCELLED', message: 'Operation cancelled. No successful generation has been assumed.' }; draw(); return; }
  if (action === 'sample') return loadSample();
  if (d.removePhoto) return removePhoto(d.removePhoto).catch(error => { S.error = publicError(error); draw(); });
  if (S.busy) return;
  if (action === 'analyze') return analyze();
  if (action === 'confirm-profile') { S.profileConfirmed = true; S.max = Math.max(S.max, 3); draw(); scheduleSave(); return; }
  if (action === 'generate') return generate();
  if (d.mode) return switchMode(d.mode);
  if (action === 'upper-toggle' || d.toggleUpper !== undefined) S.design.upperOn = !S.design.upperOn;
  else if (action === 'strap-toggle' || d.toggleStrap !== undefined) S.design.strapOn = !S.design.strapOn;
  else if (d.habit) {
    S.habits = S.habits.includes(d.habit) ? S.habits.filter(h => h !== d.habit) : [...S.habits, d.habit]; invalidateArtwork();
  } else if (d.removeCharm) S.design.charms = S.design.charms.filter(id => id !== d.removeCharm);
  else if (d.up !== undefined || d.down !== undefined) {
    const i = Number(d.up ?? d.down), j = i + (d.up !== undefined ? -1 : 1);
    if (j >= 0 && j < S.design.charms.length) [S.design.charms[i], S.design.charms[j]] = [S.design.charms[j], S.design.charms[i]];
  } else if (d.regenerateCharm) return generate(d.regenerateCharm);
  else if (action === 'restore-charms') S.design.charms = activeGeneration()?.charms.map(charm => charm.id) || [];
  else if (action === 'download-json') return exportJson();
  else if (action === 'download-html') return exportHtml();
  else if (action === 'restart') return restart();
  else if (action === 'retry-save') { await saveNow(); drawPanel(); return; }
  else return;
  syncDesign(); draw(); scheduleSave();
});
panel.addEventListener('change', event => {
  const el = event.target;
  if (el.id === 'fileIn') { upload(el.files).catch(error => { S.error = publicError(error); draw(); }); return; }
  if (S.busy) return;
  if (el.dataset.trait) { S.traits[el.dataset.trait] = el.value; profileChanged(); }
  else if (el.dataset.marking) { S.traits.markings[el.dataset.marking] = el.checked; profileChanged(); }
  else if (el.id === 'strapStyle') S.design.strapStyle = el.value;
  else return;
  syncDesign(); draw(); scheduleSave();
});
panel.addEventListener('input', event => {
  const el = event.target; if (S.busy) return;
  if (el.id === 'catName') { S.name = el.value.slice(0, 60); invalidateArtwork(); }
  else if (el.id === 'favToy') { S.favToy = el.value.slice(0, 60); invalidateArtwork(); }
  else if (el.id === 'catNote') { S.note = el.value.slice(0, 600); invalidateArtwork(); }
  else if (el.id === 'distinctive') { S.traits.distinctive = el.value.split('\n').map(x => x.trim().slice(0, 160)).filter(Boolean).slice(0, 4); profileChanged(); }
  else if (el.dataset.traitColor) { S.traits.colors[el.dataset.traitColor] = el.value; profileChanged(); }
  else if (el.id === 'scaleIn') S.design.scale = Number(el.value);
  else return;
  syncDesign(); drawNav(); drawStage(); scheduleSave();
});
// Dropzone is recreated with each panel; delegated listeners survive rerenders.
panel.addEventListener('dragover', event => { if (event.target.closest('#drop')) event.preventDefault(); });
panel.addEventListener('drop', event => {
  if (!event.target.closest('#drop')) return;
  event.preventDefault(); upload(event.dataTransfer.files).catch(error => { S.error = publicError(error); draw(); });
});
$('#nextBtn').addEventListener('click', next);
$('#prevBtn').addEventListener('click', () => go(S.step - 1));
$('#steps').addEventListener('click', event => { const button = event.target.closest('[data-step]'); if (button) go(Number(button.dataset.step)); });
$('#viewSeg').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (button) { S.view = button.dataset.view; drawStage(); scheduleSave(); } });

// Keep the original editorial family section. These are clearly labelled portfolio examples,
// never used as personalization results or image-generation fallbacks.
$('#family').innerHTML = [
  ['Charcoal', 'Gray British Shorthair', 'gray'], ['Mochi', 'Calico', 'calico'],
  ['Ginger', 'Orange tabby', 'tabby'], ['Oreo', 'Tuxedo', 'tuxedo'],
].map(([name, description, family]) => `<div class="fam"><div class="famc"><img src="/a/f-${family}.webp" alt="${description} · original concept example"></div><div class="fmeta"><span><b>${name}</b><small>${description} · portfolio reference</small></span></div></div>`).join('');

// Preserve the original mobile mini-preview using the same rendered pixels.
let miniDismissed = false, stageVisible = true;
function updateMini() {
  const mini = $('#mini'), source = stage.querySelector('canvas');
  const show = innerWidth < 960 && S.step >= 4 && !stageVisible && !miniDismissed;
  mini.hidden = !show; $('#miniPill').hidden = !(innerWidth < 960 && S.step >= 4 && !stageVisible && miniDismissed);
  const target = $('#miniC'); target.replaceChildren();
  if (show && source) { const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height;
    copy.getContext('2d').drawImage(source, 0, 0); target.appendChild(copy); }
}
$('#miniX').addEventListener('click', () => { miniDismissed = true; updateMini(); });
$('#miniPill').addEventListener('click', () => { miniDismissed = false; updateMini(); });
$('#miniC').addEventListener('click', () => $('#customize').scrollIntoView({ behavior: 'smooth' }));
addEventListener('resize', updateMini);
new IntersectionObserver(entries => {
  stageVisible = entries[0].isIntersecting && entries[0].intersectionRatio > 0.15;
  updateMini();
}, { threshold: [0, 0.15, 0.5] }).observe(document.querySelector('.stage'));
addEventListener('pagehide', () => {
  if (ready) fetch('/api/session', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify({ state: snapshot() }), keepalive: true }).catch(() => {});
});

async function boot() {
  draw();
  try {
    const result = await api.session();
    S = restoreState(result.state, result.cat, { aiConfigured: Boolean(result.aiConfigured), paidRequestsEnabled: Boolean(result.paidRequestsEnabled) });
    // Authoritative completed jobs can recover results whose UI save was interrupted.
    for (const generation of result.generations || []) {
      if (!S.generations[generation.mode] && generation.catId === S.cat?.id && generation.revision === S.cat.revision
        && generation.inputFingerprint === generationFingerprint(S, generation.mode)) {
        S.generations[generation.mode] = generation;
        S.designs[generation.mode] = defaultDesign(S.traits, generation.mode, generation);
      }
    }
    S.design = S.designs[S.direction] || S.design;
    ready = true; draw();
    const pending = result.activeJob;
    if (pending && pending.catId === S.cat?.id && pending.revision === S.cat.revision
      && pending.inputFingerprint === generationFingerprint(S, pending.mode)) {
      // Reconnect to an existing job only. Reloading never creates a new paid request.
      await task('Restoring the existing generation', async ({ signal, current }) => {
        activeJob = pending.id;
        const generation = await pollGeneration(pending.id, { signal, onProgress(job) {
          if (current()) { S.progress = job.progress; drawPanel(); }
        } });
        if (current()) applyGeneration(generation);
      });
    } else if (pending) {
      await api.cancelJob(pending.id).catch(() => {});
      S.error = { code: 'STALE_GENERATION', message: 'A generation for earlier inputs was stopped. The current design has not been replaced.' }; draw();
    } else if (result.lastJob?.status === 'failed') {
      S.error = result.lastJob.error; drawPanel();
    }
  } catch (error) { S.error = publicError(error); draw(); }
}
boot();
