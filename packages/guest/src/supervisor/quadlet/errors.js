/** Fatal quadlet error — CLI prints `quadlet: ERROR: …` and exits 1. */
export class QuadletError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'QuadletError'
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
export function die(message) {
  throw new QuadletError(message)
}
