#!/usr/bin/env bun
/**
 * Compile qctl binaries with `bun build --compile`.
 *
 * Embeds `varlock-local-encrypt` into host/guest via `--asset` (materialized at
 * runtime beside the binary for varlock's SEA sibling resolver). Also stages a
 * copy under `dist/` for local checkout use. Not a separate GitHub release asset.
 *
 * Usage:
 *   bun run ci/compile.js              # all targets
 *   bun run ci/compile.js host
 *   bun run ci/compile.js guest
 *   bun run ci/compile.js platform-rocky   # ESM module only
 */
import { existsSync } from 'node:fs'
import { chmod, cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  resolveNativeHelperFromNpm,
  varlockLocalEncryptName,
} from '../packages/shared/src/varlock/native-helper.js'

const ROOT = join(import.meta.dir, '..')
const OUT = join(ROOT, 'dist')
const HELPER_NAME = varlockLocalEncryptName()

/**
 * @typedef {object} Target
 * @property {string} id
 * @property {string} entry Entry relative to {@link ROOT} (or `cwd` when set)
 * @property {string} outfile
 * @property {string} [cwd] Build cwd relative to {@link ROOT} (for `--asset` paths)
 * @property {string[]} [assets] Paths relative to `cwd` (or ROOT) embedded via `--asset`
 */

/** @type {Target[]} */
const TARGETS = [
  {
    id: 'host',
    entry: 'src/cli.js',
    cwd: 'packages/host',
    assets: ['seed', HELPER_NAME],
    outfile: 'qctl-host',
  },
  {
    id: 'guest',
    entry: 'src/cli.js',
    cwd: 'packages/guest',
    assets: [HELPER_NAME],
    outfile: 'qctl-guest',
  },
]

/**
 * Resolve helper from npm optionalDep (re-export for tests / compile staging).
 * @returns {string | undefined}
 */
export function resolveNativeHelperBinary() {
  return resolveNativeHelperFromNpm()
}

/**
 * Copy helper into package dirs for `--asset` and into `dist/` for checkout runs.
 * @returns {Promise<string | undefined>}
 */
export async function stageNativeHelper() {
  const src = resolveNativeHelperBinary()
  if (!src) {
    console.warn(
      'warn: @varlock/native-helper-* not found — compile will omit the helper asset.\n'
        + '      Run `bun install` in qctl (optionalDeps) or install the platform helper package.',
    )
    return undefined
  }

  for (const pkg of ['host', 'guest']) {
    const dest = join(ROOT, 'packages', pkg, HELPER_NAME)
    await cp(src, dest)
    if (process.platform !== 'win32') await chmod(dest, 0o755)
    console.log(`staged ${dest} ← ${src}`)
  }

  const distDest = join(OUT, HELPER_NAME)
  await mkdir(OUT, { recursive: true })
  await cp(src, distDest)
  if (process.platform !== 'win32') await chmod(distDest, 0o755)
  console.log(`staged ${distDest} ← ${src}`)
  return distDest
}

/**
 * @param {Target} target
 */
async function compileOne(target) {
  const outPath = join(OUT, target.outfile)
  const cwd = target.cwd ? join(ROOT, target.cwd) : ROOT
  const entry = target.cwd ? target.entry : join(ROOT, target.entry)
  if (target.id === 'host') {
    const seedRoot = join(ROOT, 'packages/host/seed')
    if (!existsSync(join(seedRoot, 'cloud-init', 'user-data.yaml'))) {
      throw new Error(`host seed missing at ${seedRoot}`)
    }
  }
  const helperAsset = join(cwd, HELPER_NAME)
  if ((target.assets ?? []).includes(HELPER_NAME) && !existsSync(helperAsset)) {
    throw new Error(
      `missing ${helperAsset} — run stageNativeHelper / bun install for @varlock/native-helper-*`,
    )
  }
  /** @type {string[]} */
  const args = ['bun', 'build', '--compile', entry, `--outfile=${outPath}`]
  for (const asset of target.assets ?? []) {
    args.push('--asset', asset)
  }
  if (target.id === 'host') {
    args.push('--external', 'cpu-features')
  }
  console.log(
    `compile ${target.id} → ${outPath}${target.assets?.length ? ` (assets: ${target.assets.join(', ')})` : ''}`,
  )
  const proc = Bun.spawn(args, { cwd, stdout: 'inherit', stderr: 'inherit' })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`compile failed for ${target.id} (exit ${code})`)
  }
}

/**
 * Bundle the thin platform ESM module for guest dynamic `import()`
 * (`/usr/local/lib/qctl/qctl-platform-rocky.mjs`).
 */
async function bundlePlatformModule() {
  const entry = join(ROOT, 'packages/platform-rocky/src/platform.js')
  const outPath = join(OUT, 'qctl-platform-rocky.mjs')
  console.log(`bundle platform-rocky module → ${outPath}`)
  const proc = Bun.spawn(['bun', 'build', entry, `--outfile=${outPath}`, '--target=bun'], {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`platform module bundle failed (exit ${code})`)
  const pinSrc = join(ROOT, 'packages/platform-rocky/cloud-image.json')
  if (existsSync(pinSrc)) {
    await cp(pinSrc, join(OUT, 'cloud-image.json'))
    console.log(
      `staged ${join(OUT, 'cloud-image.json')} ← packages/platform-rocky/cloud-image.json`,
    )
  }
}

async function main() {
  const only = process.argv[2]
  if (only === 'platform-rocky') {
    await mkdir(OUT, { recursive: true })
    await bundlePlatformModule()
    console.log('done')
    return
  }

  const selected = only ? TARGETS.filter((t) => t.id === only) : TARGETS
  if (selected.length === 0) {
    console.error(`unknown target: ${only}`)
    console.error(`known: ${TARGETS.map((t) => t.id).join(', ')}, platform-rocky`)
    process.exit(1)
  }

  await mkdir(OUT, { recursive: true })
  await stageNativeHelper()
  for (const target of selected) {
    await compileOne(target)
  }
  if (!only || only === 'guest') {
    await bundlePlatformModule()
  }
  console.log('done')
}

if (import.meta.main) {
  await main()
}
