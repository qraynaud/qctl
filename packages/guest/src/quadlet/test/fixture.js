/**
 * Temp instance + fake system for quadlet tests.
 */
import { join } from 'node:path'

import {
  makeTempDir,
  removeTempDir,
  writeFile,
  writeMinimalInstance,
} from '../../../../shared/src/test-helpers.js'
import { createContext } from '../context.js'
import { createFakeSystem } from './fake-system.js'

/**
 * Package-root `.env.schema`: import repo root + local keys.
 * Local `.env.<QCTL_ENV>` autoloads via `currentEnvFallback`.
 * @param {string[]} [extra] schema lines after the `# ---` separator
 * @returns {string}
 */
export function packageSchema(extra = []) {
  /** @type {string[]} */
  const body = []
  for (const line of extra) {
    if (line.startsWith('#') || line === '') {
      body.push(line)
      continue
    }
    body.push('# @public', line)
  }
  return ['# @import(../../)', '# ---', ...body, ''].join('\n')
}

/**
 * Unit `.env.schema` (imports repo root).
 * @param {string[]} [extra]
 * @returns {string}
 */
export function unitSchema(extra = []) {
  /** @type {string[]} */
  const body = []
  for (let i = 0; i < extra.length; i++) {
    const line = extra[i]
    if (line.startsWith('#') || line === '') {
      body.push(line)
      continue
    }
    // Preceding `# @sensitive` marks a secret key — do not wrap with @public.
    const prev = extra[i - 1]
    if (prev?.includes('@sensitive')) {
      body.push(line)
      continue
    }
    body.push('# @public', line)
  }
  return ['# @import(../../../)', '# ---', ...body, ''].join('\n')
}

/**
 * Instance with: proxy (rootless) ← web (rootless, companion dbroot) ; dbroot (rootful);
 * shared bridge network (rootless) + lan macvlan network (rootful).
 * @returns {{ root: string, sysDir: string }}
 */
export function makeQuadletInstance() {
  const root = makeTempDir()
  const sysDir = makeTempDir()
  writeMinimalInstance(root, { withEnvRefs: false, withSchema: false, withOverlay: false })

  // Repo root: schema imports `.env.<QCTL_ENV>` by explicit path; every key is @internal.
  writeFile(
    root,
    '.env.schema',
    [
      '# @import(./.env.dev, enabled=eq($QCTL_ENV, "dev"))',
      '# @import(./.env.prod, enabled=eq($QCTL_ENV, "prod"))',
      '# ---',
      '# @type=enum(dev, prod)',
      '# @public',
      'QCTL_ENV=dev',
      ...['ENV', 'FQDN', 'APPS_UID', 'TANK_ROOT'].flatMap((k) => ['# @internal @public', `${k}=`]),
      '# @sensitive',
      'VW_CLIENT_SECRET=root-only-secret-value',
      '',
    ].join('\n'),
  )
  writeFile(root, '.env.dev', 'ENV=dev\nFQDN=x.localhost\nAPPS_UID=1000\nTANK_ROOT=./volumes\n')
  writeFile(root, '.env.prod', 'ENV=prod\nFQDN=x.eu\nAPPS_UID=900\nTANK_ROOT=/tank/apps\n')
  writeFile(root, '.env', 'ENV=dev\n')

  writeFile(root, 'applications/proxy/app.yaml', 'engine: rootless\n')
  writeFile(root, 'applications/proxy/.env.schema', packageSchema(['VERSION=']))
  writeFile(root, 'applications/proxy/.env.dev', 'VERSION=1.0\n')
  writeFile(
    root,
    'applications/proxy/proxy/proxy.container',
    '[Unit]\nDescription=proxy\n[Container]\nImage=img/proxy:${VERSION}\nContainerName=proxy\nNetwork=shared.network\n',
  )

  writeFile(
    root,
    'applications/web/app.yaml',
    'engine: rootless\ncompanions:\n  - dbroot # cross-engine\n',
  )
  writeFile(root, 'applications/web/.env.schema', packageSchema(['VERSION=']))
  writeFile(root, 'applications/web/.env.dev', 'VERSION=2.0-dev\n')
  writeFile(root, 'applications/web/.env.prod', 'VERSION=2.0\n')
  writeFile(root, 'applications/web/web.network', '[Network]\nSubnet=10.9.0.0/24\n')
  writeFile(
    root,
    'applications/web/web/web.container',
    [
      '[Unit]',
      'After=network-online.target proxy.service',
      'Requires=proxy.service',
      '[Container]',
      'Image=img/web:${VERSION}',
      'ContainerName=web',
      'Network=web.network',
      'Network=shared.network:ip=10.0.0.2',
      'Volume=${TANK_ROOT}/web:/data',
      'EnvironmentFile=.env',
      'Label=host=${FQDN}',
      '',
    ].join('\n'),
  )
  writeFile(root, 'applications/web/web/.env.schema', unitSchema(['A=', 'B=', 'C=']))
  writeFile(root, 'applications/web/web/.env.dev', 'A=2\nB=${FQDN}\nC=3\n')
  writeFile(root, 'applications/web/web/.env.prod', 'A=1\nB=${FQDN}\n')

  writeFile(root, 'applications/dbroot/app.yaml', 'engine: rootful\n')
  writeFile(root, 'applications/dbroot/.env.schema', packageSchema())
  writeFile(
    root,
    'applications/dbroot/dbroot/dbroot.container',
    '[Container]\nImage=img/db\nContainerName=dbroot\nNetwork=lan.network\n',
  )

  writeFile(root, 'networks/shared/shared.network', '[Network]\nSubnet=10.0.0.0/24\n')
  writeFile(
    root,
    'networks/lan/lan.network',
    '[Network]\nDriver=macvlan\nOptions=parent=${LAN_PARENT}\n',
  )
  writeFile(root, 'networks/lan/.env.schema', packageSchema(['LAN_PARENT=']))
  writeFile(root, 'networks/lan/.env.dev', 'LAN_PARENT=eth9\n')
  return { root, sysDir }
}

/**
 * @param {{ root: string, sysDir: string }} fx
 */
export function cleanupQuadletFixture(fx) {
  removeTempDir(fx.root)
  removeTempDir(fx.sysDir)
}

/**
 * @param {{ root: string, sysDir: string }} fx
 * @param {Parameters<typeof createFakeSystem>[0]['respond']} [respond]
 */
export function makeContext(fx, respond) {
  const sys = createFakeSystem({ dir: fx.sysDir, respond })
  /** @type {string[]} */
  const out = []
  const ctx = createContext({
    root: fx.root,
    sys,
    baseEnv: { PATH: process.env.PATH },
    seedDir: join(fx.sysDir, 'seed'),
    log: (m) => out.push(`quadlet: ${m}`),
    print: (m) => out.push(m),
  })
  return { ctx, sys, out }
}
