import { describe, expect, it } from 'vitest'
import { buildExtensionTools } from '../../src/extension/settingsTools.js'
import { DEFAULT_SETTINGS } from '../../src/extension/settings.js'
import { ToolCategory } from '../../src/tools/types.js'

describe('buildExtensionTools', () => {
  it('relays status and settings through the extension bridge', async () => {
    const calls: Array<{ method: string; params?: unknown }> = []
    const tools = buildExtensionTools({
      request: async (method, params) => {
        calls.push({ method, params })
        if (method === 'status') {
          return { attachedTabId: 3, settings: DEFAULT_SETTINGS, tabs: [], activity: [] }
        }
        if (method === 'settings') {
          return { ...DEFAULT_SETTINGS, paused: true }
        }
        return { ok: true }
      },
      receive: () => undefined,
    })
    const names = tools.map((tool) => tool.name)
    expect(names).toEqual([
      'extension_status',
      'extension_get_settings',
      'extension_set_settings',
      'extension_allow_origin',
      'extension_deny_origin',
    ])
    expect(tools.map((tool) => tool.description)).toEqual([
      'Cockpit snapshot: attached tab, pending attach prompt, settings, tabs, activity.',
      'Read every BrowserEngine cockpit setting (attach policy, pace, viewport, …).',
      'Patch cockpit settings. Same keys as the options page.',
      'Allow chrome.debugger on this origin and resolve a pending attach prompt.',
      'Deny a pending attach prompt for this origin.',
    ])
    expect(tools.map((tool) => tool.category)).toEqual([
      ToolCategory.Observe,
      ToolCategory.Observe,
      ToolCategory.Action,
      ToolCategory.Action,
      ToolCategory.Action,
    ])
    expect(tools.map((tool) => tool.readOnly)).toEqual([true, true, false, false, false])
    expect(tools.map((tool) => tool.experimental)).toEqual([false, false, false, false, false])
    const status = tools[0]
    const get = tools[1]
    const set = tools[2]
    const allow = tools[3]
    const deny = tools[4]
    if (
      status === undefined ||
      get === undefined ||
      set === undefined ||
      allow === undefined ||
      deny === undefined
    ) {
      throw new Error('missing tool')
    }
    expect(status.inputSchema.safeParse({}).success).toBe(true)
    expect(get.inputSchema.safeParse({}).success).toBe(true)
    expect(set.inputSchema.safeParse({ paused: true }).success).toBe(true)
    const allowParsed = allow.inputSchema.safeParse({ origin: 'https://a.example' })
    expect(allowParsed.success).toBe(true)
    if (allowParsed.success) {
      expect(allowParsed.data).toEqual({ origin: 'https://a.example' })
    }
    expect(allow.inputSchema.safeParse({}).success).toBe(false)
    expect(allow.inputSchema.safeParse({ origin: 7 }).success).toBe(false)
    const denyParsed = deny.inputSchema.safeParse({ origin: 'https://b.example' })
    expect(denyParsed.success).toBe(true)
    if (denyParsed.success) {
      expect(denyParsed.data).toEqual({ origin: 'https://b.example' })
    }
    expect(deny.inputSchema.safeParse({}).success).toBe(false)
    expect(deny.inputSchema.safeParse({ origin: null }).success).toBe(false)
    await expect(status.handler({}, { experimental: false })).resolves.toEqual(
      expect.objectContaining({ attachedTabId: 3 }),
    )
    await expect(get.handler({}, { experimental: false })).resolves.toEqual(
      expect.objectContaining({ paused: true }),
    )
    await set.handler({ paused: true }, { experimental: false })
    await set.handler(null, { experimental: false })
    await set.handler('ab', { experimental: false })
    await allow.handler({ origin: 'https://a.example' }, { experimental: false })
    await allow.handler({}, { experimental: false })
    await deny.handler({ origin: 'https://b.example' }, { experimental: false })
    await deny.handler({}, { experimental: false })
    expect(calls).toEqual([
      { method: 'status', params: undefined },
      { method: 'settings', params: { op: 'get' } },
      { method: 'settings', params: { op: 'set', patch: { paused: true } } },
      { method: 'settings', params: { op: 'set', patch: {} } },
      { method: 'settings', params: { op: 'set', patch: {} } },
      { method: 'allow', params: { origin: 'https://a.example' } },
      { method: 'allow', params: { origin: '' } },
      { method: 'deny', params: { origin: 'https://b.example' } },
      { method: 'deny', params: { origin: '' } },
    ])
  })

  it('throws when the native host is not connected', async () => {
    const tools = buildExtensionTools(undefined)
    const status = tools[0]
    if (status === undefined) {
      throw new Error('missing tool')
    }
    await expect(status.handler({}, { experimental: false })).rejects.toThrow(/not connected/)
  })
})
