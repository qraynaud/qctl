import * as downloadMod from './download.js'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

/** @import { VmArgv } from '../types.js' */

afterEach(() => {
  // @ts-expect-error restore
  downloadMod.downloadImage.mockRestore?.()
})

describe('vm download command', () => {
  test('exports yargs metadata', () => {
    expect(downloadMod.command).toBe('download')
    expect(downloadMod.describe).toContain('cloud qcow2')
    expect(typeof downloadMod.builder).toBe('function')
    expect(typeof downloadMod.downloadImage).toBe('function')
  })

  test('handler delegates to downloadImage', async () => {
    const downloadImage = spyOn(downloadMod, 'downloadImage').mockResolvedValue('/img.qcow2')
    await downloadMod.handler(
      /** @type {VmArgv} */ (
        /** @type {never} */ ({ forceDownload: true, env: 'dev', target: 'workstation' })
      ),
    )
    expect(downloadImage).toHaveBeenCalledWith({
      force: true,
      env: 'dev',
      target: 'workstation',
    })
  })
})
