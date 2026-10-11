/**
 * Install pipx packages (capability / provision recipes). Not part of platform.installPackages.
 */
import { mkdir } from 'node:fs/promises'

/** @import { NormalizedPackages, PlatformInstallOpts } from '@qctl/shared' */

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ inherit?: boolean }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function run(argv, env, opts = {}) {
  const proc = Bun.spawn(argv, {
    env: /** @type {Record<string, string>} */ (env),
    stdout: opts.inherit ? 'inherit' : 'pipe',
    stderr: opts.inherit ? 'inherit' : 'pipe',
    stdin: 'inherit',
  })
  if (opts.inherit) {
    return { code: await proc.exited, stdout: '', stderr: '' }
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

/**
 * @param {string} spec
 */
function pipxVenvName(spec) {
  const noExtra = spec.split('[')[0] || spec
  return noExtra.split(/[=<>!~]/)[0]?.trim() || ''
}

/**
 * @param {NormalizedPackages['pipx']} pipx
 * @param {PlatformInstallOpts} [opts]
 */
export async function installPipxPackages(pipx, opts = {}) {
  if (!pipx?.length) return
  const log = opts.log ?? ((line) => console.log(line))
  const env = { ...(opts.env ?? process.env) }
  const binDir = env.ROCKY_PACKAGES_BIN_DIR?.trim() || '/usr/local/bin'

  const have = await run(['bash', '-c', 'command -v pipx'], env)
  if (have.code !== 0) {
    throw new Error('pipx not on PATH (install distro pipx via platform capabilities first)')
  }

  env.PIPX_HOME = env.PIPX_HOME?.trim() || '/opt/pipx'
  env.PIPX_BIN_DIR = env.PIPX_BIN_DIR?.trim() || binDir
  await mkdir(env.PIPX_HOME, { recursive: true })
  await mkdir(env.PIPX_BIN_DIR, { recursive: true })

  for (const p of pipx) {
    const venv = pipxVenvName(p.package)
    if (!venv) throw new Error(`could not derive pipx venv name from ${p.package}`)
    log(`rocky-packages: pipx: install ${p.package}`)
    const inst = await run(['pipx', 'install', '--force', p.package], env, { inherit: true })
    if (inst.code !== 0) throw new Error(`pipx install ${p.package} failed`)
    for (const inj of p.inject || []) {
      log(`rocky-packages: pipx: inject ${venv} ← ${inj}`)
      const ir = await run(['pipx', 'inject', venv, inj], env, { inherit: true })
      if (ir.code !== 0) throw new Error(`pipx inject ${venv} ${inj} failed`)
    }
  }
}
