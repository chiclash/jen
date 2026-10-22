import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AppError } from './errors.js';

export const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export class Store {
  constructor(dataDir) {
    this.root = path.resolve(dataDir);
    this.queues = new Map();
  }

  sessionPath(id) {
    if (!validId(id)) throw new AppError('INVALID_SESSION', 'Invalid session.', 400);
    return path.join(this.root, 'sessions', id);
  }

  async read(id) {
    const root = this.sessionPath(id);
    try {
      return JSON.parse(await readFile(path.join(root, 'session.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { id, createdAt: new Date().toISOString(), state: null, activeCatId: null, cats: {}, assets: {}, generations: {}, identities: {}, jobs: {} };
    }
  }

  async update(id, mutate, { signal } = {}) {
    const previous = this.queues.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const checkCommit = () => {
        if (signal?.aborted) throw new AppError('UPLOAD_CANCELLED', 'Upload cancelled. The previous cat has not been replaced.', 409);
      };
      checkCommit();
      const session = await this.read(id);
      checkCommit();
      const result = await mutate(session);
      session.updatedAt = new Date().toISOString();
      const root = this.sessionPath(id);
      await mkdir(root, { recursive: true, mode: 0o700 });
      const temporary = path.join(root, `${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(session), { mode: 0o600 });
      try {
        // The active-cat transaction must not commit if its upload client disconnected
        // while image normalization or the atomic JSON write was still in progress.
        checkCommit();
        await rename(temporary, path.join(root, 'session.json'));
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      return result === undefined ? session : result;
    });
    this.queues.set(id, next);
    next.finally(() => { if (this.queues.get(id) === next) this.queues.delete(id); }).catch(() => {});
    return next;
  }

  async settled(id) {
    await this.queues.get(id)?.catch(() => {});
    return this.read(id);
  }

  async asset(id, assetId) {
    if (!validId(assetId)) throw new AppError('ASSET_NOT_FOUND', 'Image not found.', 404);
    const session = await this.settled(id);
    const asset = session.assets[assetId];
    if (!asset) throw new AppError('ASSET_NOT_FOUND', 'Image not found.', 404);
    return { ...asset, bytes: await readFile(path.join(this.sessionPath(id), 'assets', `${assetId}.${asset.format}`)) };
  }

  async saveAsset(sessionId, bytes, { name = 'generated.png', photo = false } = {}) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 24 * 1024 * 1024) {
      throw new AppError('INVALID_IMAGE', 'The image is empty or too large.', 422);
    }
    let encoded, info;
    try {
      let pipeline = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error', animated: false }).rotate();
      if (photo) pipeline = pipeline.resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
      ({ data: encoded, info } = await pipeline.png().toBuffer({ resolveWithObject: true }));
    } catch {
      throw new AppError('INVALID_IMAGE', 'The file is not a supported readable image. Use JPEG, PNG, or WebP.', 422);
    }
    const id = randomUUID();
    const root = path.join(this.sessionPath(sessionId), 'assets');
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(path.join(root, `${id}.png`), encoded, { mode: 0o600 });
    const asset = { id, url: `/api/assets/${id}`, width: info.width, height: info.height, name: String(name).slice(0, 120), format: 'png', mimeType: 'image/png' };
    await this.update(sessionId, session => { session.assets[id] = asset; });
    return asset;
  }
}
