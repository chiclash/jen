import { AppError } from './errors.js';
import { validateConfirmedTraits } from './openai.js';

export function validateTraits(value) {
  try { return validateConfirmedTraits(value); }
  catch (error) {
    if (error.code === 'NOT_A_CAT') throw new AppError(error.code, error.message, 422);
    throw new AppError('INVALID_PROFILE', error.message, 422);
  }
}

export function validatePersonality(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_PERSONALITY', 'Provide a personality object for this cat.', 422);
  return {
    name: String(value.name || 'Your cat').slice(0, 60),
    habits: (Array.isArray(value.habits) ? value.habits : []).map(String).slice(0, 12).map(s => s.slice(0, 60)),
    favoriteToy: String(value.favoriteToy || '').slice(0, 120),
    note: String(value.note || '').slice(0, 1000),
  };
}

export function activeCat(session, catId, revision) {
  const cat = session.cats[catId];
  if (!cat || session.activeCatId !== catId || (revision !== undefined && cat.revision !== revision)) {
    throw new AppError('STALE_CAT', 'These photos are no longer the active cat. Upload or restore the current cat before continuing.', 409);
  }
  return cat;
}
