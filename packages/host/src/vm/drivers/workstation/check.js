/** Local (libvirt) target-check. */
import { fs, path } from 'zx'

import { isEmptyCredential } from '@qctl/shared'

import { loadEnvProvisionSafe } from '../../../lib/load-config.js'
import { getCacheHome, getDataHome, getImages, getSeed, getVms } from '../../../lib/paths.js'
import { HOST_DEPS, which } from '../../../lib/util.js'
import { tankPassphraseCredName } from '../../../provision/schema/first-boot.js'
import { createCheckReport } from '../../libs/check-report.js'
import { virsh } from '../../libs/libvirt/index.js'

/** @import { CheckReport } from '../../libs/check-report.js' */
/** @import { VmArgv } from '../../types.js' */

/**
 * @param {CheckReport} report
 * @param {string} name
 * @param {string} [hint]
 * @returns {Promise<void>}
 */
async function checkBin(report, name, hint) {
  const p = await which(name)
  if (p) report.ok(`${name} → ${p}`)
  else {
    report.fail(`${name} not found on PATH`)
    if (hint) report.warn(hint)
  }
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function check(argv) {
  const report = createCheckReport('workstation')
  const connect = argv.connect || 'qemu:///system'
  const envName = String(argv.env || 'dev')

  report.section('Host tools')
  for (const bin of ['virsh', 'virt-install', 'qemu-img']) {
    await checkBin(report, bin)
  }
  // Emulated TPM 2.0 on every workstation VM (virt-install `--tpm` / libvirt reconcile).
  await checkBin(
    report,
    'swtpm',
    'swtpm provides the emulated TPM 2.0 used by workstation VMs — install it (e.g. `sudo pacman -S swtpm`)',
  )
  report.ok('NoCloud ISO writer bundled (@gcu/iso9660)')

  report.section(`Libvirt (${connect})`)
  const ver = await virsh(connect, 'version').nothrow()
  if (ver.exitCode !== 0) {
    report.fail(
      `cannot talk to libvirt: ${String(ver.stderr || ver.stdout).trim() || `exit ${ver.exitCode}`}`,
    )
    report.warn(HOST_DEPS.split('\n')[0])
  } else {
    const line = String(ver.stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l)
    report.ok(`reachable${line ? ` (${line})` : ''}`)
  }

  if (ver.exitCode === 0 && !connect.includes('session')) {
    const nets = await virsh(connect, 'net-list', '--all').nothrow()
    if (nets.exitCode !== 0) {
      report.fail(`net-list failed: ${String(nets.stderr || nets.stdout).trim()}`)
    } else if (/\bdefault\b/.test(String(nets.stdout))) {
      const active = /^\s*default\s+active\b/m.test(String(nets.stdout))
      if (active) report.ok("network 'default' active")
      else report.warn("network 'default' defined but not active — `virsh net-start default`")
    } else {
      report.fail("libvirt network 'default' missing")
    }
  } else if (connect.includes('session')) {
    report.ok('session URI — skip default NAT network check')
  }

  report.section('XDG cache / data')
  report.ok(`cache ${getCacheHome()}`)
  report.ok(`data  ${getDataHome()}`)
  for (const [label, p] of [
    ['images', getImages()],
    ['seed', getSeed()],
    ['vms', getVms()],
  ]) {
    if (!fs.existsSync(p)) {
      report.warn(`${label} missing (created on demand): ${p}`)
    } else {
      report.ok(`${label} ${p}`)
    }
  }

  const target = argv.target || 'workstation'
  report.section(`Config (provision/, env=${envName}, target=${target})`)
  report.ok('instance provision/ found')
  const loaded = await loadEnvProvisionSafe({ env: envName, target })
  if (!loaded.ok) {
    report.fail(loaded.error)
  } else {
    const { provision } = loaded
    report.ok(`loaded ${provision.paths.map((p) => path.basename(p)).join(' + ')}`)

    if (provision.sshAuthorizedKeys) report.ok('admin SSH key present')
    else report.warn('no ssh.authorized_keys in provision/ and no ~/.ssh id_*.pub — seed will fail')

    /** @type {string[]} */
    const expectedTankPass = []
    for (const tank of Object.values(provision.data.disks?.tanks || {})) {
      if (tank.passphrase) expectedTankPass.push(tankPassphraseCredName(tank.id))
    }
    const tier0Missing = expectedTankPass.filter((k) => isEmptyCredential(provision.guest?.[k]))
    if (expectedTankPass.length === 0) {
      report.ok('first-boot Tier-0: no encrypted tanks')
    } else if (tier0Missing.length === 0) {
      report.ok(`first-boot Tier-0 (${expectedTankPass.join(', ')}) present`)
    } else {
      report.warn(
        `missing first-boot Tier-0 ${tier0Missing.join(', ')} — set disks.tanks.*.passphrase (!env)`,
      )
    }
  }

  report.finish()
}
