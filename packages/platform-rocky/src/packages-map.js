/**
 * Rocky Linux capability → package recipes (open map; guest resolves by name).
 * `distro` → platform.installPackages; `pipx` → guest installs after.
 */
import { MERCURIAL_PIPX_DEFAULT } from '@qctl/shared/packages/mercurial'

/** @import { PlatformPackagesMap } from '@qctl/shared' */

/** @type {PlatformPackagesMap} */
export const rockyPackagesMap = {
  curl: { distro: ['curl'] },
  jq: { distro: ['jq'] },
  unzip: { distro: ['unzip'] },
  pipx: { distro: ['pipx'] },
  git: { distro: ['git'] },
  mercurial: {
    needs: ['pipx'],
    pipx: [{ package: MERCURIAL_PIPX_DEFAULT.package, inject: [...MERCURIAL_PIPX_DEFAULT.inject] }],
  },
  /** ZoL setup is handled inside `installPackages` when `zfs` is in the list. */
  zfs: { distro: ['zfs'] },
  xfsprogs: { distro: ['xfsprogs'] },
  podman: { distro: ['podman'] },
  firewalld: { distro: ['firewalld'] },
  openssh: { distro: ['openssh-server'] },
  'qemu-guest-agent': { distro: ['qemu-guest-agent'] },
  cockpit: {
    distro: ['cockpit', 'cockpit-podman', 'cockpit-packagekit', 'cockpit-system'],
  },
}
