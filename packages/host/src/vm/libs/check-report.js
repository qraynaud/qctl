/** Structured target-check reporting (no fancy glyphs). */
import { chalk } from 'zx'

/** @typedef {ReturnType<typeof createCheckReport>} CheckReport */

/**
 * @param {string} label e.g. "local" or "proxmox"
 */
export function createCheckReport(label) {
  /** @type {string[]} */
  const fails = []
  /** @type {string[]} */
  const warns = []

  return {
    /** @param {string} title */
    section(title) {
      console.log(chalk.cyan(`\n${title}`))
    },
    /** @param {string} msg */
    ok(msg) {
      console.log(chalk.green(`  OK   ${msg}`))
    },
    /** @param {string} msg */
    warn(msg) {
      warns.push(msg)
      console.log(chalk.yellow(`  WARN ${msg}`))
    },
    /** @param {string} msg */
    fail(msg) {
      fails.push(msg)
      console.log(chalk.red(`  FAIL ${msg}`))
    },
    /** @returns {boolean} */
    finish() {
      console.log('')
      if (fails.length) {
        console.error(
          chalk.red(
            `vm: target-check ${label}: ${fails.length} failure(s)`
              + (warns.length ? `, ${warns.length} warning(s)` : ''),
          ),
        )
        process.exitCode = 1
        return false
      }
      if (warns.length) {
        console.log(chalk.yellow(`vm: target-check ${label}: OK with ${warns.length} warning(s)`))
      } else {
        console.log(chalk.green(`vm: target-check ${label}: OK`))
      }
      return true
    },
  }
}
