import { describe, expect, it } from 'vitest'
import {
  encodeRequest,
  encodeResponse,
  parseRequest,
  parseResponse,
} from '../../src/extension/protocol.js'

describe('extension protocol', () => {
  it('round-trips a cdp request', () => {
    const raw = encodeRequest({
      id: '1',
      method: 'cdp',
      params: { method: 'Accessibility.getFullAXTree' },
    })
    const parsed = parseRequest(raw)
    expect(parsed).toEqual({
      id: '1',
      method: 'cdp',
      params: { method: 'Accessibility.getFullAXTree' },
    })
  })

  it('rejects a request without an id', () => {
    expect(() => parseRequest('{"method":"ping"}')).toThrow(/id/)
  })

  it('parses every known method', () => {
    const methods = [
      'ping',
      'tabs',
      'attach',
      'detach',
      'cdp',
      'evaluate',
      'goto',
      'status',
      'settings',
      'allow',
      'deny',
      'pause',
      'tab_create',
      'tab_close',
      'tab_activate',
      'activity',
    ] as const
    for (const method of methods) {
      expect(parseRequest(JSON.stringify({ id: 'x', method })).method).toBe(method)
    }
  })

  it('rejects an unknown method', () => {
    expect(() => parseRequest('{"id":"1","method":"nope"}')).toThrow(/method/)
    expect(() => parseRequest('{"id":"1","method":1}')).toThrow(/method/)
  })

  it('rejects a response without an id', () => {
    expect(() => parseResponse('{"ok":true}')).toThrow(/id/)
  })

  it('rejects null payloads instead of reading their fields', () => {
    expect(() => parseRequest('null')).toThrow(/missing id/)
    expect(() => parseResponse('null')).toThrow(/missing id/)
  })

  it('drops params that are not records', () => {
    expect(parseRequest('{"id":"1","method":"ping","params":5}')).toEqual({
      id: '1',
      method: 'ping',
    })
    expect(parseRequest('{"id":"1","method":"ping","params":null}')).toEqual({
      id: '1',
      method: 'ping',
    })
  })

  it('rejects an empty request id', () => {
    expect(() => parseRequest('{"id":"","method":"ping"}')).toThrow(/id/)
  })

  it('rejects an empty response id', () => {
    expect(() => parseResponse('{"id":"","ok":true}')).toThrow(/id/)
  })

  it('omits absent result and error fields', () => {
    expect(parseResponse('{"id":"1","ok":true}')).toStrictEqual({ id: '1', ok: true })
    expect(parseResponse('{"id":"2","ok":false}')).toStrictEqual({ id: '2', ok: false })
  })

  it('round-trips an ok response', () => {
    const raw = encodeResponse({ id: '1', ok: true, result: { nodes: [] } })
    expect(parseResponse(raw)).toEqual({ id: '1', ok: true, result: { nodes: [] } })
  })

  it('round-trips an error response', () => {
    const raw = encodeResponse({ id: '2', ok: false, error: 'not attached' })
    expect(parseResponse(raw)).toEqual({ id: '2', ok: false, error: 'not attached' })
  })
})
