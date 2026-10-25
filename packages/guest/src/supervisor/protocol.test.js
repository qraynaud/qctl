import {
  SUPERVISOR_METHOD,
  decodeRequestLine,
  decodeResponseLine,
  decodeWireLine,
  encodeRequestLine,
  encodeResponseLine,
  encodeStreamLine,
  isAdminOnlyMethod,
  isAppsMethod,
  isStreamingMethod,
  supervisorRequestCodec,
  supervisorRequestSchema,
  supervisorResponseCodec,
} from './protocol.js'
import { describe, expect, test } from 'bun:test'

describe('supervisor protocol', () => {
  test('method enum + allowlists', () => {
    expect(SUPERVISOR_METHOD.ENSURE).toBe('ensure')
    expect(isAppsMethod(SUPERVISOR_METHOD.ENSURE)).toBe(true)
    expect(isAppsMethod(SUPERVISOR_METHOD.SECRET)).toBe(true)
    expect(isAppsMethod(SUPERVISOR_METHOD.QUADLET)).toBe(false)
    expect(isAdminOnlyMethod(SUPERVISOR_METHOD.QUADLET)).toBe(true)
    expect(isStreamingMethod(SUPERVISOR_METHOD.QUADLET)).toBe(true)
    expect(isStreamingMethod(SUPERVISOR_METHOD.SECRET)).toBe(true)
    expect(isStreamingMethod(SUPERVISOR_METHOD.ENSURE)).toBe(false)
  })

  test('request codec round-trip is idempotent', () => {
    const req = {
      method: /** @type {const} */ ('ensure'),
      params: { app: 'web' },
    }
    const line = encodeRequestLine(req)
    expect(line.endsWith('\n')).toBe(true)
    expect(decodeRequestLine(line)).toEqual(req)
    expect(supervisorRequestCodec.decode(supervisorRequestCodec.encode(req))).toEqual(req)
  })

  test('response codec round-trip is idempotent', () => {
    const ok = {
      ok: /** @type {const} */ (true),
      result: {
        method: /** @type {const} */ ('ensure'),
        app: 'web',
        refs: 1,
        engine: /** @type {const} */ ('rootful'),
        started: true,
      },
    }
    const err = { ok: /** @type {const} */ (false), error: 'permission denied' }
    expect(decodeResponseLine(encodeResponseLine(ok))).toEqual(ok)
    expect(decodeResponseLine(encodeResponseLine(err))).toEqual(err)
    expect(supervisorResponseCodec.decode(supervisorResponseCodec.encode(ok))).toEqual(ok)
  })

  test('decodeRequestLine accepts ensure / quadlet / secret', () => {
    expect(decodeRequestLine('{"method":"ensure","params":{"app":"web"}}')).toEqual({
      method: 'ensure',
      params: { app: 'web' },
    })
    expect(decodeRequestLine('{"method":"quadlet","params":{"op":"ps"}}\n')).toEqual({
      method: 'quadlet',
      params: { op: 'ps' },
    })
    expect(
      decodeRequestLine('{"method":"quadlet","params":{"op":"down","apps":["web"]}}\n'),
    ).toEqual({
      method: 'quadlet',
      params: { op: 'down', apps: ['web'] },
    })
    expect(
      decodeRequestLine('{"method":"secret","params":{"op":"sync","app":"web","restart":true}}\n'),
    ).toEqual({
      method: 'secret',
      params: { op: 'sync', app: 'web', restart: true },
    })
    expect(decodeRequestLine('{"method":"secret","params":{"op":"check"}}\n')).toEqual({
      method: 'secret',
      params: { op: 'check' },
    })
  })

  test('codecs reject invalid JSON / unknown method / bad params / bad response', () => {
    expect(() => decodeRequestLine('{')).toThrow()
    expect(() => supervisorRequestSchema.parse({ method: 'nope', params: {} })).toThrow()
    expect(() => decodeRequestLine('{"method":"ensure","params":{}}')).toThrow()
    expect(() => decodeRequestLine('{"method":"ensure","params":{"app":" web"}}')).toThrow()
    expect(() => decodeResponseLine('{"hello":1}')).toThrow()
    expect(() => encodeResponseLine(/** @type {any} */ ({ ok: false, error: '' }))).toThrow()
  })

  test('quadlet result is exitCode; stream frames round-trip', () => {
    const result = {
      ok: /** @type {const} */ (true),
      result: { method: /** @type {const} */ ('quadlet'), exitCode: 0 },
    }
    expect(decodeResponseLine(encodeResponseLine(result))).toEqual(result)

    const frame = {
      id: '1',
      stream: /** @type {const} */ ('stdout'),
      data: 'quadlet: hi\n',
    }
    expect(decodeWireLine(encodeStreamLine(frame))).toEqual(frame)
    expect(decodeWireLine(encodeResponseLine(result))).toEqual(result)
  })
})
