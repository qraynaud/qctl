/**
 * Provision topology → seed artifacts (cloud-init network-config + Podman VLAN env).
 * OS-specific apply (nmcli / firewalld DNAT) lives on the staged platform module.
 */
import YAML from 'yaml'

/**
 * Podman / host VLAN env lines from secrets networking.vlans:
 *   vlan2 → VLAN2_PARENT=vlan2
 *   vlan2 + ipv4 → VLAN2_IPV4=10.0.2.2
 * @param {{ name: string, ipv4?: string | null }[]} vlans
 * @returns {string[]}
 */
export function vlanParentEnvLines(vlans) {
  const lines = []
  for (const v of vlans) {
    const m = /^vlan(\d+)$/i.exec(v.name)
    if (!m) continue
    lines.push(`VLAN${m[1]}_PARENT=${v.name}`)
    if (v.ipv4) lines.push(`VLAN${m[1]}_IPV4=${v.ipv4}`)
  }
  return lines
}

/**
 * @typedef {{ dhcp4: boolean, dhcp6: boolean, 'accept-ra': boolean }} NetplanEthernet
 * @typedef {{ version: 2, ethernets: Record<string, NetplanEthernet> }} NetplanConfigV2
 */

/**
 * NoCloud network-config v2 — uplinks only.
 *
 * Do NOT emit 802.1Q here: on local libvirt/passt, a VLAN subiface on eth0
 * wedges hostfwd (SSH banner hangs / frozen TTY). Macvlan parents are created
 * as dummy ifaces from vlan-parents.env (see user-data bootcmd).
 *
 * @param {{ name: string, dhcp4: boolean }[]} uplinks
 * @param {{ name: string, id: number, link: string }[]} [_vlans] kept for API compat
 */
export function renderNetworkConfigV2(uplinks, _vlans = []) {
  /** @type {NetplanConfigV2} */
  const doc = {
    version: 2,
    ethernets: {},
  }
  for (const u of uplinks) {
    doc.ethernets[u.name] = {
      dhcp4: u.dhcp4,
      dhcp6: false,
      'accept-ra': false,
    }
  }
  return YAML.stringify(doc, { lineWidth: 0 })
}
