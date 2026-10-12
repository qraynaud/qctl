import { $ } from 'zx'

/** Host/nested podman lines that drown useful local: progress. */
const NOISE_RE =
  /User-selected graph driver|overwritten by graph driver|Failed to connect to system scope bus/i

/**
 * @param {string} text
 * @returns {string}
 */
export function stripPodmanNoise(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !NOISE_RE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

/**
 * Quiet host `podman` (no zx echo; strip known graph-driver / dbus spam).
 * @param {string[]} args podman args after the binary (without --log-level)
 * @param {{ nothrow?: boolean }} [opts]
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
export async function podman(args, opts = {}) {
  void opts
  const r = await $({
    quiet: true,
    verbose: false,
  })`podman --log-level=fatal ${args}`.nothrow()
  const stdout = stripPodmanNoise(String(r.stdout))
  const stderr = stripPodmanNoise(String(r.stderr))
  return {
    exitCode: r.exitCode ?? 0,
    stdout: stdout ? `${stdout}\n` : '',
    stderr: stderr ? `${stderr}\n` : '',
  }
}
