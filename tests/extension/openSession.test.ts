import { describe, expect, it } from 'vitest'
import {
  createExtensionTabHost,
  openExtensionContextPage,
} from '../../src/extension/openSession.js'

type RecordedCall = { method: string; params?: unknown }

/** Fake bridge that answers `tabs` with the given payload and records calls. */
function bridgeReturningTabs(tabs: unknown) {
  const calls: RecordedCall[] = []
  const bridge = {
    request: async (method: string, params?: unknown) => {
      calls.push({ method, params })
      if (method === 'tabs') {
        return tabs
      }
      return {}
    },
    receive: () => undefined,
  }
  return { bridge, calls }
}

describe('openExtensionContextPage', () => {
  it('picks the active http(s) tab and attaches with its tabId before returning a ContextPage', async () => {
    const { bridge, calls } = bridgeReturningTabs([
      { id: 1, title: 'First', url: 'https://first.example', active: false },
      { id: 2, title: 'Active', url: 'https://active.example', active: true },
    ])
    const page = await openExtensionContextPage(bridge)
    expect(calls).toEqual([
      { method: 'tabs', params: undefined },
      { method: 'attach', params: { tabId: 2 } },
    ])
    expect(typeof page.observe).toBe('function')
    await page.navigate('https://example.test')
    expect(calls).toContainEqual({
      method: 'cdp',
      params: { method: 'Page.navigate', params: { url: 'https://example.test' } },
    })
  })

  it('falls back to the first http(s) tab when the active tab is internal', async () => {
    const { bridge, calls } = bridgeReturningTabs([
      { id: 1, title: 'New tab', url: 'chrome://newtab', active: true },
      { id: 4 },
      { id: 2, title: 'Plain', url: 'http://plain.example', active: false },
      { id: 3, title: 'Secure', url: 'https://secure.example', active: false },
      { id: 5, active: true },
    ])
    await openExtensionContextPage(bridge)
    expect(calls).toEqual([
      { method: 'tabs', params: undefined },
      { method: 'attach', params: { tabId: 2 } },
    ])
  })

  it('never sends a bare attach without a tabId', async () => {
    const { bridge, calls } = bridgeReturningTabs([
      { id: 7, title: 'Nymbl', url: 'https://nymbl.example', active: true },
    ])
    await openExtensionContextPage(bridge)
    const attach = calls.find((call) => call.method === 'attach')
    expect(attach).toEqual({ method: 'attach', params: { tabId: 7 } })
    expect(calls.some((call) => call.method === 'attach' && call.params === undefined)).toBe(false)
  })

  it('throws when there is no attachable tab', async () => {
    const payloads: unknown[] = [
      [],
      [
        { id: 1, title: 'Blank', url: 'about:blank', active: true },
        { id: 2, title: 'Devtools', url: 'devtools://devtools', active: false },
      ],
      { nope: true },
    ]
    for (const payload of payloads) {
      const { bridge } = bridgeReturningTabs(payload)
      await expect(openExtensionContextPage(bridge)).rejects.toThrow(/no attachable tab/)
    }
  })
})

describe('createExtensionTabHost', () => {
  it('lists tabs from the extension and attaches on activate', async () => {
    const calls: Array<{ method: string; params?: unknown }> = []
    const host = createExtensionTabHost({
      request: async (method, params) => {
        calls.push({ method, params })
        if (method === 'tabs') {
          return [{ id: 9, title: 'Nymbl', url: 'https://nymbl.example' }, { id: 10 }]
        }
        if (method === 'tab_create') {
          if (params !== undefined && 'url' in params) {
            return { id: 2, title: 'new', url: 'https://nymbl.example' }
          }
          return { id: 3 }
        }
        return {}
      },
      receive: () => undefined,
    })
    const listed = await host.list()
    expect(listed).toEqual([
      { id: '9', title: 'Nymbl', url: 'https://nymbl.example' },
      { id: '10', title: '', url: '' },
    ])
    await host.activate('9')
    expect(calls[1]).toEqual({ method: 'attach', params: { tabId: 9 } })
    expect(host.currentId()).toBe('9')
    host.setCurrentId('8')
    expect(host.currentId()).toBe('8')
    const created = await host.create('https://nymbl.example')
    expect(created).toEqual(expect.objectContaining({ url: 'https://nymbl.example' }))
    expect(calls[2]).toEqual({ method: 'tab_create', params: { url: 'https://nymbl.example' } })
    await host.close('2')
    expect(calls[3]).toEqual({ method: 'tab_close', params: { tabId: 2 } })
    await host.close('9')
    expect(calls[4]).toEqual({ method: 'tab_close', params: { tabId: 9 } })
    const blank = await host.create(undefined)
    expect(blank).toEqual({ id: '3', title: '', url: '' })
    expect(calls[5]).toEqual({ method: 'tab_create', params: {} })
  })

  it('rejects tab_create when the host returns no tab', async () => {
    const host = createExtensionTabHost({
      request: async () => ({}),
      receive: () => undefined,
    })
    await expect(host.create('https://x')).rejects.toThrow(/no tab/)
  })

  it('returns no tabs when the payload is not a list', async () => {
    const host = createExtensionTabHost({
      request: async () => ({ nope: true }),
      receive: () => undefined,
    })
    await expect(host.list()).resolves.toEqual([])
  })

  it('rejects null and undefined tab_create payloads', async () => {
    const payloads: unknown[] = [null, undefined]
    for (const payload of payloads) {
      const host = createExtensionTabHost({
        request: async () => payload,
        receive: () => undefined,
      })
      await expect(host.create('https://x')).rejects.toThrow(/no tab/)
    }
  })

  it('rejects an array payload even when it carries a numeric id', async () => {
    const payload = Object.assign([{ id: 4, title: 'tab', url: 'https://list.example' }], {
      id: 9,
    })
    const host = createExtensionTabHost({
      request: async () => payload,
      receive: () => undefined,
    })
    await expect(host.create('https://x')).rejects.toThrow(/no tab/)
  })

  it('prefers the tab fields returned by the host', async () => {
    const host = createExtensionTabHost({
      request: async () => ({ id: 7, title: 'Host title', url: 'https://host.example' }),
      receive: () => undefined,
    })
    const created = await host.create('https://argument.example')
    expect(created).toEqual({ id: '7', title: 'Host title', url: 'https://host.example' })
  })

  it('clears the current id when the current tab closes', async () => {
    const calls: Array<{ method: string; params?: unknown }> = []
    const host = createExtensionTabHost({
      request: async (method, params) => {
        calls.push({ method, params })
        if (method === 'tab_create') {
          return { id: 5, title: '', url: '' }
        }
        return {}
      },
      receive: () => undefined,
    })
    const created = await host.create(undefined)
    expect(host.currentId()).toBe('5')
    await host.close(created.id)
    expect(host.currentId()).toBeUndefined()
    expect(calls[1]).toEqual({ method: 'tab_close', params: { tabId: 5 } })
  })

  it('keeps another tab current when a different tab closes', async () => {
    const calls: Array<{ method: string; params?: unknown }> = []
    const host = createExtensionTabHost({
      request: async (method, params) => {
        calls.push({ method, params })
        return {}
      },
      receive: () => undefined,
    })
    host.setCurrentId('8')
    await host.close('7')
    expect(host.currentId()).toBe('8')
    expect(calls[0]).toEqual({ method: 'tab_close', params: { tabId: 7 } })
  })
})
