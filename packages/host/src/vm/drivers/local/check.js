/** Local (libvirt) target-check. */
import { fs, path } from 'zx'

import { loadEnvSecrets } from '../../../lib/load-config.js'
import { getCacheHome, getDataHome, getImages, getSeed, getVms } from '../../../lib/paths.js'
import { HOST_DEPS, which } from '../../../lib/util.js'
import { createCheckReport } from '../../libs/check-report.js'
import { virsh } from '../../libs/libvirt.js'

/** @import { CheckReport } from '../../libs/check-report.js' */
/** @import { VmArgv } from '../../types.js' */

/**
 * @param {CheckReport} report
 * @param {string} name
 * @returns {Promise<void>}
 */
async function checkBin(report, name) {
  const p = await which(name)
  if (p) report.ok(`${name} → ${p}`)
  else report.fail(`${name} not found on PATH`)
}

/**
 * @param {VmArgv} argv
 * @returns {Promise<void>}
 */
export async function check(argv) {
  const report = createCheckReport('local')
  const connect = argv.connect || 'qemu:///system'
  const envName = String(argv.env || 'dev')

  report.section('Host tools')
  for (const bin of ['virsh', 'virt-install', 'qemu-img']) {
    await checkBin(report, bin)
  }
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

  const target = argv.target || 'local'
  report.section(`Config (provision/, env=${envName}, target=${target})`)
  {
    report.ok('instance provision/ found')
    let secrets
    try {
      secrets = await loadEnvSecrets({ env: envName, target })
    } catch (err) {
      report.fail(err instanceof Error ? err.message : String(err))
      secrets = null
    }
    if (secrets) {
      report.ok(`loaded ${secrets.paths.map((p) => path.basename(p)).join(' + ')}`)

      if (secrets.sshAuthorizedKeys) report.ok('admin SSH key present')
      else
        report.warn('no ssh.authorized_keys in provision/ and no ~/.ssh id_*.pub — seed will fail')

      const tier0Missing = [!secrets.guest?.TANK_PASSPHRASE && 'TANK_PASSPHRASE'].filter(Boolean)
      if (tier0Missing.length === 0) report.ok('first-boot Tier-0 (TANK_PASSPHRASE) present')
      else {
        report.warn(
          `missing first-boot Tier-0 ${tier0Missing.join(', ')} — set provision tank.passphrase (!env)`,
        )
      }
    }
  }

  report.finish()
}
