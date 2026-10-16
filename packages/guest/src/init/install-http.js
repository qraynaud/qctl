/**
 * Install provision `packages.http` (URL → binary). Uses Bun fetch; zip via `unzip`.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

/** @import { NormalizedPackages, PlatformInstallOpts } from '@qctl/shared' */

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function run(argv, env) {
  const proc = Bun.spawn(argv, {
    env: /** @type {Record<string, string>} */ (env),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'inherit',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

/**
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function looksLikeZip(bytes) {
  return (
    bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
    && (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  )
}

/**
 * @param {NormalizedPackages['http'][number]} entry
 * @param {string} binDir
 * @returns {string}
 */
function resolveOutPath(entry, binDir) {
  if (entry.dest) return entry.dest
  if (entry.bin) return join(binDir, entry.bin)
  throw new Error(`http entry missing bin and dest (${entry.url})`)
}

/**
 * @param {NormalizedPackages['http'][number]} entry
 * @param {string} out
 * @param {Record<string, string | undefined>} env
 * @param {(line: string) => void} log
 */
async function installHttpOne(entry, out, env, log) {
  const member = entry.bin || basename(out)
  log(`rocky-packages: http: ${entry.url} → ${out}`)

  const res = await fetch(entry.url)
  if (!res.ok) {
    throw new Error(`http download failed ${entry.url}: HTTP ${res.status}`)
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  await mkdir(dirname(out), { recursive: true })

  if (looksLikeZip(bytes)) {
    const tmp = await mkdtemp(join(tmpdir(), 'qctl-http-'))
    try {
      const zipPath = join(tmp, 'payload.zip')
      const extractDir = join(tmp, 'extract')
      await writeFile(zipPath, bytes)
      await mkdir(extractDir, { recursive: true })
      const uz = await run(['unzip', '-qo', zipPath, '-d', extractDir], env)
      if (uz.code !== 0) {
        throw new Error(`unzip failed for ${entry.url}: ${uz.stderr.trim() || uz.stdout.trim()}`)
      }
      const preferred = join(extractDir, member)
      if (await Bun.file(preferred).exists()) {
        await Bun.write(out, Bun.file(preferred))
      } else {
        const glob = new Bun.Glob('**/*')
        /** @type {string | undefined} */
        let only
        for await (const rel of glob.scan({ cwd: extractDir, onlyFiles: true })) {
          only = join(extractDir, rel)
          break
        }
        if (!only) throw new Error(`zip from ${entry.url} had no files`)
        await Bun.write(out, Bun.file(only))
      }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  } else {
    await writeFile(out, bytes)
  }
  await chmod(out, 0o755)

  if (entry.test) {
    log(`rocky-packages: http: test ${entry.test} (APP=${out})`)
    const tr = await run(['bash', '-c', entry.test], { ...env, APP: out })
    if (tr.code !== 0) {
      throw new Error(`http test failed for ${out}: ${entry.test}`)
    }
  }
}

/**
 * @param {NormalizedPackages['http']} http
 * @param {PlatformInstallOpts} [opts]
 */
export async function installHttpPackages(http, opts = {}) {
  if (!http?.length) return
  const log = opts.log ?? ((line) => console.log(line))
  const env = { ...(opts.env ?? process.env) }
  const binDir = env.ROCKY_PACKAGES_BIN_DIR?.trim() || '/usr/local/bin'

  for (const entry of http) {
    const out = resolveOutPath(entry, binDir)
    await installHttpOne(entry, out, env, log)
  }
}
