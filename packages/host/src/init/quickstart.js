/**
 * Quickstart: local lab VM path for `qctl init`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import * as clack from '@clack/prompts'
import { chalk } from 'zx'

import {
  asBindingPrompts,
  ensureEnvValue,
  ensureSchemaSecret,
  formatYamlValue,
  parseBindingFlag,
  promptCredentialBinding,
} from '../lib/binding.js'
import { resolveDriver } from '../vm/drivers/index.js'
import { runVmCheck } from '../vm/libs/check-pipeline.js'
import { runVmInitTank } from '../vm/libs/up-pipeline.js'
import { hostCloneContext } from './detect-clone-url.js'
import { writeLayout } from './write-layout.js'
import {
  defaultQuickstartProvisionMeta,
  mergeWriteReports,
  writeProvision,
} from './write-provision.js'

/** @import { BindingPrompts, CredentialBinding } from '../lib/binding.js' */
/** @import { ProvisionTemplateVars } from '../templates.js' */
/** @import { VmArgv } from '../vm/types.js' */
/** @import { LayoutReport } from './write-layout.js' */

/**
 * @typedef {object} QuickstartRepo
 * @property {'git' | 'hg'} vcs
 * @property {string} url
 * @property {string} dir
 * @property {CredentialBinding} deployKey
 */

/**
 * @typedef {object} QuickstartAnswers
 * @property {string} name
 * @property {string | null} sshAuthorizedKey null → omit (host ~/.ssh fallback)
 * @property {CredentialBinding} tankPassphrase
 * @property {number} cpu
 * @property {number} memory
 * @property {QuickstartRepo | null} repo null → omit guest clone (use `qctl sync` instead)
 */

/**
 * @returns {boolean}
 */
export function isInteractiveTty() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

/**
 * @param {string} root
 * @returns {QuickstartAnswers}
 */
export function defaultQuickstartAnswers(root) {
  const dir = resolve(root)
  return {
    name: basename(dir),
    sshAuthorizedKey: null,
    tankPassphrase: { kind: 'static', value: 'lab-tank-passphrase' },
    cpu: 2,
    memory: 4096,
    // --yes / preset: no guest clone; push with `qctl sync`
    repo: null,
  }
}

/**
 * @typedef {BindingPrompts & {
 *   intro?: typeof clack.intro
 *   outro?: typeof clack.outro
 *   note?: typeof clack.note
 *   log?: typeof clack.log
 * }} QuickstartPrompts
 */

/**
 * @param {string} root
 * @param {{
 *   prompts?: QuickstartPrompts
 *   initialName?: string
 * }} [opts]
 * @returns {Promise<QuickstartAnswers | symbol>}
 */
export async function promptQuickstart(root, opts = {}) {
  const p = /** @type {QuickstartPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
  const defaults = defaultQuickstartAnswers(root)

  const name = await p.text({
    message: 'Instance name (package.json)',
    initialValue: opts.initialName ?? defaults.name,
    validate: (v) => (v && String(v).trim() ? undefined : 'Name required'),
  })
  if (p.isCancel(name)) return /** @type {symbol} */ (name)

  const useSshFallback = await p.confirm({
    message: 'Use pubkeys from ~/.ssh/*.pub for the admin user?',
    initialValue: true,
  })
  if (p.isCancel(useSshFallback)) return /** @type {symbol} */ (useSshFallback)

  /** @type {string | null} */
  let sshAuthorizedKey = null
  if (!useSshFallback) {
    const key = await p.text({
      message: 'Admin SSH public key (paste one line)',
      validate: (v) => (v && String(v).trim() ? undefined : 'Key required'),
    })
    if (p.isCancel(key)) return /** @type {symbol} */ (key)
    sshAuthorizedKey = String(key).trim()
  }

  const tankPassphrase = await promptCredentialBinding({
    message: 'Lab tank passphrase',
    allowOmit: true,
    omitLabel: 'None (no encryption)',
    initialKind: 'static',
    staticInitial: 'lab-tank-passphrase',
    suggestSecretName: 'TANK_PASSPHRASE',
    askValueNow: true,
    prompts: p,
  })
  if (typeof tankPassphrase === 'symbol') {
    return /** @type {symbol} */ (tankPassphrase)
  }

  const size = await p.select({
    message: 'VM size (workstation)',
    options: [
      { value: '2/4', label: '2 CPU / 4G (default)' },
      { value: '4/8', label: '4 CPU / 8G' },
      { value: 'custom', label: 'Custom…' },
    ],
    initialValue: '2/4',
  })
  if (p.isCancel(size)) return /** @type {symbol} */ (size)

  let cpu = 2
  let memory = 4096
  if (size === '4/8') {
    cpu = 4
    memory = 8192
  } else if (size === 'custom') {
    const cpuRaw = await p.text({
      message: 'vCPUs',
      initialValue: '2',
      validate: (v) =>
        /^\d+$/.test(String(v ?? '')) && Number(v) > 0 ? undefined : 'Positive integer',
    })
    if (p.isCancel(cpuRaw)) return /** @type {symbol} */ (cpuRaw)
    const memRaw = await p.text({
      message: 'Memory (MiB)',
      initialValue: '4096',
      validate: (v) => (/^\d+$/.test(String(v ?? '')) && Number(v) >= 512 ? undefined : '≥ 512'),
    })
    if (p.isCancel(memRaw)) return /** @type {symbol} */ (memRaw)
    cpu = Number(cpuRaw)
    memory = Number(memRaw)
  }

  const wantRepo = await p.confirm({
    message:
      'Clone a git/hg repo on the guest at first boot? (No → use qctl sync from this machine)',
    initialValue: false,
  })
  if (p.isCancel(wantRepo)) return /** @type {symbol} */ (wantRepo)

  /** @type {QuickstartAnswers['repo']} */
  let repo = null
  if (wantRepo) {
    const host = hostCloneContext(root)
    const vcs = await p.select({
      message: 'Guest clone VCS',
      options: [
        { value: 'git', label: 'Git' },
        { value: 'hg', label: 'Mercurial (hg)' },
      ],
      initialValue: host.vcs ?? 'git',
    })
    if (p.isCancel(vcs)) return /** @type {symbol} */ (vcs)
    const vcsKey = /** @type {'git' | 'hg'} */ (vcs)
    const suggestedUrl = host[vcsKey] ?? ''
    const url = await p.text({
      message: 'Clone URL',
      initialValue: suggestedUrl,
      validate: (v) => (v && String(v).trim() ? undefined : 'URL required'),
    })
    if (p.isCancel(url)) return /** @type {symbol} */ (url)
    const dir = await p.text({
      message: 'Guest clone directory',
      initialValue: '/tank/rocky',
      validate: (v) => (v && String(v).trim() ? undefined : 'Directory required'),
    })
    if (p.isCancel(dir)) return /** @type {symbol} */ (dir)
    const deployKey = await promptCredentialBinding({
      message: 'Deploy key',
      allowOmit: false,
      initialKind: 'secret',
      suggestSecretName: 'DEPLOY_KEY',
      askEncoding: true,
      askValueNow: true,
      prompts: p,
    })
    if (typeof deployKey === 'symbol') {
      return /** @type {symbol} */ (deployKey)
    }
    if (deployKey.kind === 'omit')
      throw new Error('deploy key is required when enabling guest clone')
    repo = {
      vcs: vcsKey,
      url: String(url).trim(),
      dir: String(dir).trim(),
      deployKey,
    }
  }

  return {
    name: String(name).trim(),
    sshAuthorizedKey,
    tankPassphrase,
    cpu,
    memory,
    repo,
  }
}

/**
 * Nunjucks context for provision scaffolds from Quickstart answers.
 * @param {QuickstartAnswers} answers
 * @returns {ProvisionTemplateVars}
 */
export function provisionTemplateVarsFromAnswers(answers) {
  /** @type {string | null} */
  let tankPassphrase = null
  if (answers.tankPassphrase.kind !== 'omit') {
    tankPassphrase = formatYamlValue(answers.tankPassphrase)
  }

  /** @type {null | { vcs: string, url: string, dir: string, deployKey: string }} */
  let repo = null
  if (answers.repo) {
    if (answers.repo.deployKey.kind === 'omit') {
      throw new Error('deploy key cannot be omit when applying Quickstart repo')
    }
    repo = {
      vcs: answers.repo.vcs,
      url: answers.repo.url,
      dir: answers.repo.dir,
      deployKey: formatYamlValue(answers.repo.deployKey),
    }
  }

  return {
    cpu: answers.cpu,
    memory: answers.memory,
    tankPassphrase,
    sshAuthorizedKey: answers.sshAuthorizedKey,
    repo,
  }
}

/**
 * Write secret names into provision/.env.schema and optional values into .env.dev.
 * YAML content itself is rendered via Nunjucks (see writeQuickstartLab).
 * @param {string} root
 * @param {QuickstartAnswers} answers
 */
export function applyQuickstartSecrets(root, answers) {
  const env = 'dev'
  const provisionDir = join(root, 'provision')
  const schemaPath = join(provisionDir, '.env.schema')
  const envPath = join(provisionDir, `.env.${env}`)
  let schema = readFileSync(schemaPath, 'utf8')
  let envFile = readFileSync(envPath, 'utf8')

  /** @param {CredentialBinding} binding */
  const applySecret = (binding) => {
    if (binding.kind !== 'secret') return
    const s = ensureSchemaSecret(schema, binding.name)
    schema = s.text
    if (binding.value != null) {
      const e = ensureEnvValue(envFile, binding.name, binding.value)
      envFile = e.text
    }
  }

  applySecret(answers.tankPassphrase)
  if (answers.repo) applySecret(answers.repo.deployKey)

  writeFileSync(schemaPath, schema, 'utf8')
  writeFileSync(envPath, envFile, 'utf8')
}

/**
 * Shared Getting-started / `--help` path (local lab + Later Proxmox).
 * Keep in sync with root README and init Quickstart outro intent.
 * @returns {string}
 */
export function formatGettingStartedEpilog() {
  return `Quickstart (local lab VM):
  # Prefer: git clone … || hg clone …  (or mkdir + git/hg init)
  qctl init .                 # checks host deps; offers init-tank
  qctl vm up
  qctl new app demo --engine rootless && qctl sync
  qctl vm up demo && qctl vm ps

Later (Proxmox):
  qctl new profile pve
  qctl vm up --profile pve
  qctl sync --profile pve && qctl vm up demo --profile pve`
}

/**
 * @param {QuickstartAnswers} [_answers]
 * @param {{ profile?: string, needsInitTank?: boolean }} [opts]
 * @returns {string}
 */
export function formatQuickstartOutro(_answers, opts = {}) {
  const profile = opts.profile ?? 'lab'
  const needsInitTank = Boolean(opts.needsInitTank)
  const next = needsInitTank
    ? `Next (run in this directory):

  1. qctl vm init-tank                      # create encrypted ZFS tanks (once)
  2. qctl vm up                             # boot appliance (waits until ready)
  3. qctl new app demo --engine rootless    # tiny .container included
  4. qctl sync                              # waits for SSH; push repo (+ tooling if needed)
  5. qctl vm up demo                        # guest quadlet up (or rely on auto-up later)
  6. qctl vm ps                             # VM + app status
  7. qctl vm shell                          # optional interactive SSH`
    : `Next (run in this directory):

  1. qctl vm up                             # boot appliance (waits until ready)
  2. qctl new app demo --engine rootless    # tiny .container included
  3. qctl sync                              # waits for SSH; push repo (+ tooling if needed)
  4. qctl vm up demo                        # guest quadlet up (or rely on auto-up later)
  5. qctl vm ps                             # VM + app status
  6. qctl vm shell                          # optional interactive SSH`

  return `Instance ready (profile: ${profile} → workstation / dev).

${next}

Later (Proxmox) — keep lab; do not --force init:
  qctl new profile pve
  qctl vm up --profile pve
  qctl sync --profile pve && qctl vm up demo --profile pve`
}

/**
 * @param {string} root
 * @param {{ profile?: string }} [opts]
 * @returns {Promise<boolean>}
 */
export async function runTargetCheckOnce(root, opts = {}) {
  const prev = process.cwd()
  process.chdir(root)
  try {
    process.exitCode = 0
    const argv = /** @type {VmArgv} */ ({
      profile: opts.profile ?? 'lab',
    })
    const { module, ctx } = await resolveDriver(argv)
    const ok = await runVmCheck(ctx, module)
    return ok !== false && process.exitCode !== 1
  } finally {
    process.chdir(prev)
  }
}

/**
 * @param {string} root
 * @param {{
 *   profile?: string
 *   prompts?: { confirm: Function, isCancel: Function, note?: Function }
 * }} [opts]
 * @returns {Promise<boolean>} true if check passed
 */
export async function runTargetCheckLoop(root, opts = {}) {
  const p = opts.prompts ?? clack
  for (;;) {
    console.log(chalk.cyan('\nRunning qctl vm target-check…'))
    const ok = await runTargetCheckOnce(root, { profile: opts.profile })
    if (ok) {
      console.log(chalk.green('Host looks ready for the lab VM.'))
      return true
    }
    process.exitCode = 0
    p.note?.(
      'Fix the FAIL items above (install packages, join kvm/libvirt group, re-login),\n'
        + 'then re-run the check. You can skip and continue — `qctl vm up` will fail until fixed.',
      'target-check failed',
    )
    const again = await p.confirm({
      message: 'Re-run target-check now?',
      initialValue: true,
    })
    if (p.isCancel(again) || !again) return false
  }
}

/**
 * @param {string} root
 * @param {{
 *   profile?: string
 *   prompts?: { confirm: Function, isCancel: Function }
 *   initTank?: (argv: VmArgv) => Promise<void>
 * }} [opts]
 */
export async function offerInitTank(root, opts = {}) {
  const p = opts.prompts ?? clack
  const run = await p.confirm({
    message:
      'Create encrypted ZFS tank(s) now with `qctl vm init-tank`? '
      + '(one-shot disposable boot; needed before apps use /tank)',
    initialValue: true,
  })
  if (p.isCancel(run) || !run) return false

  const prev = process.cwd()
  process.chdir(root)
  try {
    const argv = /** @type {VmArgv} */ ({
      profile: opts.profile ?? 'lab',
    })
    if (opts.initTank) {
      await opts.initTank(argv)
      return true
    }
    const { module, ctx, specs } = await resolveDriver(argv)
    await runVmInitTank(ctx, { console: true }, module, specs)
    return true
  } finally {
    process.chdir(prev)
  }
}

/**
 * Write Quickstart lab files (layout + Nunjucks provision + secret schema).
 * @param {string} dir
 * @param {QuickstartAnswers} answers
 * @param {{ force?: boolean, dryRun?: boolean, extraProxmoxOverlay?: boolean, aiSkills?: boolean }} [opts]
 * @returns {{ root: string } & LayoutReport}
 */
export function writeQuickstartLab(dir, answers, opts = {}) {
  const root = resolve(dir)
  const layout = writeLayout(root, {
    force: opts.force,
    dryRun: opts.dryRun,
    name: answers.name,
    aiSkills: opts.aiSkills,
  })
  const provision = writeProvision(root, {
    force: opts.force,
    dryRun: opts.dryRun,
    meta: defaultQuickstartProvisionMeta(),
    extraTargets: opts.extraProxmoxOverlay === false ? [] : ['proxmox'],
    provisionEnvFiles: ['dev', 'prod'],
    templateVars: provisionTemplateVarsFromAnswers(answers),
  })
  const report = mergeWriteReports(layout, provision)
  if (!opts.dryRun) applyQuickstartSecrets(root, answers)
  return { root, ...report }
}

/**
 * Parse `--tank-passphrase=` / `--deploy-key=` style flags into answers overlays.
 * @param {Partial<{
 *   name?: string
 *   tankPassphrase?: string
 *   cpu?: number
 *   memory?: number
 * }>} flags
 * @param {string} root
 * @returns {QuickstartAnswers}
 */
export function answersFromFlags(flags, root) {
  const base = defaultQuickstartAnswers(root)
  if (flags.name) base.name = flags.name
  if (flags.tankPassphrase) {
    base.tankPassphrase = parseBindingFlag(flags.tankPassphrase)
  }
  if (flags.cpu) base.cpu = flags.cpu
  if (flags.memory) base.memory = flags.memory
  return base
}
