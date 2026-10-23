/**
 * Custom init — opt-in packages (distro/pipx/http) + guest file drops.
 * Written to common.yaml when shareTopology, else each env-*.yaml.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import * as clack from '@clack/prompts'
import YAML from 'yaml'

import { provisionEnvFile } from '@qctl/shared'

import { asBindingPrompts } from '../../lib/binding.js'
import { wizardStep } from './ui.js'

/** @import { BindingPrompts } from '../../lib/binding.js' */
/**
 * @import {
 *   FileItemInput,
 *   FilesInput,
 *   PackagesInput,
 *   ProvisionFileInput,
 * } from '../../provision/schema/types.js'
 */
/** @import { EnvironmentWriteSpec, ProfileWriteSpec } from '../write-provision.js' */

/**
 * @typedef {string | { package: string, inject: string[] }} PipxEntry
 */

/**
 * @typedef {object} HttpEntry
 * @property {string} url
 * @property {string} [bin]
 * @property {string} [dest]
 * @property {string} [test]
 */

/**
 * @typedef {object} FileEntry
 * @property {string} path absolute guest path
 * @property {string} [owner]
 * @property {string} [permissions]
 * @property {string} content
 */

/**
 * @typedef {object} PackagesAnswers
 * @property {string[]} distro
 * @property {PipxEntry[]} pipx
 * @property {HttpEntry[]} http
 */

/**
 * @typedef {object} PackagesFilesWizardAnswers
 * @property {boolean} shared
 * @property {PackagesAnswers | null} packages null → omit `packages:`
 * @property {FileEntry[] | null} files null/empty → omit `files:`
 */

/**
 * @param {boolean} [shared]
 * @returns {PackagesFilesWizardAnswers}
 */
export function defaultPackagesFilesAnswers(shared = false) {
  return { shared, packages: null, files: null }
}

/**
 * @param {PackagesAnswers} packages
 * @returns {boolean}
 */
export function packagesIsEmpty(packages) {
  return packages.distro.length === 0 && packages.pipx.length === 0 && packages.http.length === 0
}

/**
 * Writer plain for `packages:` (omit empty lists).
 * @param {PackagesAnswers} packages
 * @returns {PackagesInput | null}
 */
export function packagesToPlain(packages) {
  if (packagesIsEmpty(packages)) return null
  /** @type {PackagesInput} */
  const out = {}
  if (packages.distro.length) out.distro = [...packages.distro]
  if (packages.pipx.length) {
    out.pipx = packages.pipx.map((item) => {
      if (typeof item === 'string') return item
      if (!item.inject.length) return item.package
      return { package: item.package, inject: [...item.inject] }
    })
  }
  if (packages.http.length) {
    out.http = packages.http.map((h) => {
      /** @type {NonNullable<PackagesInput['http']>[number]} */
      const row = { url: h.url }
      if (h.bin) row.bin = h.bin
      if (h.dest) row.dest = h.dest
      if (h.test) row.test = h.test
      return row
    })
  }
  return out
}

/**
 * @param {FileEntry[]} files
 * @returns {FilesInput}
 */
export function filesToPlain(files) {
  return files.map((f) => {
    /** @type {FileItemInput} */
    const row = { path: f.path, content: f.content }
    if (f.owner) row.owner = f.owner
    if (f.permissions) row.permissions = f.permissions
    return row
  })
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function validateAbsPath(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return 'Absolute path required'
  if (!t.startsWith('/')) return 'Path must be absolute (start with /)'
  return undefined
}

/**
 * @param {string | undefined} raw
 * @returns {string | undefined}
 */
function validateOptionalMode(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return undefined
  const s = /^\d+$/.test(t) && !t.startsWith('0') && t.length <= 3 ? `0${t}` : t
  if (!/^[0-7]{3,4}$/.test(s)) return 'Octal mode like 0644'
  return undefined
}

/**
 * Read host file for guest content (`~/…` or absolute).
 * @param {string} raw
 * @returns {string | undefined} content, or undefined if not a readable file
 */
export function readHostFileContent(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return undefined
  let path = t
  if (t.startsWith('~/')) path = join(homedir(), t.slice(2))
  if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) return undefined
  if (!existsSync(path)) return undefined
  return readFileSync(path, 'utf8')
}

/**
 * @param {BindingPrompts} p
 * @returns {Promise<string[] | symbol>}
 */
async function promptDistroList(p) {
  /** @type {string[]} */
  const distro = []
  const want = await p.confirm({
    message: 'Add distro packages (dnf/apt/…)?',
    initialValue: false,
  })
  if (p.isCancel(want)) return /** @type {symbol} */ (want)
  if (!want) return distro

  let more = true
  while (more) {
    const name = await p.text({
      message: 'Distro package name',
      validate: (v) => (String(v ?? '').trim() ? undefined : 'Name required'),
    })
    if (p.isCancel(name)) return /** @type {symbol} */ (name)
    distro.push(String(name).trim())
    const again = await p.confirm({
      message: 'Add another distro package?',
      initialValue: false,
    })
    if (p.isCancel(again)) return /** @type {symbol} */ (again)
    more = Boolean(again)
  }
  return distro
}

/**
 * @param {BindingPrompts} p
 * @returns {Promise<PipxEntry[] | symbol>}
 */
async function promptPipxList(p) {
  /** @type {PipxEntry[]} */
  const pipx = []
  const want = await p.confirm({
    message: 'Add pipx packages?',
    initialValue: false,
  })
  if (p.isCancel(want)) return /** @type {symbol} */ (want)
  if (!want) return pipx

  let more = true
  while (more) {
    const pkg = await p.text({
      message: 'pipx package (name or name==version)',
      validate: (v) => (String(v ?? '').trim() ? undefined : 'Package required'),
    })
    if (p.isCancel(pkg)) return /** @type {symbol} */ (pkg)
    const packageName = String(pkg).trim()

    const withInject = await p.confirm({
      message: `Inject deps into ${packageName}?`,
      initialValue: false,
    })
    if (p.isCancel(withInject)) return /** @type {symbol} */ (withInject)

    if (!withInject) {
      pipx.push(packageName)
    } else {
      /** @type {string[]} */
      const inject = []
      let addInj = true
      while (addInj) {
        const inj = await p.text({
          message: 'Inject package name',
          validate: (v) => (String(v ?? '').trim() ? undefined : 'Name required'),
        })
        if (p.isCancel(inj)) return /** @type {symbol} */ (inj)
        inject.push(String(inj).trim())
        const moreInj = await p.confirm({
          message: 'Add another inject?',
          initialValue: false,
        })
        if (p.isCancel(moreInj)) return /** @type {symbol} */ (moreInj)
        addInj = Boolean(moreInj)
      }
      pipx.push({ package: packageName, inject })
    }

    const again = await p.confirm({
      message: 'Add another pipx package?',
      initialValue: false,
    })
    if (p.isCancel(again)) return /** @type {symbol} */ (again)
    more = Boolean(again)
  }
  return pipx
}

/**
 * @param {BindingPrompts} p
 * @returns {Promise<HttpEntry[] | symbol>}
 */
async function promptHttpList(p) {
  /** @type {HttpEntry[]} */
  const http = []
  const want = await p.confirm({
    message: 'Add http-downloaded binaries?',
    initialValue: false,
  })
  if (p.isCancel(want)) return /** @type {symbol} */ (want)
  if (!want) return http

  let more = true
  while (more) {
    const url = await p.text({
      message: 'Download URL',
      validate: (v) => {
        const t = String(v ?? '').trim()
        if (!t) return 'URL required'
        try {
          void new URL(t)
          return undefined
        } catch {
          return 'Must be a valid URL'
        }
      },
    })
    if (p.isCancel(url)) return /** @type {symbol} */ (url)

    const how = await p.select({
      message: 'Install as',
      options: [
        { value: 'bin', label: 'bin (zip member / /usr/local/bin name)' },
        { value: 'dest', label: 'dest (absolute guest path)' },
      ],
      initialValue: 'bin',
    })
    if (p.isCancel(how)) return /** @type {symbol} */ (how)

    /** @type {HttpEntry} */
    const entry = { url: String(url).trim() }
    if (how === 'bin') {
      const bin = await p.text({
        message: 'bin name',
        validate: (v) => (String(v ?? '').trim() ? undefined : 'bin required'),
      })
      if (p.isCancel(bin)) return /** @type {symbol} */ (bin)
      entry.bin = String(bin).trim()
    } else {
      const dest = await p.text({
        message: 'dest path',
        validate: validateAbsPath,
      })
      if (p.isCancel(dest)) return /** @type {symbol} */ (dest)
      entry.dest = String(dest).trim()
    }

    const testRaw = await p.text({
      message: 'Optional shell test (empty = omit)',
      placeholder: '[[ "$($APP --version)" == "1.0" ]]',
    })
    if (p.isCancel(testRaw)) return /** @type {symbol} */ (testRaw)
    const test = String(testRaw).trim()
    if (test) entry.test = test

    http.push(entry)

    const again = await p.confirm({
      message: 'Add another http package?',
      initialValue: false,
    })
    if (p.isCancel(again)) return /** @type {symbol} */ (again)
    more = Boolean(again)
  }
  return http
}

/**
 * @param {BindingPrompts} p
 * @returns {Promise<PackagesAnswers | null | symbol>}
 */
async function promptPackages(p) {
  const want = await p.confirm({
    message: 'Configure extra packages?',
    initialValue: false,
  })
  if (p.isCancel(want)) return /** @type {symbol} */ (want)
  if (!want) return null

  const distro = await promptDistroList(p)
  if (typeof distro === 'symbol') return distro
  const pipx = await promptPipxList(p)
  if (typeof pipx === 'symbol') return pipx
  const http = await promptHttpList(p)
  if (typeof http === 'symbol') return http

  return { distro, pipx, http }
}

/**
 * @param {BindingPrompts} p
 * @returns {Promise<FileEntry[] | null | symbol>}
 */
async function promptFiles(p) {
  const want = await p.confirm({
    message: 'Add guest file drops (cloud-init write_files)?',
    initialValue: false,
  })
  if (p.isCancel(want)) return /** @type {symbol} */ (want)
  if (!want) return null

  /** @type {FileEntry[]} */
  const files = []
  let more = true
  while (more) {
    const path = await p.text({
      message: 'Guest file path (absolute)',
      placeholder: '/etc/example.conf',
      validate: validateAbsPath,
    })
    if (p.isCancel(path)) return /** @type {symbol} */ (path)

    const ownerRaw = await p.text({
      message: 'Owner (empty = root:root)',
      placeholder: 'root:root',
    })
    if (p.isCancel(ownerRaw)) return /** @type {symbol} */ (ownerRaw)

    const modeRaw = await p.text({
      message: 'Permissions (empty = 0644)',
      placeholder: '0644',
      validate: validateOptionalMode,
    })
    if (p.isCancel(modeRaw)) return /** @type {symbol} */ (modeRaw)

    const contentSrc = await p.select({
      message: 'File content',
      options: [
        { value: 'paste', label: 'Paste / type' },
        { value: 'file', label: 'Read from host file' },
        { value: 'empty', label: 'Empty file' },
      ],
      initialValue: 'paste',
    })
    if (p.isCancel(contentSrc)) return /** @type {symbol} */ (contentSrc)

    /** @type {string} */
    let content = ''
    if (contentSrc === 'paste') {
      const raw = await p.text({
        message: 'Content',
        placeholder: 'key=value',
      })
      if (p.isCancel(raw)) return /** @type {symbol} */ (raw)
      content = String(raw ?? '')
    } else if (contentSrc === 'file') {
      const hostPath = await p.text({
        message: 'Host file path',
        placeholder: '~/template.conf',
        validate: (v) => {
          if (readHostFileContent(String(v ?? '')) != null) return undefined
          return 'Readable host file required'
        },
      })
      if (p.isCancel(hostPath)) return /** @type {symbol} */ (hostPath)
      content = readHostFileContent(String(hostPath)) ?? ''
    }

    /** @type {FileEntry} */
    const entry = { path: String(path).trim(), content }
    const owner = String(ownerRaw).trim()
    if (owner) entry.owner = owner
    const mode = String(modeRaw).trim()
    if (mode) {
      entry.permissions =
        /^\d+$/.test(mode) && !mode.startsWith('0') && mode.length <= 3 ? `0${mode}` : mode
    }
    files.push(entry)

    const again = await p.confirm({
      message: 'Add another file?',
      initialValue: false,
    })
    if (p.isCancel(again)) return /** @type {symbol} */ (again)
    more = Boolean(again)
  }
  return files
}

/**
 * @param {{
 *   prompts?: BindingPrompts
 *   shareTopology: boolean
 * }} opts
 * @returns {Promise<PackagesFilesWizardAnswers | symbol>}
 */
export async function promptPackagesFiles(opts) {
  const p = asBindingPrompts(opts.prompts ?? clack)

  wizardStep(p, 'Packages & files')

  const packages = await promptPackages(p)
  if (typeof packages === 'symbol') return packages

  const files = await promptFiles(p)
  if (typeof files === 'symbol') return files

  return {
    shared: Boolean(opts.shareTopology),
    packages,
    files,
  }
}

/** @typedef {Partial<ProvisionFileInput>} ProvisionYamlDoc */

/**
 * @param {string} path
 * @param {{ packages?: PackagesInput, files?: FilesInput }} block
 */
function writePackagesFilesIntoYamlFile(path, block) {
  const before = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const commentMatch = before.match(/^(?:#[^\n]*\n)*/)
  const header = commentMatch?.[0] ?? ''
  const body = before.slice(header.length)
  /** @type {ProvisionYamlDoc} */
  let doc
  try {
    doc = /** @type {ProvisionYamlDoc} */ (YAML.parse(body) ?? {})
  } catch {
    doc = {}
  }
  if (block.packages) doc.packages = block.packages
  if (block.files?.length) doc.files = block.files

  const text = header + YAML.stringify(doc, { lineWidth: 100 })
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
}

/**
 * @param {string} root
 * @param {PackagesFilesWizardAnswers} answers
 * @param {{
 *   profiles: Record<string, ProfileWriteSpec>
 *   environments: Record<string, EnvironmentWriteSpec>
 * }} ctx
 */
export function applyPackagesFilesAnswers(root, answers, ctx) {
  /** @type {{ packages?: PackagesInput, files?: FilesInput }} */
  const block = {}
  if (answers.packages) {
    const plain = packagesToPlain(answers.packages)
    if (plain) block.packages = plain
  }
  if (answers.files?.length) block.files = filesToPlain(answers.files)

  if (!block.packages && !block.files) return

  const provisionDir = join(root, 'provision')
  /** @type {string[]} */
  const paths = []

  if (answers.shared) {
    const commonPath = join(provisionDir, 'common.yaml')
    if (!existsSync(commonPath)) {
      writeFileSync(commonPath, `# Shared provision settings for every profile.\n`, 'utf8')
    }
    paths.push(commonPath)
  } else {
    /** @type {Set<string>} */
    const envs = new Set()
    for (const spec of Object.values(ctx.profiles)) envs.add(spec.env)
    for (const env of Object.keys(ctx.environments)) envs.add(env)
    for (const env of envs) {
      const path = join(provisionDir, provisionEnvFile(env))
      if (!existsSync(path)) {
        writeFileSync(path, `# Env "${env}".\n`, 'utf8')
      }
      paths.push(path)
    }
  }

  for (const path of paths) {
    writePackagesFilesIntoYamlFile(path, block)
  }
}
