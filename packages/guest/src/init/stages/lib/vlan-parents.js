/**
 * Lab VLAN dummy parents from seed {@link SeedConfig.vlanParents}.
 * Cloud-init bootcmd used to create these once; they are not persistent —
 * install a boot oneshot + apply now from the same map.
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises'

/** @import { SeedConfig } from '@qctl/shared' */
/** @import { StageContext } from '../../context.js' */

export const VLAN_PARENTS_UNIT = 'qctl-vlan-parents.service'
export const VLAN_PARENTS_SCRIPT = '/usr/local/lib/qctl/ensure-vlan-parents.sh'
export const VLAN_PARENTS_ENV_DEFAULT = '/usr/local/lib/rocky/vlan-parents.env'

/**
 * Lab dummy iface names from `VLAN*_PARENT=vlanN` entries.
 * Real parents (bond0, eth0.2, …) are left alone — only `vlan\d+` is synthesized.
 *
 * @param {Record<string, string>} vlanParents
 * @returns {string[]}
 */
export function labDummyParentsFromMap(vlanParents) {
  /** @type {string[]} */
  const out = []
  for (const [key, value] of Object.entries(vlanParents || {})) {
    if (!/^VLAN\d+_PARENT$/i.test(key)) continue
    const name = String(value || '').trim()
    if (/^vlan\d+$/i.test(name)) out.push(name)
  }
  return [...new Set(out)].sort()
}

/**
 * @param {StageContext} ctx
 * @param {string[]} names
 */
export async function ensureLabDummyParents(ctx, names) {
  for (const name of names) {
    const show = await ctx.exec(['ip', 'link', 'show', 'dev', name])
    if (show.code !== 0) {
      ctx.log(`vlan-parents: creating dummy ${name}`)
      const add = await ctx.exec(['ip', 'link', 'add', name, 'type', 'dummy'])
      if (add.code !== 0) {
        throw new Error(
          `ip link add ${name} type dummy failed: ${add.stderr.trim() || add.stdout.trim()}`,
        )
      }
    }
    await ctx.exec(['ip', 'link', 'set', 'dev', name, 'up'])
  }
}

/**
 * Shell oneshot body: recreate lab dummies from vlan-parents.env every boot.
 * @param {string} envPath
 * @returns {string}
 */
export function ensureVlanParentsScript(envPath) {
  return `#!/usr/bin/env bash
# Recreate lab VLAN dummy parents (vlanN) from seed vlan-parents.env.
# Real uplink parents are never synthesized here.
set -euo pipefail
ENV_FILE="${envPath}"
[[ -f "$ENV_FILE" ]] || exit 0
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" =~ ^VLAN[0-9]+_PARENT=(.*)$ ]] || continue
  parent="\${BASH_REMATCH[1]}"
  parent="\${parent%%#*}"
  parent="\${parent#"\${parent%%[![:space:]]*}"}"
  parent="\${parent%"\${parent##*[![:space:]]}"}"
  [[ "$parent" =~ ^[Vv]lan[0-9]+$ ]] || continue
  if ! ip link show dev "$parent" >/dev/null 2>&1; then
    ip link add "$parent" type dummy
  fi
  ip link set dev "$parent" up || true
done < "$ENV_FILE"
`
}

/**
 * @param {string} scriptPath
 * @returns {string}
 */
export function vlanParentsUnitText(scriptPath) {
  return `[Unit]
Description=Ensure lab VLAN dummy parents (qctl vlan-parents.env)
DefaultDependencies=no
After=systemd-udevd.service local-fs.target
Before=network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${scriptPath}

[Install]
WantedBy=multi-user.target
`
}

/**
 * Apply dummies now + install persistent boot unit from seed vlanParents.
 *
 * @param {StageContext} ctx
 * @returns {Promise<string[]>} dummy names ensured
 */
export async function installVlanParentsFromSeed(ctx) {
  const map = /** @type {SeedConfig | undefined} */ (ctx.seedConfig)?.vlanParents || {}
  const names = labDummyParentsFromMap(map)
  await ensureLabDummyParents(ctx, names)

  const envPath = VLAN_PARENTS_ENV_DEFAULT
  const scriptPath = VLAN_PARENTS_SCRIPT
  await mkdir('/usr/local/lib/qctl', { recursive: true })
  await writeFile(scriptPath, ensureVlanParentsScript(envPath), { mode: 0o755 })
  await chmod(scriptPath, 0o755)

  const unitPath = `/etc/systemd/system/${VLAN_PARENTS_UNIT}`
  await writeFile(unitPath, vlanParentsUnitText(scriptPath), { mode: 0o644 })
  const reload = await ctx.exec(['systemctl', 'daemon-reload'])
  if (reload.code !== 0) {
    throw new Error(`systemctl daemon-reload failed: ${reload.stderr.trim()}`)
  }
  const enable = await ctx.exec(['systemctl', 'enable', '--now', VLAN_PARENTS_UNIT])
  if (enable.code !== 0) {
    throw new Error(
      `systemctl enable --now ${VLAN_PARENTS_UNIT} failed: ${enable.stderr.trim() || enable.stdout.trim()}`,
    )
  }
  if (names.length) {
    ctx.log(`vlan-parents: ensured ${names.join(', ')} + ${VLAN_PARENTS_UNIT}`)
  } else {
    ctx.log(`vlan-parents: no lab dummy parents in seed; ${VLAN_PARENTS_UNIT} installed`)
  }
  return names
}
