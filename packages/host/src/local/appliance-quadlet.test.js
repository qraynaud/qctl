import {
  allRowsUp,
  anyQuadletUp,
  anyRowUp,
  ensureTankDirs,
  quadletDown,
  quadletUp,
  quadletUpAll,
} from './appliance-quadlet.js'
import * as execIn from './exec-in.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { LocalContext } from './context.js' */

/** @returns {LocalContext} */
function fakeCtx() {
  return /** @type {LocalContext} */ ({
    name: 'qctl-local-test',
    root: '/tmp/inst',
    env: 'dev',
    appsUsername: 'apps',
  })
}

afterEach(() => {
  // @ts-expect-error restore
  execIn.execInAppliance.mockRestore?.()
})

describe('anyRowUp / allRowsUp', () => {
  const header = 'NAME  STATUS  IMAGE\n'

  test('anyRowUp detects a single Up row', () => {
    expect(anyRowUp(`${header}web  Up 2m  img\n`)).toBe(true)
    expect(anyRowUp(`${header}web  Exited  img\n`)).toBe(false)
    expect(anyRowUp(header)).toBe(false)
  })

  test('allRowsUp requires every data row Up', () => {
    expect(allRowsUp(`${header}a  Up 1s  img\nb  Up 1s  img\n`)).toBe(true)
    expect(allRowsUp(`${header}a  Up 1s  img\nb  Exited  img\n`)).toBe(false)
    expect(allRowsUp(header)).toBe(false)
  })
})

describe('anyQuadletUp', () => {
  test('delegates to exec + anyRowUp', async () => {
    spyOn(execIn, 'execInAppliance').mockResolvedValue({
      exitCode: 0,
      stdout: 'NAME  STATUS\napp  Up 3s\n',
      stderr: '',
    })
    expect(await anyQuadletUp(fakeCtx())).toBe(true)
  })
})

describe('quadlet up/down', () => {
  test('quadletUp no-ops on empty apps', async () => {
    const spy = spyOn(execIn, 'execInAppliance').mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })
    await quadletUp(fakeCtx(), [])
    expect(spy).not.toHaveBeenCalled()
  })

  test('quadletUp ensures tank dirs then runs qctl', async () => {
    /** @type {string[]} */
    const scripts = []
    spyOn(execIn, 'execInAppliance').mockImplementation(async (_ctx, script) => {
      scripts.push(String(script))
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await quadletUp(fakeCtx(), ['web'])
    expect(scripts.some((s) => s.includes("/tank/rocky/volumes/'web'"))).toBe(true)
    expect(scripts.some((s) => s.includes("qctl quadlet up 'web'"))).toBe(true)
  })

  test('quadletUpAll runs unfiltered up', async () => {
    /** @type {string[]} */
    const scripts = []
    spyOn(execIn, 'execInAppliance').mockImplementation(async (_ctx, script) => {
      scripts.push(String(script))
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await quadletUpAll(fakeCtx())
    expect(scripts.at(-1)).toContain('qctl quadlet up')
    expect(scripts.at(-1)).not.toMatch(/qctl quadlet up \w/)
  })

  test('quadletDown no-ops on empty apps', async () => {
    const spy = spyOn(execIn, 'execInAppliance').mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })
    await quadletDown(fakeCtx(), [])
    expect(spy).not.toHaveBeenCalled()
  })

  test('ensureTankDirs without app only creates volumes root', async () => {
    /** @type {string[]} */
    const scripts = []
    spyOn(execIn, 'execInAppliance').mockImplementation(async (_ctx, script) => {
      scripts.push(String(script))
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await ensureTankDirs(fakeCtx())
    expect(scripts[0]).toContain('mkdir -p /tank/rocky/volumes')
    expect(scripts[0]).not.toContain('/volumes/web')
  })
})
