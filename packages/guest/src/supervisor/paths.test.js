import {
  ADMIN_SOCK_NAME,
  APPS_SOCK_NAME,
  QCTL_RUN_DIR_DEFAULT,
  adminSockPath,
  appReadyPath,
  appStampDir,
  appsSockPath,
} from './paths.js'
import { describe, expect, test } from 'bun:test'

describe('supervisor paths', () => {
  test('defaults under /run/qctl', () => {
    expect(QCTL_RUN_DIR_DEFAULT).toBe('/run/qctl')
    expect(appsSockPath()).toBe(`/run/qctl/${APPS_SOCK_NAME}`)
    expect(adminSockPath()).toBe(`/run/qctl/${ADMIN_SOCK_NAME}`)
    expect(appStampDir('web')).toBe('/run/qctl/app/web')
    expect(appReadyPath('web')).toBe('/run/qctl/app/web/ready')
  })

  test('strips trailing slashes on runDir', () => {
    expect(appsSockPath('/tmp/qctl///')).toBe(`/tmp/qctl/${APPS_SOCK_NAME}`)
    expect(adminSockPath('/var/run/qctl/')).toBe(`/var/run/qctl/${ADMIN_SOCK_NAME}`)
    expect(appReadyPath('db', '/x/')).toBe('/x/app/db/ready')
  })
})
