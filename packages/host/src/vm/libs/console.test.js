import {
  classifyCloudInitOutcome,
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
    expect(matchInitTankFatal('qctl init: stage vw-mount: no /vw disk')).toMatch(/vw-mount/)
    expect(matchInitTankFatal('qctl init: stage tier0-seal: missing pending')).toMatch(/tier0-seal/)
    expect(matchInitTankFatal('stage tank-create: refusing to create')).toMatch(/tank-create/)
    expect(matchInitTankFatal('harmless line')).toBeNull()
  })

  test('classifyCloudInitOutcome ok and fail', () => {
    expect(classifyCloudInitOutcome('[  OK  ] Finished Cloud-init: Final Stage')).toEqual({
      status: 'ok',
      line: '[  OK  ] Finished Cloud-init: Final Stage',
    })
    expect(classifyCloudInitOutcome('Failed to start Cloud-init: Final Stage')).toEqual({
      status: 'fail',
      line: 'Failed to start Cloud-init: Final Stage',
    })
    expect(classifyCloudInitOutcome('noise')).toBeNull()
  })

  test('classifyRebootReady detects multi-user', () => {
    expect(classifyRebootReady('[  OK  ] Reached target Multi-User System')).toMatchObject({
      status: 'ok',
    })
    expect(classifyRebootReady('noise')).toBeNull()
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
