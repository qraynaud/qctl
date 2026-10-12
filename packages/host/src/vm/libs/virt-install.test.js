import { DATA_COUNT, SPECIAL_COUNT } from '../../lib/paths.js'
import { buildVirtInstallArgs } from './virt-install.js'
import { describe, expect, test } from 'bun:test'

describe('buildVirtInstallArgs', () => {
  test('builds virt-install argv with disks and serial tcp', () => {
    const disks = {
      dir: '/vms/rocky',
      os: '/vms/rocky/os.qcow2',
      vw: '/vms/rocky/vw.qcow2',
      data: Array.from({ length: DATA_COUNT }, (_, i) => `/vms/rocky/data${i}.qcow2`),
      special: Array.from({ length: SPECIAL_COUNT }, (_, i) => `/vms/rocky/special${i}.qcow2`),
    }
    const args = buildVirtInstallArgs({
      connect: 'qemu:///system',
      name: 'rocky',
      memory: 4096,
      vcpus: 2,
      disks,
      seed: { device: 'cdrom', path: '/seed.iso' },
      ports: [{ name: 'ssh', port: 22, forward: 2222, dnat: null }],
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
  })
})
