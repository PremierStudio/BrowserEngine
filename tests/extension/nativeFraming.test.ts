import { describe, expect, it, vi } from 'vitest'
import { decodeNativeMessages, encodeNativeMessage } from '../../src/extension/nativeFraming.js'

function frameJson(body: string): Buffer {
  const payload = Buffer.from(body, 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(payload.length, 0)
  return Buffer.concat([header, payload])
}

describe('chrome native messaging framing', () => {
  it('prefixes UTF-8 JSON with a 4-byte little-endian length', () => {
    const framed = encodeNativeMessage({ ok: true })
    expect(framed.readUInt32LE(0)).toBe(Buffer.byteLength('{"ok":true}', 'utf8'))
    expect(framed.subarray(4).toString('utf8')).toBe('{"ok":true}')
  })

  it('decodes one complete message and leaves leftover bytes', () => {
    const first = encodeNativeMessage({ id: '1' })
    const leftover = Buffer.from('xx')
    const { messages, rest } = decodeNativeMessages(Buffer.concat([first, leftover]))
    expect(messages).toEqual([{ id: '1' }])
    expect(rest.equals(leftover)).toBe(true)
  })

  it('rejects a native payload that is not an object', () => {
    const body = Buffer.from('[]', 'utf8')
    const header = Buffer.alloc(4)
    header.writeUInt32LE(body.length, 0)
    expect(() => decodeNativeMessages(Buffer.concat([header, body]))).toThrow(/object/)
  })

  it('waits when the body is shorter than the length prefix', () => {
    const header = Buffer.alloc(4)
    header.writeUInt32LE(8, 0)
    const { messages, rest } = decodeNativeMessages(Buffer.concat([header, Buffer.from('ab')]))
    expect(messages).toEqual([])
    expect(rest.length).toBe(6)
  })

  it('waits when the length prefix is incomplete', () => {
    const { messages, rest } = decodeNativeMessages(Buffer.from([3, 0]))
    expect(messages).toEqual([])
    expect(rest.equals(Buffer.from([3, 0]))).toBe(true)
  })

  it('rejects every JSON primitive because a native message must be an object', () => {
    for (const body of ['null', '"text"', '42', 'true']) {
      expect(() => decodeNativeMessages(frameJson(body))).toThrow(/object/)
    }
  })

  it('encodes a one-byte body with an exact little-endian header', () => {
    expect(encodeNativeMessage(0)).toEqual(Buffer.from([1, 0, 0, 0, 0x30]))
  })

  it('encodes large bodies with a header measured in bytes', () => {
    const big = 'x'.repeat(70000)
    const framed = encodeNativeMessage({ big })
    const expectedBody = `{"big":"${big}"}`
    expect(framed.readUInt32LE(0)).toBe(Buffer.byteLength(expectedBody, 'utf8'))
    expect(framed).toHaveLength(4 + Buffer.byteLength(expectedBody, 'utf8'))
    expect(decodeNativeMessages(framed).messages).toEqual([{ big }])
  })

  it('passes utf8 explicitly to Buffer.from when framing', () => {
    const from = vi.spyOn(Buffer, 'from')
    try {
      encodeNativeMessage({ ok: true })
      expect(from).toHaveBeenCalledWith('{"ok":true}', 'utf8')
    } finally {
      from.mockRestore()
    }
  })

  it('sizes non-ASCII bodies in bytes rather than code units', () => {
    const value = { text: 'héllo ✓' }
    const expectedBody = `{"text":"héllo ✓"}`
    const framed = encodeNativeMessage(value)
    expect(Buffer.byteLength(expectedBody, 'utf8')).toBeGreaterThan(expectedBody.length)
    expect(framed.readUInt32LE(0)).toBe(Buffer.byteLength(expectedBody, 'utf8'))
    expect(decodeNativeMessages(framed).messages).toEqual([value])
  })

  it('decodes several frames and keeps a partial trailing header', () => {
    const first = encodeNativeMessage({ n: 1 })
    const second = encodeNativeMessage({ n: 2 })
    const trailing = Buffer.from([7, 0])
    const { messages, rest } = decodeNativeMessages(Buffer.concat([first, second, trailing]))
    expect(messages).toEqual([{ n: 1 }, { n: 2 }])
    expect(rest.equals(trailing)).toBe(true)
  })

  it('treats an empty frame body as invalid JSON instead of trailing bytes', () => {
    const header = Buffer.alloc(4)
    header.writeUInt32LE(0, 0)
    expect(() => decodeNativeMessages(header)).toThrow()
  })
})
