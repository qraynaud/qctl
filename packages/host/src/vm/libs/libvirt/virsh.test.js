import * as zx from 'zx'

import { virsh } from './virsh.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { ProcessPromise } from 'zx' */

describe('virsh', () => {
  afterEach(() => {
    // @ts-expect-error restore
    zx.$.mockRestore?.()
  })

  test('is a function that forwards to zx $ with -c connect', () => {
    expect(typeof virsh).toBe('function')
    /** @type {{ pieces: string, connect: string, args: string[] }[]} */
    const calls = []
    /**
     * @param {TemplateStringsArray} strings
     * @param {string} connect
     * @param {string[]} args
     * @returns {ProcessPromise}
     */
    function fake(strings, connect, args) {
      calls.push({ pieces: strings.join(''), connect, args })
      return /** @type {ProcessPromise} */ ({})
    }
    // fake only records template args; zx.$ is a dual sync/async shell API.
    spyOn(zx, '$').mockImplementation(
      /** @type {typeof zx.$} */ (/** @type {typeof fake & typeof zx.$} */ (fake)),
    )
    virsh('qemu:///session', 'dominfo', 'demo')
    expect(calls).toEqual([
      { pieces: 'virsh -c  ', connect: 'qemu:///session', args: ['dominfo', 'demo'] },
    ])
  })
})
