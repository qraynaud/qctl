/**
 * Rocky Linux capability → package recipes (open map; guest resolves by name).
 * `distro` → platform.installPackages; `pipx` → guest installs after.
 *
 * Filesystem capabilities use FS names (`xfs`, `ext4`). `xfsprogs` remains as a
 * legacy alias (`needs: ['xfs']`) until guest profiles request `xfs` directly.
 */

import { MERCURIAL_PIPX_DEFAULT } from '@qctl/shared/packages/mercurial'
import { definePackagesMap } from '@qctl/shared/platform/define'

export const rockyPackagesMap = definePackagesMap({
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
  xfs: { distro: ['xfsprogs'] },
  ext4: { distro: ['e2fsprogs'] },
  /** @deprecated Prefer capability `xfs`; kept for guest init profiles. */
  xfsprogs: { needs: ['xfs'] },
  podman: { distro: ['podman'] },
  firewalld: { distro: ['firewalld'] },
  openssh: { distro: ['openssh-server'] },
  'qemu-guest-agent': { distro: ['qemu-guest-agent'] },
  cockpit: {
    distro: ['cockpit', 'cockpit-podman', 'cockpit-packagekit', 'cockpit-system'],
  },
})
