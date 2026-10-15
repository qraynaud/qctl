import { portsSchema } from '../provision/schema/index.js'
import { localPublishPodmanArgs, localPublishPorts } from './ports-publish.js'
import { describe, expect, test } from 'bun:test'

/** @import { PortsMap } from '../vm/types.js' */

/** @type {PortsMap} */
const SAMPLE = {
  ssh: { port: 22, forward: 2222 },
  cockpit: { port: 9090, forward: 9090 },
  http: { port: 80, forward: 8088, dnat: 8088 },
  https: { port: 443, forward: 8443, dnat: 8443 },
  extra: { port: 9000, forward: 9001 },
}

describe('localPublishPorts', () => {
  test('skips ssh and cockpit; uses dnat ?? forward for container port', () => {
    expect(localPublishPorts(SAMPLE)).toEqual([
      { name: 'http', host: 8088, container: 8088 },
      { name: 'https', host: 8443, container: 8443 },
      { name: 'extra', host: 9001, container: 9001 },
    ])
  })

  test('podman -p args bind 127.0.0.1', () => {
    expect(localPublishPodmanArgs(SAMPLE)).toEqual([
      '-p',
      '127.0.0.1:8088:8088',
      '-p',
      '127.0.0.1:8443:8443',
      '-p',
      '127.0.0.1:9001:9001',
    ])
  })

  test('ignores entries without forward', () => {
    expect(localPublishPorts(portsSchema.parse({ http: { port: 80, dnat: 8088 } }))).toEqual([])
  })
})
