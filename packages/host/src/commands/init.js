import { basename, resolve } from 'node:path'

import * as clack from '@clack/prompts'
import { chalk } from 'zx'

import { isInstanceRoot } from '@qctl/shared'

import { checkInstance } from '../init/check-instance.js'
import { ensureInstance } from '../init/ensure-instance.js'
import {
  answersFromFlags,
  formatQuickstartOutro,
  isInteractiveTty,
  offerInitTank,
  promptQuickstart,
  runTargetCheckLoop,
  writeQuickstartLab,
} from '../init/quickstart.js'
import { promptProject, writeProject } from '../init/wizard/index.js'
import { syncSchemaFromProvisionYaml } from '../init/wizard/secrets.js'

/** @import { Argv } from 'yargs' */
/** @import { QuickstartAnswers } from '../init/quickstart.js' */
/** @import { LayoutReport } from '../init/write-layout.js' */

export const command = 'init [dir]'
export const describe =
  'Scaffold or ensure an instance (Quickstart lab by default; --check / --fix / --dry-run)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('dir', {
      type: 'string',
      default: '.',
      describe: 'Target directory',
    })
    .option('yes', {
      alias: 'y',
      type: 'boolean',
      default: false,
      describe: 'Non-interactive Quickstart preset (no prompts)',
    })
    .option('force', {
      alias: 'f',
      type: 'boolean',
      default: false,
      describe: 'Overwrite existing scaffold files',
    })
    .option('fix', {
      type: 'boolean',
      default: false,
      describe: 'Ensure missing layout/provision scaffold only (no overwrite, no wizard)',
    })
    .option('check', {
      type: 'boolean',
      default: false,
      describe: 'Validate instance only (no writes); exit 1 on failures',
    })
    .option('dry-run', {
      type: 'boolean',
      default: false,
      describe: 'Print file plan without writing',
    })
    .option('profile', {
      alias: 'p',
      type: 'string',
      describe: 'Profile to validate first with --check (default: all / default-profile)',
    })
    .option('sync-env-from-yaml', {
      type: 'boolean',
      default: false,
      describe: 'Add-only: ensure provision/.env.schema declares every !env ref in YAML',
    })
    .option('name', {
      type: 'string',
      describe: 'package.json name (default: directory basename)',
    })
    .option('no-init-tank', {
      type: 'boolean',
      default: false,
      describe: 'Skip offering / running vm init-tank after Quickstart',
    })
    .option('tank-passphrase', {
      type: 'string',
      describe: 'Lab tank binding: static:<v> | secret:<NAME> | secret:<NAME>:<encoding>',
    })
    .option('cpu', {
      type: 'number',
      describe: 'Workstation vCPUs (Quickstart / --yes)',
    })
    .option('memory', {
      type: 'number',
      describe: 'Workstation memory MiB (Quickstart / --yes)',
    })
    .epilog(
      'Modes: greenfield write | --fix ensure missing | --force rewrite scaffold | --check validate | --dry-run plan.\n'
        + 'Quickstart (--yes / TTY default): profile lab → workstation/dev.\n'
        + 'Non-TTY: pass --yes (or --check / --fix on an existing instance).\n'
        + 'Later Proxmox: qctl new profile <name> (do not --force init).',
    )
}

/**
 * @typedef {object} InitCmdArgv
 * @property {string} [dir]
 * @property {boolean} [yes]
 * @property {boolean} [force]
 * @property {boolean} [fix]
 * @property {boolean} [check]
 * @property {boolean} [dryRun]
 * @property {string} [profile]
 * @property {boolean} [syncEnvFromYaml]
 * @property {string} [name]
 * @property {boolean} [noInitTank]
 * @property {string} [tankPassphrase]
 * @property {number} [cpu]
 * @property {number} [memory]
 */

/**
 * @param {LayoutReport & { root?: string }} report
 * @param {{ dryRun?: boolean }} [opts]
 */
function printWriteReport(report, opts = {}) {
  const prefix = opts.dryRun ? 'would ' : ''
  if (report.root) {
    console.log(
      chalk.green(opts.dryRun ? `dry-run plan for ${report.root}` : `initialized ${report.root}`),
    )
  }
  for (const rel of report.written) console.log(`  + ${prefix}${rel}`)
  for (const rel of report.patched) console.log(`  ~ ${prefix}${rel}`)
  for (const rel of report.skipped) console.log(`  = ${rel} (exists)`)
}

/**
 * Ensure / rewrite Quickstart scaffold without prompts.
 * @param {string} root
 * @param {QuickstartAnswers} answers
 * @param {{ force?: boolean, dryRun?: boolean }} opts
 */
function writeLab(root, answers, opts) {
  return writeQuickstartLab(root, answers, {
    force: opts.force,
    dryRun: opts.dryRun,
  })
}

/**
 * @param {InitCmdArgv} argv
 */
export async function handler(argv) {
  const dir = String(argv.dir ?? '.')
  const root = resolve(dir)
  const yes = Boolean(argv.yes)
  const force = Boolean(argv.force)
  const fix = Boolean(argv.fix)
  const check = Boolean(argv.check)
  const dryRun = Boolean(argv.dryRun)
  const syncEnv = Boolean(argv.syncEnvFromYaml)
  const existing = isInstanceRoot(root)

  try {
    if (check) {
      if (!existing) {
        console.error(chalk.red(`${root} is not a qctl instance (nothing to --check).`))
        process.exitCode = 1
        return
      }
      const ok = await checkInstance(root, { profile: argv.profile })
      if (!ok) process.exitCode = 1
      return
    }

    if (fix && !existing) {
      console.error(
        chalk.red(
          `${root} is not a qctl instance yet. Run \`qctl init\` (or \`qctl init --yes\`) without --fix.`,
        ),
      )
      process.exitCode = 1
      return
    }

    // Existing instance without --force → ensure missing files only (no secret catalog re-inject).
    if (existing && !force) {
      const result = ensureInstance(root, { dryRun, name: argv.name })
      printWriteReport(result, { dryRun })
      if (syncEnv) {
        const { added } = syncSchemaFromProvisionYaml(root, { dryRun })
        if (added.length) {
          console.log(
            chalk.cyan(
              dryRun
                ? `would add to provision/.env.schema: ${added.join(', ')}`
                : `synced !env → schema: ${added.join(', ')}`,
            ),
          )
        } else {
          console.log(chalk.dim('provision/.env.schema already covers YAML !env refs'))
        }
      }
      if (!fix) {
        console.log(
          chalk.dim(
            'Existing instance: ensured missing scaffold. Pass --force to rewrite from Quickstart/Custom.',
          ),
        )
      }
      return
    }

    // Greenfield (or --force rewrite): need --yes or a TTY for prompts.
    if (!yes && !isInteractiveTty()) {
      console.error(
        chalk.red(
          'Non-interactive terminal: pass --yes for the Quickstart preset, '
            + 'or --check / --fix on an existing instance.',
        ),
      )
      process.exitCode = 1
      return
    }

    /** @type {QuickstartAnswers} */
    let answers

    if (yes) {
      answers = answersFromFlags(
        {
          name: argv.name,
          tankPassphrase: argv.tankPassphrase,
          cpu: argv.cpu,
          memory: argv.memory,
        },
        root,
      )
    } else {
      clack.intro(chalk.cyan('qctl init'))
      const pathChoice = await clack.select({
        message: 'How do you want to set up this instance?',
        options: [
          {
            value: 'quickstart',
            label: 'Start locally quickly',
            hint: 'few prompts → lab VM on this machine',
          },
          {
            value: 'custom',
            label: 'Customize everything',
            hint: 'environments, disks, networking, Proxmox, …',
          },
        ],
        initialValue: 'quickstart',
      })
      if (clack.isCancel(pathChoice)) {
        clack.cancel('Init cancelled.')
        process.exitCode = 1
        return
      }
      if (pathChoice === 'custom') {
        const project = await promptProject(root, {
          initialName: argv.name ?? basename(root),
        })
        if (typeof project === 'symbol' || clack.isCancel(project)) {
          clack.cancel('Init cancelled.')
          process.exitCode = 1
          return
        }
        const custom = writeProject(project, { force, dryRun })
        printWriteReport(custom, { dryRun })
        if (syncEnv && !dryRun) syncSchemaFromProvisionYaml(root)
        if (dryRun) {
          clack.outro('Dry-run only (Custom).')
          return
        }
        const hasTanks =
          Object.keys(project.disks?.topology?.tanks ?? {}).length > 0
          || Object.values(project.disks?.byProfile ?? {}).some(
            (d) => d && Object.keys(d.tanks).length > 0,
          )
        const defaultProfile =
          project.defaultProfile
          ?? (Object.keys(project.profiles).length === 1
            ? Object.keys(project.profiles)[0]
            : '(none — pass -p)')
        clack.note(
          [
            'Custom scaffold written (environments, disks, networking, overlays, users, repo, packages, secrets).',
            '',
            `Default profile: ${defaultProfile}`,
            hasTanks
              ? 'Tanks present → run `qctl vm init-tank` before first useful `vm up`.'
              : 'No tanks → skip init-tank unless you add encrypted pools later.',
            'Physical disk placeholders (SET_PHYSICAL_DISK_ID_*) must match hardware.',
            'Later Proxmox: qctl new profile <name>',
          ].join('\n'),
          'Custom init',
        )
        clack.outro('Custom scaffold done (§A–H).')
        return
      }

      const prompted = await promptQuickstart(root, {
        initialName: argv.name ?? basename(root),
      })
      if (typeof prompted === 'symbol' || clack.isCancel(prompted)) {
        clack.cancel('Init cancelled.')
        process.exitCode = 1
        return
      }
      answers = prompted
      if (argv.tankPassphrase) {
        answers = answersFromFlags({ ...answers, tankPassphrase: argv.tankPassphrase }, root)
      }
    }

    const result = writeLab(root, answers, { force, dryRun })
    printWriteReport(result, { dryRun })

    if (syncEnv) {
      const { added } = syncSchemaFromProvisionYaml(root, { dryRun })
      if (added.length) {
        console.log(
          chalk.cyan(
            dryRun
              ? `would add to provision/.env.schema: ${added.join(', ')}`
              : `synced !env → schema: ${added.join(', ')}`,
          ),
        )
      }
    }

    if (dryRun) {
      if (!yes) clack.outro('Dry-run only (no files written).')
      return
    }

    /** True when tanks still need a one-shot init-tank before first useful `vm up`. */
    let needsInitTank = true
    if (!yes && isInteractiveTty()) {
      await runTargetCheckLoop(result.root)
      if (argv.noInitTank) {
        needsInitTank = true
      } else {
        const ran = await offerInitTank(result.root)
        needsInitTank = !ran
      }
    } else if (yes) {
      needsInitTank = true
    }

    console.log(`\n${formatQuickstartOutro(answers, { needsInitTank })}`)
    if (!yes) clack.outro('Lab scaffold done.')
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
