import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Args after the script path (works under `zx` / `bun` / `node`).
 *
 * @param {string} scriptUrl import.meta.url of the entry script
 * @returns {string[]}
 */
export function scriptArgs(scriptUrl) {
  const scriptPath = fileURLToPath(scriptUrl)
  const scriptIdx = process.argv.findIndex((arg) => {
    try {
      return resolve(arg) === scriptPath
    } catch {
      return false
    }
  })
  return scriptIdx >= 0
    ? process.argv.slice(scriptIdx + 1).filter((arg) => arg !== '--')
    : process.argv.slice(2).filter((arg) => arg !== '--')
}
