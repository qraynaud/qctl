export class UnknownStageError extends Error {
  /** @param {string} name */
  constructor(name) {
    super(`unknown stage: ${name}`)
    this.name = 'UnknownStageError'
    this.stage = name
  }
}

export class StageError extends Error {
  /**
   * @param {string} stage
   * @param {string} message
   */
  constructor(stage, message) {
    // One line: host serial fatal match aborts on the first line of stage errors.
    const oneLine = String(message).replace(/\s*\n+\s*/g, ' | ')
    super(`stage ${stage}: ${oneLine}`)
    this.name = 'StageError'
    this.stage = stage
  }
}
