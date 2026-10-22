import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store, validId } from './store.js';
import { Jobs } from './jobs.js';
import { AppError, publicError } from './errors.js';
import { activeCat, validateTraits } from './validation.js';
import { createOpenAIProvider } from './openai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function body(req, maximum = 2 * 1024 * 1024) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new AppError('JSON_REQUIRED', 'Send an application/json request.', 415);
  if (Number(req.headers['content-length']) > maximum) throw new AppError('REQUEST_TOO_LARGE', 'The request is too large.', 413);
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > maximum) throw new AppError('REQUEST_TOO_LARGE', 'The request is too large.', 413);
    parts.push(part);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new AppError('INVALID_JSON', 'The request must be a JSON object.', 400); }
}

function respond(res, status, data) {
  const output = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(output), 'Cache-Control': 'no-store' });
  res.end(output);
}

function publicCat(cat) {
  if (!cat) return null;
  return { id: cat.id, revision: cat.revision, photos: cat.photos, traits: cat.traits || null };
}

export function createApp({
  dataDir = process.env.DATA_DIR || path.resolve('.data'),
  frontendDir = path.resolve(here, '../frontend'),
  provider,
  aiConfigured,
  paidRequestsEnabled = false,
  secureCookie = process.env.COOKIE_SECURE === 'true',
} = {}) {
  const apiKey = process.env.CHARCOAL_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  const configured = aiConfigured ?? (Boolean(provider) || Boolean(apiKey));
  const visionModel = process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini';
  const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5';
  const ai = provider || createOpenAIProvider({ apiKey, visionModel, imageModel, paidRequestsEnabled });
  const store = new Store(dataDir);
  const jobs = new Jobs(store, ai);
  const uploadEpochs = new Map();
  const ready = () => {
    // This gate comes first, even if a credential happens to be injected into the process.
    if (paidRequestsEnabled !== true) throw new AppError('AI_PAID_DISABLED', 'Paid AI requests are disabled. No request was sent.', 403);
    if (!configured) throw new AppError('AI_NOT_CONFIGURED', 'Configure CHARCOAL_OPENAI_API_KEY on the server to use photo recognition and image generation.', 503);
  };
  const health = () => ({ ok: true, aiConfigured: configured, paidRequestsEnabled: paidRequestsEnabled === true, visionModel: ai.models?.vision || ai.models?.visionModel || visionModel, imageModel: ai.models?.image || ai.models?.imageModel || imageModel });

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new AppError('INVALID_PATH', 'Invalid path.', 400); }
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.headers.origin) {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { throw new AppError('INVALID_ORIGIN', 'Invalid request origin.', 403); }
        if (origin.host !== req.headers.host) throw new AppError('INVALID_ORIGIN', 'Cross-site requests are not allowed.', 403);
      }
      if (pathname === '/api/health' && req.method === 'GET') return respond(res, 200, health());

      if (pathname.startsWith('/api/')) {
        const match = /(?:^|;\s*)charcoal_session=([^;]+)/.exec(req.headers.cookie || '');
        const sessionId = validId(match?.[1]) ? match[1] : randomUUID();
        if (!match || match[1] !== sessionId) {
          res.setHeader('Set-Cookie', `charcoal_session=${sessionId}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict${secureCookie || req.socket.encrypted ? '; Secure' : ''}`);
        }
        if (pathname === '/api/session') {
          if (req.method === 'GET') {
            const session = await store.settled(sessionId);
            const cat = session.cats[session.activeCatId];
            const generations = Object.values(session.generations).filter(g => g.catId === session.activeCatId);
            const pending = Object.values(session.jobs).find(j => j.catId === session.activeCatId && ['queued', 'running'].includes(j.status));
            const lastJob = pending ? await jobs.get(sessionId, pending.id) : null;
            return respond(res, 200, { state: session.state, cat: publicCat(cat), generations, activeJob: lastJob && ['queued', 'running'].includes(lastJob.status) ? lastJob : null, lastJob, aiConfigured: configured, paidRequestsEnabled: paidRequestsEnabled === true });
          }
          if (req.method === 'PUT') {
            const input = await body(req);
            if (!input.state || typeof input.state !== 'object' || Array.isArray(input.state)) throw new AppError('INVALID_STATE', 'Save a design state object.', 422);
            await store.update(sessionId, session => {
              if (input.state.cat) activeCat(session, input.state.cat.id, input.state.cat.revision);
              else if (session.activeCatId && Object.hasOwn(input.state, 'cat')) throw new AppError('STALE_CAT', 'Save the currently active cat rather than an older or empty selection.', 409);
              session.state = input.state;
            });
            return respond(res, 200, { saved: true });
          }
          if (req.method === 'DELETE') {
            uploadEpochs.set(sessionId, (uploadEpochs.get(sessionId) || 0) + 1);
            await jobs.cancelSession(sessionId);
            await store.update(sessionId, session => { session.state = null; session.activeCatId = null; });
            return respond(res, 200, { cleared: true });
          }
        }

        if (pathname === '/api/cats' && req.method === 'POST') {
          const uploadController = new AbortController();
          req.once('aborted', () => uploadController.abort());
          res.once('close', () => { if (!res.writableEnded) uploadController.abort(); });
          const checkUpload = () => {
            if (req.aborted || res.destroyed || uploadController.signal.aborted) throw new AppError('UPLOAD_CANCELLED', 'Upload cancelled. The previous cat has not been replaced.', 409);
          };
          const input = await body(req, 35 * 1024 * 1024);
          checkUpload();
          if (!Array.isArray(input.photos) || input.photos.length < 1 || input.photos.length > 3) throw new AppError('INVALID_PHOTOS', 'Upload one to three cat photos.', 422);
          const buffers = input.photos.map(photo => {
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(photo?.mimeType) || typeof photo.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(photo.data) || photo.data.length % 4 !== 0) throw new AppError('INVALID_IMAGE', 'Use JPEG, PNG, or WebP photos with valid image data.', 422);
            const bytes = Buffer.from(photo.data, 'base64');
            if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new AppError('IMAGE_TOO_LARGE', 'Each photo must be no larger than 8 MiB.', 422);
            return { bytes, name: String(photo.name || 'cat.png').slice(0, 120) };
          });
          const epoch = (uploadEpochs.get(sessionId) || 0) + 1;
          uploadEpochs.set(sessionId, epoch);
          const photos = [];
          for (const photo of buffers) {
            checkUpload();
            photos.push(await store.saveAsset(sessionId, photo.bytes, { photo: true, name: photo.name }));
            checkUpload();
          }
          if (uploadEpochs.get(sessionId) !== epoch) throw new AppError('STALE_UPLOAD', 'A newer upload replaced these photos.', 409);
          await jobs.cancelSession(sessionId);
          checkUpload();
          const cat = { id: randomUUID(), revision: 1, photos, traits: null, createdAt: new Date().toISOString() };
          await store.update(sessionId, session => {
            checkUpload();
            if (uploadEpochs.get(sessionId) !== epoch) throw new AppError('STALE_UPLOAD', 'A newer upload replaced these photos.', 409);
            session.cats[cat.id] = cat; session.activeCatId = cat.id; session.state = null;
          }, { signal: uploadController.signal });
          return respond(res, 201, publicCat(cat));
        }

        const analyze = /^\/api\/cats\/([0-9a-f-]+)\/analyze$/.exec(pathname);
        if (analyze && req.method === 'POST') {
          ready();
          await body(req);
          const session = await store.settled(sessionId);
          const cat = activeCat(session, analyze[1]);
          const photos = await Promise.all(cat.photos.map(async photo => {
            const image = await store.asset(sessionId, photo.id);
            return { bytes: image.bytes, mimeType: image.mimeType, name: photo.name };
          }));
          const controller = new AbortController();
          res.once('close', () => { if (!res.writableEnded) controller.abort(); });
          const traits = validateTraits(await ai.analyze(photos, { signal: controller.signal }));
          await store.update(sessionId, current => { activeCat(current, cat.id, cat.revision).traits = traits; });
          return respond(res, 200, { catId: cat.id, revision: cat.revision, traits });
        }

        if (pathname === '/api/generations' && req.method === 'POST') {
          ready();
          const input = await body(req);
          return respond(res, 202, await jobs.start(sessionId, input));
        }
        const generation = /^\/api\/generations\/([0-9a-f-]+)$/.exec(pathname);
        if (generation && req.method === 'GET') return respond(res, 200, await jobs.get(sessionId, generation[1]));
        if (generation && req.method === 'DELETE') return respond(res, 200, await jobs.cancel(sessionId, generation[1]));
        const asset = /^\/api\/assets\/([0-9a-f-]+)$/.exec(pathname);
        if (asset && ['GET', 'HEAD'].includes(req.method)) {
          const image = await store.asset(sessionId, asset[1]);
          res.writeHead(200, { 'Content-Type': image.mimeType, 'Content-Length': image.bytes.length, 'Cache-Control': 'private, max-age=31536000, immutable' });
          return res.end(req.method === 'HEAD' ? undefined : image.bytes);
        }
        throw new AppError('NOT_FOUND', 'API route not found.', 404);
      }

      if (!['GET', 'HEAD'].includes(req.method)) throw new AppError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      const file = path.resolve(frontendDir, relative);
      if (!file.startsWith(path.resolve(frontendDir) + path.sep) || relative.split('/').some(part => part.startsWith('.')) || !MIME[path.extname(file)]) throw new AppError('NOT_FOUND', 'File not found.', 404);
      let info;
      try { info = await stat(file); } catch { throw new AppError('NOT_FOUND', 'File not found.', 404); }
      if (!info.isFile()) throw new AppError('NOT_FOUND', 'File not found.', 404);
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Content-Length': bytes.length, 'Cache-Control': pathname === '/' ? 'no-cache' : 'public, max-age=3600' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) respond(res, Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500, { error: publicError(error) });
      else if (!res.destroyed) res.end();
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;
  return {
    server, store, jobs,
    async close() {
      await jobs.close();
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const app = createApp({ paidRequestsEnabled: process.env.CHARCOAL_ENABLE_PAID_AI === 'true' });
  app.server.listen(port, host, () => {
    console.log(`CHARCOAL × Crocs server listening on ${host}:${port}`);
    console.log(`Paid AI requests: ${process.env.CHARCOAL_ENABLE_PAID_AI === 'true' ? 'explicitly enabled' : 'disabled (no paid requests will be sent)'}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0), () => process.exit(1)));
}
