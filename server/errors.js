export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export function publicError(error) {
  if (error?.name === 'AbortError' || error?.code === 'CANCELLED') {
    return { code: 'CANCELLED', message: 'This generation was cancelled.' };
  }
  if (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,60}$/.test(error.code) && Number.isInteger(error.status)) {
    return { code: error.code, message: String(error.message).slice(0, 350) };
  }
  return { code: 'INTERNAL_ERROR', message: 'The operation could not be completed. Please try again.' };
}
