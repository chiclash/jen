import { createHash, randomUUID } from 'node:crypto';
import { AppError, publicError } from './errors.js';
import { activeCat, validatePersonality, validateTraits } from './validation.js';
import { generationInputKey } from '../frontend/src/identity.js';

const labels = { identity: 'Generating your cat identity reference', texture: 'Generating the personalized fur material', face: 'Generating the face Jibbitz', body: 'Generating the personality pose Jibbitz', sleep: 'Generating the sleeping Jibbitz', toy: 'Generating the favorite toy Jibbitz' };
export class Jobs {
  constructor(store, provider) {
    this.store = store;
    this.provider = provider;
    this.running = new Map();
  }

  async start(sessionId, request) {
    const session = await this.store.settled(sessionId);
    const cat = activeCat(session, request.catId, request.revision);
    if (!['real', 'art'].includes(request.mode)) throw new AppError('INVALID_MODE', 'Choose Realistic Fur or Artistic Interpretation.', 422);
    const traits = validateTraits(request.traits);
    const personality = validatePersonality(request.personality);
    const inFlight = [...this.running.values()].find(j => j.sessionId === sessionId && ['queued', 'running'].includes(j.status));
    if (inFlight) throw new AppError('GENERATION_IN_PROGRESS', 'A generation is already running. Finish or cancel it before starting another.', 409);
    const previous = session.generations[`${cat.id}:${request.mode}`];
    if (request.regenerateCharmId && !previous?.charms.some(c => c.id === request.regenerateCharmId)) throw new AppError('CHARM_NOT_FOUND', 'The charm to regenerate no longer exists.', 404);
    const signature = createHash('sha256').update(JSON.stringify({ cat: cat.id, revision: cat.revision, traits })).digest('hex');
    const inputFingerprint = generationInputKey({ catId: cat.id, revision: cat.revision, traits, personality, mode: request.mode });
    if (request.regenerateCharmId && previous.profileSignature !== signature) throw new AppError('PROFILE_CHANGED', 'The cat profile has changed. Generate this mode again before regenerating a single charm.', 409);
    if (request.regenerateCharmId && previous.inputFingerprint !== inputFingerprint) throw new AppError('PROFILE_CHANGED', 'The personalization settings have changed. Generate this mode again before regenerating a single charm.', 409);
    const job = { id: randomUUID(), sessionId, catId: cat.id, revision: cat.revision, mode: request.mode, inputFingerprint, status: 'queued', progress: { completed: 0, total: request.regenerateCharmId ? 1 : (session.identities[signature] ? 5 : 6), label: 'Waiting to start generation' }, createdAt: new Date().toISOString() };
    job.controller = new AbortController();
    this.running.set(job.id, job);
    try {
      await this.store.update(sessionId, current => {
        activeCat(current, cat.id, cat.revision).traits = traits;
        current.jobs[job.id] = this.public(job);
      });
    } catch (error) { this.running.delete(job.id); throw error; }
    // Return the queued response before generation starts. All successful output comes from the provider.
    setImmediate(() => this.run(job, { traits, personality, signature, inputFingerprint, previous, regenerateCharmId: request.regenerateCharmId }).catch(async error => {
      if (job.status !== 'cancelled') { job.status = 'failed'; job.error = publicError(error); await this.persist(job).catch(() => {}); }
    }).finally(() => this.running.delete(job.id)));
    return { jobId: job.id };
  }

  public(job) {
    const { sessionId, controller, ...view } = job;
    return structuredClone(view);
  }

  async persist(job) {
    const view = this.public(job);
    await this.store.update(job.sessionId, session => { session.jobs[job.id] = view; });
  }

  async get(sessionId, id) {
    const local = this.running.get(id);
    if (local?.sessionId === sessionId) return this.public(local);
    const session = await this.store.settled(sessionId);
    const job = session.jobs[id];
    if (!job) throw new AppError('JOB_NOT_FOUND', 'Generation not found.', 404);
    if (['queued', 'running'].includes(job.status)) {
      job.status = 'failed';
      job.error = { code: 'SERVER_RESTARTED', message: 'The server restarted before generation completed. Already saved designs are preserved; start this generation again.' };
      await this.store.update(sessionId, current => { current.jobs[id] = job; });
    }
    return job;
  }

  async cancel(sessionId, id) {
    const local = this.running.get(id);
    if (!local || local.sessionId !== sessionId) return this.get(sessionId, id);
    if (!['queued', 'running'].includes(local.status)) return this.public(local);
    local.status = 'cancelled';
    local.controller.abort();
    local.error = { code: 'CANCELLED', message: 'Generation cancelled. Completed saved designs have not been changed.' };
    await this.persist(local);
    return this.public(local);
  }

  async cancelSession(sessionId) {
    for (const job of this.running.values()) {
      if (job.sessionId === sessionId && ['queued', 'running'].includes(job.status)) await this.cancel(sessionId, job.id);
    }
  }

  async run(job, request) {
    if (job.status === 'cancelled') return;
    job.status = 'running';
    const signal = job.controller.signal;
    const check = async () => {
      if (signal.aborted || job.status === 'cancelled') throw new AppError('CANCELLED', 'Generation cancelled.', 409);
      activeCat(await this.store.settled(job.sessionId), job.catId, job.revision);
    };
    await check();
    const session = await this.store.settled(job.sessionId);
    const cat = activeCat(session, job.catId, job.revision);
    const photos = await Promise.all(cat.photos.map(async p => {
      const asset = await this.store.asset(job.sessionId, p.id);
      return { bytes: asset.bytes, name: p.name, mimeType: asset.mimeType };
    }));
    let identityAsset = session.identities[request.signature] || null;
    let identity;
    const generate = async kind => {
      await check();
      job.progress.label = labels[kind];
      await this.persist(job);
      const image = await this.provider.generate({ photos, traits: request.traits, personality: request.personality, mode: job.mode, kind, identity, signal });
      await check();
      const asset = await this.store.saveAsset(job.sessionId, image.bytes, { name: `${kind}-${job.mode}.png` });
      job.progress.completed++;
      await this.persist(job);
      return asset;
    };
    if (!identityAsset) {
      identityAsset = await generate('identity');
      await check();
      await this.store.update(job.sessionId, current => { activeCat(current, job.catId, job.revision); current.identities[request.signature] = identityAsset; });
    }
    const canonical = await this.store.asset(job.sessionId, identityAsset.id);
    identity = { bytes: canonical.bytes, mimeType: canonical.mimeType };
    const makeCharm = async (kind, old) => {
      const asset = await generate(kind);
      const name = request.personality.name;
      const titles = { face: `${name} · portrait`, body: `${name} · personality pose`, sleep: `${name} · sleeping`, toy: request.personality.favoriteToy || `${name} · favorite toy` };
      const why = { face: 'Generated from the uploaded cat photos and confirmed facial details.', body: 'The same cat identity, with a pose based on their personality.', sleep: 'The same cat identity in a relaxed sleeping pose.', toy: 'An accessory based on the owner’s favorite toy and personality notes.' };
      return { id: old?.id || randomUUID(), kind, title: titles[kind], why: why[kind], material: job.mode === 'real' ? 'realistic collectible' : 'artistic collectible', asset };
    };
    let result;
    if (request.regenerateCharmId) {
      const old = request.previous.charms.find(c => c.id === request.regenerateCharmId);
      const replacement = await makeCharm(old.kind, old);
      result = { ...request.previous, id: randomUUID(), inputFingerprint: request.inputFingerprint, character: identityAsset, charms: request.previous.charms.map(c => c.id === old.id ? replacement : c), createdAt: new Date().toISOString() };
    } else {
      const texture = await generate('texture');
      const charms = [];
      for (const kind of ['face', 'body', 'sleep', 'toy']) charms.push(await makeCharm(kind));
      result = { id: randomUUID(), catId: job.catId, revision: job.revision, mode: job.mode, inputFingerprint: request.inputFingerprint, profileSignature: request.signature, character: identityAsset, texture, charms, createdAt: new Date().toISOString(), model: this.provider.models?.image || this.provider.models?.imageModel || 'configured-image-model' };
    }
    await check();
    await this.store.update(job.sessionId, current => {
      activeCat(current, job.catId, job.revision);
      if (signal.aborted) throw new AppError('CANCELLED', 'Generation cancelled.', 409);
      current.generations[`${job.catId}:${job.mode}`] = result;
    });
    job.result = result;
    job.status = 'complete';
    job.progress.completed = job.progress.total;
    job.progress.label = 'Generated images saved';
    await this.persist(job);
  }

  async close() {
    for (const job of this.running.values()) if (['queued', 'running'].includes(job.status)) await this.cancel(job.sessionId, job.id);
  }
}
