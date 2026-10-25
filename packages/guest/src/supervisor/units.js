/**
 * systemd unit templates: qctl-supervisor + cross-engine `qctl-app@` proxies.
 */

export const QCTL_SUPERVISOR_UNIT = 'qctl-supervisor.service'
export const QCTL_APP_PROXY_UNIT = 'qctl-app@.service'

/** Default installed guest CLI path (cloud-init / sync-from-iso). */
export const QCTL_BIN_DEFAULT = '/usr/local/bin/qctl'

/**
 * @param {{ qctlBin?: string }} [opts]
 * @returns {string}
 */
export function qctlSupervisorUnitText(opts = {}) {
  const qctl = opts.qctlBin?.trim() || QCTL_BIN_DEFAULT
  return `# Managed by qctl — dual-socket supervisor (apps + admin)
[Unit]
Description=qctl supervisor (apps + admin sockets)
Documentation=https://github.com/qctl/qctl
After=local-fs.target network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${qctl} _internal_supervisor
Restart=on-failure
RestartSec=2
RuntimeDirectory=qctl
RuntimeDirectoryMode=0755

[Install]
WantedBy=multi-user.target
`
}

/**
 * @param {{ qctlBin?: string }} [opts]
 * @returns {string}
 */
export function qctlAppProxyUnitText(opts = {}) {
  const qctl = opts.qctlBin?.trim() || QCTL_BIN_DEFAULT
  return `# Managed by qctl — cross-engine dependency proxy for applications/%i
[Unit]
Description=qctl app proxy (%i)
Documentation=https://github.com/qctl/qctl
Wants=qctl-supervisor.service
After=qctl-supervisor.service

[Service]
Type=notify
# Bun cannot sd_notify via unix_dgram; we shell out to systemd-notify (child PID).
NotifyAccess=all
ExecStart=${qctl} _internal_app_proxy %i
ExecStop=${qctl} _internal_app_proxy --release %i
# Main exits non-zero when the peer stamp clears/fails so Requires=/BindsTo= tear down.
Restart=no

[Install]
WantedBy=multi-user.target
`
}

/**
 * @param {{
 *   writeFile: (path: string, body: string) => void | Promise<void>,
 *   mkdir: (path: string) => void | Promise<void>,
 *   systemctl: (args: string[]) => { status: number, stdout?: string, stderr?: string } | Promise<{ status: number }>,
 *   systemUnitDir?: string,
 *   qctlBin?: string,
 *   log?: (line: string) => void,
 * }} opts
 */
export async function installQctlSupervisorUnit(opts) {
  const log = opts.log ?? (() => {})
  const systemDir = opts.systemUnitDir ?? '/etc/systemd/system'
  const body = qctlSupervisorUnitText({ qctlBin: opts.qctlBin })
  const systemPath = `${systemDir.replace(/\/+$/, '')}/${QCTL_SUPERVISOR_UNIT}`

  await opts.mkdir(systemDir)
  await opts.writeFile(systemPath, body)
  log(`qctl-supervisor: installed ${systemPath}`)

  const sys = await opts.systemctl(['daemon-reload'])
  if (sys.status !== 0) {
    throw new Error(`systemctl daemon-reload failed (status ${sys.status})`)
  }
  log('qctl-supervisor: daemon-reload')
}

/**
 * Install `qctl-app@.service` for system + user buses and daemon-reload both.
 *
 * @param {{
 *   writeFile: (path: string, body: string) => void | Promise<void>,
 *   mkdir: (path: string) => void | Promise<void>,
 *   systemctl: (args: string[]) => { status: number, stdout?: string, stderr?: string } | Promise<{ status: number }>,
 *   systemctlUser: (args: string[]) => { status: number } | Promise<{ status: number }>,
 *   systemUnitDir?: string,
 *   userUnitDir?: string,
 *   qctlBin?: string,
 *   log?: (line: string) => void,
 * }} opts
 */
export async function installQctlAppProxyUnits(opts) {
  const log = opts.log ?? (() => {})
  const systemDir = opts.systemUnitDir ?? '/etc/systemd/system'
  const userDir = opts.userUnitDir ?? '/etc/systemd/user'
  const body = qctlAppProxyUnitText({ qctlBin: opts.qctlBin })
  const systemPath = `${systemDir.replace(/\/+$/, '')}/${QCTL_APP_PROXY_UNIT}`
  const userPath = `${userDir.replace(/\/+$/, '')}/${QCTL_APP_PROXY_UNIT}`

  await opts.mkdir(systemDir)
  await opts.mkdir(userDir)
  await opts.writeFile(systemPath, body)
  await opts.writeFile(userPath, body)
  log(`qctl-app@: installed ${systemPath}`)
  log(`qctl-app@: installed ${userPath}`)

  const sys = await opts.systemctl(['daemon-reload'])
  if (sys.status !== 0) {
    throw new Error(`systemctl daemon-reload failed (status ${sys.status})`)
  }
  const user = await opts.systemctlUser(['daemon-reload'])
  if (user.status !== 0) {
    throw new Error(`systemctl --user daemon-reload failed (status ${user.status})`)
  }
  log('qctl-app@: daemon-reload (system + user)')
}
