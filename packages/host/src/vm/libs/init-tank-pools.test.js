import { diskMounts, disksSchema } from '../../provision/schema/disks.js'
import { resolveDisks } from '../../provision/schema/resolve-disks.js'
import { allTankPoolIds, resolveInitTankPools, tankMembersForPools } from './init-tank-pools.js'
import { beforeEach, describe, expect, spyOn, test } from 'bun:test'

const platform = {
  filesystems: /** @type {const} */ (['xfs']),
  defaultFs: 'xfs',
  osDisk: { id: 'os', size: '20G' },
}

beforeEach(() => {
  diskMounts.clear()
})

function sampleResolved() {
  return resolveDisks(
    disksSchema.parse({
      os: { id: 'os', size: '20G' },
      data: { vw: { mount: '/vw', size: '2G' } },
      tanks: {
        tank: {
          mount: '/tank',
          passphrase: 'a',
          vdevs: {
            data0: {
              role: 'data',
              type: 'single',
              members: { 'rocky-data0': { size: '2G' } },
            },
          },
        },
        cold: {
          mount: '/cold',
          passphrase: 'b',
          vdevs: {
            data0: {
              role: 'data',
              type: 'single',
              members: { 'rocky-cold0': { size: '2G' } },
            },
          },
        },
      },
    }),
    platform,
  )
}

describe('init-tank-pools', () => {
  test('bare selects all pool ids', () => {
    const resolved = sampleResolved()
    const sel = resolveInitTankPools(resolved, undefined)
    expect(sel).not.toBeNull()
    expect(sel?.poolIds).toEqual(['tank', 'cold'])
    expect(sel?.memberIds.sort()).toEqual(['rocky-cold0', 'rocky-data0'])
  })

  test('explicit ids select a subset', () => {
    const resolved = sampleResolved()
    const sel = resolveInitTankPools(resolved, ['cold'])
    expect(sel?.poolIds).toEqual(['cold'])
    expect(tankMembersForPools(resolved, sel?.poolIds || []).map((m) => m.id)).toEqual([
      'rocky-cold0',
    ])
  })

  test('unknown pool id dies', () => {
    const resolved = sampleResolved()
    const exit = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`)
    })
    try {
      expect(() => resolveInitTankPools(resolved, ['nope'])).toThrow(/exit 1/)
    } finally {
      exit.mockRestore()
    }
  })

  test('no tanks returns null', () => {
    const resolved = resolveDisks(
      disksSchema.parse({
        os: { id: 'os', size: '20G' },
        data: { vw: { mount: '/vw', size: '2G' } },
      }),
      platform,
    )
    expect(allTankPoolIds(resolved)).toEqual([])
    expect(resolveInitTankPools(resolved, [])).toBeNull()
  })
})
