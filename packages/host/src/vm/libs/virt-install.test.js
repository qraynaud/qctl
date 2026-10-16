import * as paths from '../../lib/paths.js'
import { resolveDisks } from '../../provision/schema/resolve-disks.js'
import { vmPaths } from './disks.js'
import { buildVirtInstallArgs } from './virt-install.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  paths.getVms.mockRestore?.()
})

describe('buildVirtInstallArgs', () => {
  test('builds virt-install argv with disks and serial tcp', () => {
    spyOn(paths, 'getVms').mockReturnValue('/vms')
    const resolved = resolveDisks(
      {
        os: { id: 'os', size: '20G' },
        data: { vw: { id: 'vw', mount: '/vw', fs: 'xfs', size: '2G' } },
        tanks: {
          tank: {
            id: 'tank',
            mount: '/tank',
            options: {
              pool: { ashift: 12, autotrim: 'off', autoexpand: 'on', failmode: 'continue' },
              dataset: { compression: 'lz4', atime: 'off', xattr: 'sa', special_small_blocks: 0 },
              acl: { acltype: 'posix', aclmode: 'passthrough', aclinherit: 'passthrough' },
            },
            vdevs: {
              data0: {
                role: 'data',
                type: 'single',
                members: { 'rocky-data0': { id: 'rocky-data0', size: '2G' } },
              },
            },
          },
        },
      },
      {
        filesystems: ['xfs', 'ext4'],
        defaultFs: 'xfs',
        osDisk: { id: 'os', size: '20G' },
      },
    )
    const disks = vmPaths('rocky', resolved)
    const args = buildVirtInstallArgs({
      connect: 'qemu:///system',
      name: 'rocky',
      memory: 4096,
      vcpus: 2,
      disks,
      seed: { device: 'cdrom', path: '/seed.iso' },
      ports: {
        ssh: { port: 22, forward: 2222 },
        cockpit: { port: 9090, forward: 9090 },
      },
      network: 'default',
      osinfo: 'rocky9',
      serialTcpPort: 5555,
    })
    expect(args[0]).toBe('virt-install')
    expect(args).toContain('--name')
    expect(args).toContain('rocky')
    expect(args).toContain('--network')
    expect(args).toContain('network=default,model=virtio')
    expect(args.join(' ')).toMatch(/tcp,host=127\.0\.0\.1:5555/)
    expect(args.join(' ')).toMatch(/device=cdrom/)
    expect(args.join(' ')).toMatch(/serial=vw/)
    expect(args.join(' ')).toMatch(/serial=rocky-data0/)
    expect(args).toContain('--tpm')
    expect(args).toContain('backend.type=emulator,backend.version=2.0,model=tpm-crb')
  })

  test('bootDiskPath is first disk with boot.order=1 (init-tank)', () => {
    spyOn(paths, 'getVms').mockReturnValue('/vms')
    const resolved = resolveDisks(
      {
        os: { id: 'os', size: '20G' },
        data: { vw: { id: 'vw', mount: '/vw', fs: 'xfs', size: '2G' } },
        tanks: {},
      },
      {
        filesystems: ['xfs', 'ext4'],
        defaultFs: 'xfs',
        osDisk: { id: 'os', size: '20G' },
      },
    )
    const disks = vmPaths('rocky', resolved)
    const args = buildVirtInstallArgs({
      connect: 'qemu:///system',
      name: 'rocky',
      memory: 2048,
      vcpus: 2,
      disks,
      seed: { device: 'cdrom', path: '/seed.iso' },
      ports: {
        ssh: { port: 22, forward: 2222 },
        cockpit: { port: 9090, forward: 9090 },
      },
      network: 'default',
      osinfo: 'rocky9',
      bootDiskPath: '/vms/rocky/init-tank-boot.qcow2',
    })
    const joined = args.join(' ')
    expect(joined).toContain('path=/vms/rocky/init-tank-boot.qcow2')
    expect(joined).toContain('boot.order=1')
    expect(joined).not.toContain('path=/vms/rocky/os.qcow2')
    expect(joined).toMatch(/serial=vw/)
  })
})
