import {
  classifyCloudInitOutcome,
  classifyContinueFirstBoot,
  classifyRebootReady,
  createSerialLineSink,
  matchInitTankFatal,
  startSerialTcpFollow,
  stripAnsi,
} from './console.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  process.stdout.write.mockRestore?.()
})

describe('console helpers', () => {
  test('stripAnsi removes CSI sequences', () => {
    expect(stripAnsi('\u001b[32mOK\u001b[0m')).toBe('OK')
  })

  test('matchInitTankFatal detects fatal patterns', () => {
    expect(matchInitTankFatal('rocky-init-tank: ERROR: boom')).toMatch(/ERROR/)
    expect(
      matchInitTankFatal('qctl _internal_init: stage data-mounts: no disk with serial "vw"'),
    ).toMatch(/data-mounts/)
    expect(matchInitTankFatal('qctl _internal_init: stage tier0-seal: missing pending')).toMatch(
      /tier0-seal/,
    )
    expect(matchInitTankFatal('stage tank-create: refusing to create')).toMatch(/tank-create/)
    expect(matchInitTankFatal('harmless line')).toBeNull()
  })

  test('classifyCloudInitOutcome ok and fail', () => {
    expect(classifyCloudInitOutcome('[  OK  ] Finished Cloud-init: Final Stage')).toEqual({
      status: 'ok',
      line: '[  OK  ] Finished Cloud-init: Final Stage',
    })
    // systemd ≥257 StatusUnitFormat=combined
    expect(
      classifyCloudInitOutcome('[  OK  ] Finished cloud-final.service - Cloud-init: Final Stage.'),
    ).toMatchObject({ status: 'ok' })
    // Seed final_message (serial-visible when [ OK ] status is not on ttyS0)
    expect(
      classifyCloudInitOutcome('Expect disks: OS + /vw + 5 data (raidz2) + 2 special (mirror).'),
    ).toMatchObject({ status: 'ok' })
    expect(classifyCloudInitOutcome('Failed to start Cloud-init: Final Stage')).toEqual({
      status: 'fail',
      line: 'Failed to start Cloud-init: Final Stage',
    })
    expect(
      classifyCloudInitOutcome('Failed to start cloud-final.service - Cloud-init: Final Stage.'),
    ).toMatchObject({ status: 'fail' })
    expect(classifyCloudInitOutcome('noise')).toBeNull()
  })

  test('classifyRebootReady detects multi-user', () => {
    expect(classifyRebootReady('[  OK  ] Reached target Multi-User System')).toMatchObject({
      status: 'ok',
    })
    expect(
      classifyRebootReady('[  OK  ] Reached target multi-user.target - Multi-User System.'),
    ).toMatchObject({ status: 'ok' })
    expect(classifyRebootReady('noise')).toBeNull()
  })

  test('classifyContinueFirstBoot accepts cloud-init or multi-user', () => {
    expect(classifyContinueFirstBoot('[  OK  ] Finished Cloud-init: Final Stage')).toMatchObject({
      status: 'ok',
    })
    expect(classifyContinueFirstBoot('[  OK  ] Reached target Multi-User System')).toMatchObject({
      status: 'ok',
    })
    expect(classifyContinueFirstBoot('noise')).toBeNull()
  })

  test('createSerialLineSink classifies lines', async () => {
    spyOn(process.stdout, 'write').mockImplementation(() => true)
    const sink = createSerialLineSink({
      classify: (line) => (line.includes('DONE') ? { status: 'ok', line } : null),
    })
    sink.onChunk('hello\n')
    sink.onChunk('DONE\n')
    await expect(sink.result).resolves.toEqual({ status: 'ok', line: 'DONE' })
  })

  test('startSerialTcpFollow listens and stops', async () => {
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(process.stdout, 'write').mockImplementation(() => true)
    const follow = await startSerialTcpFollow()
    expect(follow.port).toBeGreaterThan(0)
    await follow.stop()
  })
})
