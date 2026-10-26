import * as paths from '../../lib/paths.js'
import { VM_ATTACH_MODE } from '../../provision/schema/networking.js'
import { resolveDisks } from '../../provision/schema/resolve-disks.js'
import { toInitTankDiskPlan, toVmDiskPlan } from './disk-plan.js'
import { buildVirtInstallArgs } from './virt-install.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

const ports = {
  ssh: { port: 22, forward: 2222 },
  cockpit: { port: 9090, forward: 9090 },
}

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
    const disks = toVmDiskPlan('rocky', resolved, { baseOsImage: '/base.qcow2' })
    const args = buildVirtInstallArgs({
      connect: 'qemu:///system',
      name: 'rocky',
      memory: 4096,
      vcpus: 2,
      disks,
      seed: { device: 'cdrom', path: '/seed.iso' },
      ports,
      osinfo: 'rocky10',
      serialTcpPort: 5555,
    })
    expect(args[0]).toBe('virt-install')
    expect(args).toContain('--name')
    expect(args).toContain('rocky')
    expect(args).toContain('--network')
    expect(args.join(' ')).toMatch(/passt|user/)
    expect(args.join(' ')).toMatch(/tcp,host=127\.0\.0\.1:5555/)
    expect(args.join(' ')).toMatch(/device=cdrom/)
    expect(args.join(' ')).toMatch(/serial=vw/)
    expect(args.join(' ')).toMatch(/serial=rocky-data0/)
    expect(args).toContain('--tpm')
    expect(args).toContain('backend.type=emulator,backend.version=2.0,model=tpm-crb')
  })

  test('init-tank plan boots disposable disk first', () => {
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
    const disks = toInitTankDiskPlan('rocky', resolved, {
      baseOsImage: '/base.qcow2',
      bootDiskPath: '/vms/rocky/init-tank-boot.qcow2',
    })
    const args = buildVirtInstallArgs({
      connect: 'qemu:///system',
      name: 'rocky',
      memory: 2048,
      vcpus: 2,
      disks,
      seed: { device: 'cdrom', path: '/seed.iso' },
      ports,
      osinfo: 'rocky10',
    })
    const joined = args.join(' ')
    expect(joined).toContain('path=/vms/rocky/init-tank-boot.qcow2')
    expect(joined).toContain('boot.order=1')
    expect(joined).not.toContain('path=/vms/rocky/os.qcow2')
    expect(joined).toMatch(/serial=vw/)
  })

  test('bridged nics → --network bridge=… in label order', () => {
    spyOn(paths, 'getVms').mockReturnValue('/vms')
    const resolved = resolveDisks(
      { os: { id: 'os', size: '20G' }, data: {}, tanks: {} },
      {
        filesystems: ['xfs', 'ext4'],
        defaultFs: 'xfs',
        osDisk: { id: 'os', size: '20G' },
      },
    )
    const disks = toVmDiskPlan('rocky', resolved, { baseOsImage: '/base.qcow2' })
    const args = buildVirtInstallArgs({
      connect: 'qemu:///system',
      name: 'rocky',
      memory: 2048,
      vcpus: 2,
      disks,
      seed: { device: 'cdrom', path: '/seed.iso' },
      ports,
      osinfo: 'rocky10',
      nics: {
        zed: { iface: 'eth1', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'br1' },
        main: { iface: 'eth0', mode: VM_ATTACH_MODE.BRIDGE, bridge: 'br0' },
      },
    })
    const joined = args.join(' ')
    expect(joined).toContain('bridge=br0,model=virtio,target=eth0')
    expect(joined).toContain('bridge=br1,model=virtio,target=eth1')
    expect(joined.indexOf('bridge=br0')).toBeLessThan(joined.indexOf('bridge=br1'))
  })
})
