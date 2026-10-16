/**
 * Init-profile → platform capability names.
 * Resolved through the loaded platform's `packages` map (open vocabulary).
 *
 * Storage caps come from seed `disks.json`: each `disks.data.*.fs` + `zfs` iff tanks.
 */

/** @import { DisksPackageHints, InitProfile } from '@qctl/shared' */

/**
 * @typedef {object} CapabilitiesForProfileOpts
 * @property {string} [vcs]
 * @property {DisksPackageHints | null} [disks]
 */

/**
 * @param {InitProfile | string} profile
 * @param {CapabilitiesForProfileOpts} [opts]
 * @returns {string[]}
 */
export function capabilitiesForProfile(profile, opts = {}) {
  /** @type {string[]} */
  const caps = ['curl', 'jq', 'unzip']

  const disks = opts.disks
  if (disks) {
    for (const fs of disks.filesystems) {
      if (!caps.includes(fs)) caps.push(fs)
    }
    if (disks.hasTanks && !caps.includes('zfs')) caps.push('zfs')
  }

  if (profile === 'init-tank') return caps

  caps.push('podman', 'firewalld', 'openssh', 'qemu-guest-agent', 'cockpit')
  // hg → mercurial (needs pipx + declares pipx packages in the platform map)
  if (opts.vcs === 'hg') caps.push('mercurial')
  else caps.push('git')
  return caps
}
