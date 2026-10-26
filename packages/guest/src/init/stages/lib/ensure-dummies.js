/**
 * Ensure `type: dummy` ifaces from seed networking.interfaces.
 * Devices are ephemeral without a boot oneshot — install list + unit.
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises'

import { dummyIfaceNames } from '@qctl/shared'

/** @import { SeedConfig, SeedInterfaces } from '@qctl/shared' */
/** @import { StageContext } from '../../context.js' */

export const ENSURE_DUMMIES_UNIT = 'qctl-ensure-dummies.service'
export const ENSURE_DUMMIES_SCRIPT = '/usr/local/lib/qctl/ensure-dummies.sh'
export const DUMMIES_LIST_DEFAULT = '/usr/local/lib/qctl/dummies.list'

/** Legacy unit from pre-interfaces vlan-parents stage. */
export const LEGACY_VLAN_PARENTS_UNIT = 'qctl-vlan-parents.service'

/**
 * Dummy iface names from stage/seed interfaces (sorted).
 * @param {SeedInterfaces | undefined} interfaces
 * @returns {string[]}
 */
export function dummyNamesFromSeed(interfaces) {
  return dummyIfaceNames(interfaces || {})
}

/**
 * @param {StageContext} ctx
 * @param {string[]} names
 */
export async function ensureDummyIfaces(ctx, names) {
  for (const name of names) {
    const show = await ctx.exec(['ip', 'link', 'show', 'dev', name])
    if (show.code !== 0) {
      ctx.log(`ensure-dummies: creating dummy ${name}`)
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
 * Shell oneshot: recreate dummy ifaces listed in dummies.list every boot.
 * @param {string} listPath
 * @returns {string}
 */
export function ensureDummiesScript(listPath) {
  return `#!/usr/bin/env bash
# Recreate seed type:dummy ifaces from ${listPath}.
set -euo pipefail
LIST_FILE="${listPath}"
[[ -f "$LIST_FILE" ]] || exit 0
while IFS= read -r name || [[ -n "$name" ]]; do
  [[ "$name" =~ ^[[:space:]]*# ]] && continue
  name="\${name%%#*}"
  name="\${name#"\${name%%[![:space:]]*}"}"
  name="\${name%"\${name##*[![:space:]]}"}"
  [[ -n "$name" ]] || continue
  if ! ip link show dev "$name" >/dev/null 2>&1; then
    ip link add "$name" type dummy
  fi
  ip link set dev "$name" up || true
done < "$LIST_FILE"
`
}

/**
 * @param {string} scriptPath
 * @returns {string}
 */
export function ensureDummiesUnitText(scriptPath) {
  return `[Unit]
Description=Ensure seed dummy interfaces (qctl dummies.list)
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
 * Apply dummies now + install persistent boot unit from seed networking.interfaces.
 *
 * @param {StageContext} ctx
 * @returns {Promise<string[]>} dummy names ensured
 */
export async function installEnsureDummiesFromSeed(ctx) {
  const interfaces =
    ctx.interfaces
    ?? /** @type {SeedConfig | undefined} */ (ctx.seedConfig)?.networking?.interfaces
    ?? {}
  const names = dummyNamesFromSeed(interfaces)
  await ensureDummyIfaces(ctx, names)

  const listPath = DUMMIES_LIST_DEFAULT
  const scriptPath = ENSURE_DUMMIES_SCRIPT
  await mkdir('/usr/local/lib/qctl', { recursive: true })
  await writeFile(listPath, names.length ? `${names.join('\n')}\n` : '', { mode: 0o644 })
  await writeFile(scriptPath, ensureDummiesScript(listPath), { mode: 0o755 })
  await chmod(scriptPath, 0o755)

  const unitPath = `/etc/systemd/system/${ENSURE_DUMMIES_UNIT}`
  await writeFile(unitPath, ensureDummiesUnitText(scriptPath), { mode: 0o644 })
  const reload = await ctx.exec(['systemctl', 'daemon-reload'])
  if (reload.code !== 0) {
    throw new Error(`systemctl daemon-reload failed: ${reload.stderr.trim()}`)
  }
  // Best-effort: drop legacy vlan-parents oneshot if present.
  await ctx.exec(['systemctl', 'disable', '--now', LEGACY_VLAN_PARENTS_UNIT])
  const enable = await ctx.exec(['systemctl', 'enable', '--now', ENSURE_DUMMIES_UNIT])
  if (enable.code !== 0) {
    throw new Error(
      `systemctl enable --now ${ENSURE_DUMMIES_UNIT} failed: ${enable.stderr.trim() || enable.stdout.trim()}`,
    )
  }
  if (names.length) {
    ctx.log(`ensure-dummies: ensured ${names.join(', ')} + ${ENSURE_DUMMIES_UNIT}`)
  } else {
    ctx.log(`ensure-dummies: no type:dummy ifaces in seed; ${ENSURE_DUMMIES_UNIT} installed`)
  }
  return names
}
