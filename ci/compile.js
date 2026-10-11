#!/usr/bin/env bun
import { existsSync } from 'node:fs'
import { chmod, cp, mkdir } from 'node:fs/promises'
/**
 * Compile qctl binaries with `bun build --compile`.
 *
 * Also stages `varlock-local-encrypt` next to the binaries so varlock's SEA
 * sibling resolver finds a native encryption backend (disk cache by default).
 * Without it, varlock falls back to file encryption + in-memory cache.
 *
 * Usage:
 *   bun run ci/compile.js              # all targets
 *   bun run ci/compile.js host
 *   bun run ci/compile.js guest
 *   bun run ci/compile.js platform-rocky   # ESM module only
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const OUT = join(ROOT, 'dist')
const require = createRequire(import.meta.url)

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
    assets: ['seed'],
    outfile: 'qctl-host',
  },
  {
    id: 'guest',
    entry: 'src/cli.js',
    cwd: 'packages/guest',
    outfile: 'qctl-guest',
  },
]

/**
 * Platform package name for `@varlock/native-helper-*` (matches varlock's resolver).
 * @returns {string | undefined}
 */
function nativeHelperPackageName() {
  if (process.platform === 'darwin') return '@varlock/native-helper-darwin'
  if (process.platform === 'win32') return `@varlock/native-helper-win32-${process.arch}`
  if (process.platform === 'linux') return `@varlock/native-helper-linux-${process.arch}`
  return undefined
}

/**
 * Resolve `varlock-local-encrypt` from an installed `@varlock/native-helper-*` package.
 * @returns {string | undefined}
 */
export function resolveNativeHelperBinary() {
  const pkgName = nativeHelperPackageName()
  if (!pkgName) return undefined
  /** @type {string[]} */
  const fromFiles = [
    join(ROOT, 'packages/shared/src/index.js'),
    join(ROOT, 'packages/vaultwarden-plugin/src/plugin.js'),
    join(ROOT, 'ci/compile.js'),
  ]
  for (const from of fromFiles) {
    try {
      const req = createRequire(from)
      const pkgJson = req.resolve(`${pkgName}/package.json`)
      const binName =
        process.platform === 'win32' ? 'varlock-local-encrypt.exe' : 'varlock-local-encrypt'
      const bin = join(dirname(pkgJson), binName)
      if (existsSync(bin)) return bin
      const appBin = join(
        dirname(pkgJson),
        'VarlockEnclave.app',
        'Contents',
        'MacOS',
        'varlock-local-encrypt',
      )
      if (existsSync(appBin)) return appBin
    } catch {
      // try next base
    }
  }
  try {
    const pkgJson = require.resolve(`${pkgName}/package.json`)
    const binName =
      process.platform === 'win32' ? 'varlock-local-encrypt.exe' : 'varlock-local-encrypt'
    const bin = join(dirname(pkgJson), binName)
    if (existsSync(bin)) return bin
  } catch {
    // absent
  }
  return undefined
}

/**
 * Copy the native helper next to compiled binaries (`process.execPath` sibling).
 * @returns {Promise<string | undefined>} destination path when staged
 */
export async function stageNativeHelper() {
  const src = resolveNativeHelperBinary()
  if (!src) {
    console.warn(
      'warn: @varlock/native-helper-* not found — varlock will use file/memory cache fallback.\n'
        + '      Run `bun install` in qctl (optionalDeps) or install the platform helper package.',
    )
    return undefined
  }
  const destName =
    process.platform === 'win32' ? 'varlock-local-encrypt.exe' : 'varlock-local-encrypt'
  const dest = join(OUT, destName)
  await cp(src, dest)
  if (process.platform !== 'win32') await chmod(dest, 0o755)
  console.log(`staged ${dest} ← ${src}`)
  return dest
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
  // Host reads CLOUD_IMAGE from the downloaded plugin; JSON is also staged for
  // sync resolvers / release asset parity with the source pin.
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
  for (const target of selected) {
    await compileOne(target)
  }
  // Platform ESM is staged beside guest for appliance install / sync --include-tooling.
  if (!only || only === 'guest') {
    await bundlePlatformModule()
  }
  await stageNativeHelper()
  console.log('done')
}

if (import.meta.main) {
  await main()
}
