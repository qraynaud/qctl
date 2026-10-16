import { firstBootCredentialsFromProvision, tankPassphraseCredName } from './first-boot.js'
import { provisionSchema } from './parse.js'
import { describe, expect, test } from 'bun:test'

describe('tankPassphraseCredName', () => {
  test('prefixes pool id', () => {
    expect(tankPassphraseCredName('tank')).toBe('tank_passphrase_tank')
    expect(tankPassphraseCredName('cold-pool')).toBe('tank_passphrase_cold-pool')
  })
})

describe('firstBootCredentialsFromProvision', () => {
  test('emits tank_passphrase_<poolId> per encrypted tank (not TANK_PASSPHRASE)', () => {
    const data = provisionSchema.parse({
      networking: {
        ports: { ssh: { port: 22 } },
        uplinks: { eth0: { dhcp4: true } },
      },
      disks: {
        data: { vw: { mount: '/vw' } },
        tanks: {
          tank: {
            mount: '/tank',
            passphrase: 'secret-a',
            vdevs: {
              data0: { role: 'data', type: 'single', members: { a: {} } },
            },
          },
          cold: {
            id: 'cold-pool',
            mount: '/cold',
            passphrase: Buffer.from('secret-b'),
            vdevs: {
              data0: { role: 'data', type: 'single', members: { b: {} } },
            },
          },
        },
      },
    })
    const creds = firstBootCredentialsFromProvision(data)
    expect(creds.TANK_PASSPHRASE).toBeUndefined()
    expect(creds.tank_passphrase_tank).toBe('secret-a')
    expect(creds['tank_passphrase_cold-pool']).toBe('secret-b')
    expect(data.disks?.tanks?.tank.passphrase).toBe('secret-a')
    expect(data.disks?.tanks?.cold.passphrase).toBe('secret-b')
  })
})
