/**
 * Custom init wizard coordinator — §A–§H (full Custom interview), then write.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import * as clack from '@clack/prompts'

import { asBindingPrompts, ensureEnvValue } from '../../lib/binding.js'
import { lineMatchesKey, parseLines, replaceByKey } from '../../lib/line-edit.js'
import { writeLayout } from '../write-layout.js'
import { mergeWriteReports, writeProvision } from '../write-provision.js'
import { applyDisksAnswers, promptDisks } from './disks.js'
import { defaultEnvironmentsAnswers, promptEnvironments } from './environments.js'
import { defaultInstanceAnswers, promptInstance } from './instance.js'
import { applyNetworkingAnswers, defaultNetworkingAnswers, promptNetworking } from './networking.js'
import { applyOverlaysAnswers, promptOverlays } from './overlays.js'
import { applyPackagesFilesAnswers, promptPackagesFiles } from './packages-files.js'
import { defaultProfilesAnswers, promptProfiles } from './profiles.js'
import { applyRepoRegAnswers, promptRepoReg } from './repo-reg.js'
import { applySecretsAnswers, collectProjectSecrets, promptSecrets } from './secrets.js'
import { applyUsersSshAnswers, promptUsersSsh } from './users-ssh.js'
import {
  promptVarlockPlugins,
  varlockPluginHintBlock,
  varlockPluginsToDependencies,
} from './varlock-plugins.js'

/** @import { BindingPrompts } from '../../lib/binding.js' */
/** @import { LayoutReport } from '../write-layout.js' */
/** @import { ProfileWriteSpec, ProvisionWriteMeta } from '../write-provision.js' */
/** @import { DisksWizardAnswers } from './disks.js' */
/** @import { EnvironmentSpec } from './environments.js' */
/** @import { NetworkingWizardAnswers } from './networking.js' */
/** @import { OverlaysWizardAnswers } from './overlays.js' */
/** @import { PackagesFilesWizardAnswers } from './packages-files.js' */
/** @import { RepoRegWizardAnswers } from './repo-reg.js' */
/** @import { SecretsWizardAnswers } from './secrets.js' */
/** @import { UsersSshWizardAnswers } from './users-ssh.js' */
/** @import { VarlockPluginDep } from './varlock-plugins.js' */

export { hostTimezone } from './instance.js'
export { validateLayerName } from './layer-name.js'
export { VAULTWARDEN_PLUGIN, VAULTWARDEN_PLUGIN_RANGE } from './varlock-plugins.js'

/**
 * @typedef {object} ProjectAnswers
 * @property {string} root Absolute instance directory (from `qctl init [dir]`)
 * @property {string} name package.json name
 * @property {string} platform qctl.platform (e.g. rocky)
 * @property {string} tz Root TZ for every .env.<env>
 * @property {Record<string, EnvironmentSpec>} environments
 * @property {Record<string, ProfileWriteSpec>} profiles
 * @property {string | null} [defaultProfile]
 * @property {boolean} shareTopology
 *   When multi-env: prefer shared networking in common.yaml
 * @property {VarlockPluginDep[]} varlockPlugins
 * @property {DisksWizardAnswers} [disks]
 * @property {NetworkingWizardAnswers} [networking]
 * @property {OverlaysWizardAnswers} [overlays]
 * @property {UsersSshWizardAnswers} [usersSsh]
 * @property {RepoRegWizardAnswers} [repoReg]
 * @property {PackagesFilesWizardAnswers} [packagesFiles]
 * @property {SecretsWizardAnswers} [secrets]
 */

/**
 * @param {ProjectAnswers} answers
 * @returns {ProvisionWriteMeta}
 */
export function projectToProvisionMeta(answers) {
  /** @type {Record<string, { production?: boolean }>} */
  const environments = {}
  for (const [key, spec] of Object.entries(answers.environments)) {
    environments[key] = spec.production ? { production: true } : {}
  }
  return {
    platform: answers.platform,
    environments,
    profiles: { ...answers.profiles },
    defaultProfile: answers.defaultProfile,
    // Topology keys themselves come from disks/networking; flag only records preference.
    sharedTopology: answers.shareTopology ? {} : undefined,
  }
}

/**
 * @param {string} root
 * @param {{ initialName?: string }} [opts]
 * @returns {ProjectAnswers}
 */
export function defaultProjectAnswers(root, opts = {}) {
  const dir = resolve(root)
  const instance = defaultInstanceAnswers(dir, opts)
  const envs = defaultEnvironmentsAnswers()
  const profiles = defaultProfilesAnswers()
  return {
    root: dir,
    ...instance,
    ...envs,
    ...profiles,
    varlockPlugins: [],
    disks: { sharedStructure: true, byProfile: {} },
    networking: defaultNetworkingAnswers(false),
  }
}

/**
 * @param {ProjectAnswers} answers
 * @returns {Record<string, string>}
 */
export function projectDependencies(answers) {
  return varlockPluginsToDependencies(answers.varlockPlugins ?? [])
}

/**
 * Patch root `.env.schema` QCTL_ENV default + `.env.<env>` non-secrets.
 * @param {string} root
 * @param {ProjectAnswers} answers
 */
export function applyProjectRootEnv(root, answers) {
  const schemaPath = join(root, '.env.schema')
  const schemaBefore = readFileSync(schemaPath, 'utf8')
  const qctlEnv =
    (answers.defaultProfile != null ? answers.profiles[answers.defaultProfile]?.env : undefined)
    ?? Object.keys(answers.environments)[0]
    ?? 'dev'
  let schemaNext = schemaBefore
  if (parseLines(schemaNext).lines.some((l) => lineMatchesKey(l, 'QCTL_ENV'))) {
    schemaNext = replaceByKey(schemaNext, 'QCTL_ENV', `QCTL_ENV=${qctlEnv}`).text
  }
  if (schemaNext !== schemaBefore) writeFileSync(schemaPath, schemaNext, 'utf8')

  for (const [env, spec] of Object.entries(answers.environments)) {
    const path = join(root, `.env.${env}`)
    let text = ''
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      text = `# Values for QCTL_ENV=${env}\n`
    }
    text = ensureEnvValue(text, 'ENV', env).text
    text = ensureEnvValue(text, 'APP_ROOT', spec.appRoot).text
    text = ensureEnvValue(text, 'TZ', answers.tz).text
    if (spec.production) {
      const missing = (answers.varlockPlugins ?? []).filter(
        (plug) => !text.includes(`@plugin(${plug.package})`),
      )
      const pluginHint = varlockPluginHintBlock(missing)
      if (pluginHint) {
        text = text.endsWith('\n') ? `${text}${pluginHint}\n` : `${text}\n${pluginHint}\n`
      }
    }
    writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
  }
}

/**
 * Write layout + provision meta from project answers, then disks/networking/overlays.
 * @param {ProjectAnswers} answers
 * @param {{ force?: boolean, dryRun?: boolean }} [opts]
 * @returns {{ root: string } & LayoutReport}
 */
export function writeProject(answers, opts = {}) {
  const root = resolve(answers.root)
  const envKeys = Object.keys(answers.environments)
  const layout = writeLayout(root, {
    force: opts.force,
    dryRun: opts.dryRun,
    name: answers.name,
    envs: envKeys,
    dependencies: projectDependencies(answers),
  })
  const provision = writeProvision(root, {
    force: opts.force,
    dryRun: opts.dryRun,
    meta: projectToProvisionMeta(answers),
    extraTargets: [],
    provisionEnvFiles: envKeys,
  })
  const report = mergeWriteReports(layout, provision)
  if (!opts.dryRun) {
    applyProjectRootEnv(root, answers)
    if (answers.disks) {
      applyDisksAnswers(root, answers.disks, { profiles: answers.profiles })
    }
    if (answers.networking) {
      applyNetworkingAnswers(
        root,
        { ...answers.networking, shared: Boolean(answers.shareTopology) },
        {
          profiles: answers.profiles,
          environments: answers.environments,
        },
      )
    }
    if (answers.overlays) {
      applyOverlaysAnswers(root, answers.overlays, { profiles: answers.profiles })
    }
    if (answers.usersSsh) {
      applyUsersSshAnswers(
        root,
        { ...answers.usersSsh, shared: Boolean(answers.shareTopology) },
        {
          profiles: answers.profiles,
          environments: answers.environments,
        },
      )
    }
    if (answers.repoReg) {
      applyRepoRegAnswers(
        root,
        { ...answers.repoReg, shared: Boolean(answers.shareTopology) },
        {
          profiles: answers.profiles,
          environments: answers.environments,
        },
      )
    }
    if (answers.packagesFiles) {
      applyPackagesFilesAnswers(
        root,
        { ...answers.packagesFiles, shared: Boolean(answers.shareTopology) },
        {
          profiles: answers.profiles,
          environments: answers.environments,
        },
      )
    }
    if (answers.secrets) {
      applySecretsAnswers(root, answers.secrets, collectProjectSecrets(answers))
    }
  }
  return { root, ...report }
}

/**
 * @typedef {BindingPrompts & {
 *   intro?: typeof clack.intro
 *   outro?: typeof clack.outro
 *   note?: typeof clack.note
 * }} ProjectPrompts
 */

/**
 * Run Custom prompts: §A–§H (full interview).
 * @param {string} initialRoot
 * @param {{
 *   prompts?: ProjectPrompts
 *   initialName?: string
 * }} [opts]
 * @returns {Promise<ProjectAnswers | symbol>}
 */
export async function promptProject(initialRoot, opts = {}) {
  const p = /** @type {ProjectPrompts} */ (asBindingPrompts(opts.prompts ?? clack))
  const root = resolve(initialRoot)

  const instance = await promptInstance(root, {
    prompts: p,
    initialName: opts.initialName,
  })
  if (typeof instance === 'symbol') {
    return /** @type {symbol} */ (instance)
  }

  const envs = await promptEnvironments({ prompts: p })
  if (typeof envs === 'symbol') {
    return /** @type {symbol} */ (envs)
  }

  const profiles = await promptProfiles({
    prompts: p,
    envKeys: Object.keys(envs.environments),
    environments: envs.environments,
  })
  if (typeof profiles === 'symbol') {
    return /** @type {symbol} */ (profiles)
  }

  const varlockPlugins = await promptVarlockPlugins({ prompts: p })
  if (typeof varlockPlugins === 'symbol') {
    return /** @type {symbol} */ (varlockPlugins)
  }

  const disks = await promptDisks({
    prompts: p,
    profiles: profiles.profiles,
    varlockPlugins,
  })
  if (typeof disks === 'symbol') {
    return /** @type {symbol} */ (disks)
  }

  const networking = await promptNetworking({
    prompts: p,
    profiles: profiles.profiles,
    shareTopology: envs.shareTopology,
  })
  if (typeof networking === 'symbol') {
    return /** @type {symbol} */ (networking)
  }

  const overlays = await promptOverlays({
    prompts: p,
    profiles: profiles.profiles,
    networking,
  })
  if (typeof overlays === 'symbol') {
    return /** @type {symbol} */ (overlays)
  }

  const usersSsh = await promptUsersSsh({
    prompts: p,
    shareTopology: envs.shareTopology,
  })
  if (typeof usersSsh === 'symbol') {
    return /** @type {symbol} */ (usersSsh)
  }

  const repoReg = await promptRepoReg({
    prompts: p,
    root,
    shareTopology: envs.shareTopology,
  })
  if (typeof repoReg === 'symbol') {
    return /** @type {symbol} */ (repoReg)
  }

  const packagesFiles = await promptPackagesFiles({
    prompts: p,
    shareTopology: envs.shareTopology,
  })
  if (typeof packagesFiles === 'symbol') {
    return /** @type {symbol} */ (packagesFiles)
  }

  /** @type {Omit<ProjectAnswers, 'root' | 'secrets'>} */
  const draft = {
    ...instance,
    ...envs,
    ...profiles,
    varlockPlugins,
    disks,
    networking,
    overlays,
    usersSsh,
    repoReg,
    packagesFiles,
  }

  const secrets = await promptSecrets({
    prompts: p,
    secrets: collectProjectSecrets(draft),
    envKeys: Object.keys(envs.environments),
    varlockPlugins,
  })
  if (typeof secrets === 'symbol') {
    return /** @type {symbol} */ (secrets)
  }

  return {
    root,
    ...draft,
    secrets,
  }
}
