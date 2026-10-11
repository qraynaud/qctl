/** @import { StageContext } from '../context.js' */

/**
 * @typedef {object} Stage
 * @property {string} name
 * @property {string} describe
 * @property {(ctx: StageContext) => string[]} plan Lines describing what `run` would do
 * @property {(ctx: StageContext) => Promise<void>} run
 */

export {}
