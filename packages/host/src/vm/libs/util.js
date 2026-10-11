import { $, chalk } from 'zx'

export const HOST_DEPS = `Host packages (CachyOS / Arch example):
  sudo pacman -S qemu-base virt-install libvirt dnsmasq
  sudo systemctl enable --now libvirtd
  sudo usermod -aG libvirt "$USER"   # re-login afterward
  virsh -c qemu:///system net-start default
  virsh -c qemu:///system net-autostart default
  # qemu:///system needs traverse on $HOME when disks live under ~/…
  setfacl -m u:libvirt-qemu:--x "$HOME"
  # If guests get link-local only (no 192.168.122.x), Docker/nft may be eating DHCP:
  #   sudo nft list ruleset | less
  #   sudo iptables -L FORWARD -n -v | head
  # Workaround: qctl vm up --network user --wipe-os
  #   then: ssh -p 2222 <admin>@127.0.0.1   # VW Login rocky username
Prefer qemu:///system + default NAT network for SSH via DHCP leases.`

/**
 * @param {string} msg
 * @returns {never}
 */
export function die(msg) {
  console.error(chalk.red(`vm: ${msg}`))
  process.exit(1)
  throw new Error('unreachable')
}

/**
 * @param {string} bin
 * @returns {Promise<string | null>}
 */
export async function which(bin) {
  const r = await $`command -v ${bin}`.nothrow()
  return r.exitCode === 0 ? String(r.stdout).trim() : null
}

/**
 * @param {readonly string[]} bins
 * @returns {Promise<void>}
 */
export async function requireBins(bins) {
  /** @type {string[]} */
  const missing = []
  for (const b of bins) {
    if (!(await which(b))) missing.push(b)
  }
  if (missing.length) {
    die(`missing command(s): ${missing.join(', ')}\n\n${HOST_DEPS}`)
  }
}

/**
 * @param {unknown} err caught value (catch edge — narrowed to Error here)
 * @returns {string}
 */
export function errMessage(err) {
  return err instanceof Error ? err.message : String(err)
}
