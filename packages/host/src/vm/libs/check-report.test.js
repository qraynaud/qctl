import { createCheckReport } from './check-report.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

afterEach(() => {
  // @ts-expect-error restore
  console.log.mockRestore?.()
  // @ts-expect-error restore
  console.error.mockRestore?.()
  process.exitCode = 0
})

describe('createCheckReport', () => {
  test('finish returns true with no fails', () => {
    spyOn(console, 'log').mockImplementation(() => {})
    const report = createCheckReport('workstation')
    report.section('Tools')
    report.ok('virsh')
    report.warn('optional missing')
    expect(report.finish()).toBe(true)
    expect(process.exitCode || 0).toBe(0)
  })

  test('finish sets exitCode on failure', () => {
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
    const report = createCheckReport('workstation')
    report.fail('missing tool')
    expect(report.finish()).toBe(false)
    expect(process.exitCode).toBe(1)
  })
})
