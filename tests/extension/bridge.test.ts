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
})
