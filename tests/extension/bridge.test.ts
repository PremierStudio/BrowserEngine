import { describe, expect, it } from 'vitest'
import { createExtensionBridge } from '../../src/extension/bridge.js'
import { encodeResponse } from '../../src/extension/protocol.js'

describe('createExtensionBridge', () => {
  it('writes a request and resolves when the matching response arrives', async () => {
    const written: string[] = []
    const ids: string[] = []
    const bridge = createExtensionBridge({
      write: (line) => {
        written.push(line)
      },
      nextId: () => {
        ids.push('id-1')
        return 'id-1'
      },
    })
    const pending = bridge.request('ping')
    expect(written).toHaveLength(1)
    expect(written[0]).toContain('"method":"ping"')
    bridge.receive(encodeResponse({ id: 'id-1', ok: true, result: { pong: true } }))
    await expect(pending).resolves.toEqual({ pong: true })
  })

  it('rejects when the extension returns ok:false', async () => {
    const bridge = createExtensionBridge({
      write: () => undefined,
      nextId: () => 'err-1',
    })
    const pending = bridge.request('attach')
    bridge.receive(encodeResponse({ id: 'err-1', ok: false, error: 'no tab' }))
    await expect(pending).rejects.toThrow(/no tab/)
  })

  it('ignores a response for an unknown id and allocates default ids', async () => {
    const ids: string[] = []
    const bridge = createExtensionBridge({
      write: (line) => {
        ids.push(line)
      },
    })
    bridge.receive('{"id":"missing","ok":true}')
    const pending = bridge.request('tabs')
    bridge.receive('{"id":"e1","ok":false}')
    await expect(pending).rejects.toThrow(/extension error/)
    expect(ids[0]).toContain('"id":"e1"')
  })

  it('rejects every pending waiter with the given error and clears the map', async () => {
    let seq = 0
    const bridge = createExtensionBridge({
      write: () => undefined,
      nextId: () => `id-${(seq += 1)}`,
    })
    const first = bridge.request('ping')
    const second = bridge.request('tabs')
    const error = new Error('extension disconnected')
    bridge.rejectAll?.(error)
    await expect(first).rejects.toBe(error)
    await expect(second).rejects.toBe(error)
  })

  it('ignores responses for rejected ids and accepts a fresh request afterwards', async () => {
    const bridge = createExtensionBridge({
      write: () => undefined,
      nextId: () => 'id-1',
    })
    const first = bridge.request('ping')
    bridge.rejectAll?.(new Error('extension disconnected'))
    await expect(first).rejects.toThrow(/extension disconnected/)
    // A late response for the rejected id must not resolve anything.
    bridge.receive(encodeResponse({ id: 'id-1', ok: true, result: { pong: true } }))
    // The same id is reusable, proving the waiter map was cleared.
    const second = bridge.request('tabs')
    bridge.receive(encodeResponse({ id: 'id-1', ok: true, result: { tabs: [] } }))
    await expect(second).resolves.toEqual({ tabs: [] })
  })
})
