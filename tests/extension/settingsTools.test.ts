import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildExtensionTools } from '../../src/extension/settingsTools.js'
import { DEFAULT_SETTINGS, SETTINGS_FIELDS } from '../../src/extension/settings.js'
import { ToolCategory } from '../../src/tools/types.js'
import { ToolHandler } from '../../src/tools/ToolHandler.js'

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
      'extension_attach',
      'extension_detach',
      'extension_tab_create',
      'extension_tab_close',
      'extension_tab_activate',
    ])
    expect(tools.map((tool) => tool.description)).toEqual([
      'Cockpit snapshot: attached tab, pending attach prompt, settings, tabs, activity.',
      'Read every BrowserEngine cockpit setting (attach policy, pace, viewport, …).',
      'Patch cockpit settings. Same keys as the options page.',
      'Allow chrome.debugger on this origin and resolve a pending attach prompt.',
      'Deny a pending attach prompt for this origin.',
      'attach the engine to a tab (active tab when tabId is omitted) and start driving it.',
      'stop driving the attached tab and remove all control signals.',
      'open a tab in the controlled browser (the engine attaches it).',
      'Close a tab in the controlled browser.',
      'Activate a tab in the controlled browser.',
    ])
    expect(tools.map((tool) => tool.category)).toEqual([
      ToolCategory.Observe,
      ToolCategory.Observe,
      ToolCategory.Action,
      ToolCategory.Action,
      ToolCategory.Action,
      ToolCategory.Action,
      ToolCategory.Action,
      ToolCategory.Action,
      ToolCategory.Action,
      ToolCategory.Action,
    ])
    expect(tools.map((tool) => tool.readOnly)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
    expect(tools.map((tool) => tool.experimental)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
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

  it('relays a single-key patch as a settings set request', async () => {
    const calls: Array<{ method: string; params?: unknown }> = []
    const tools = buildExtensionTools({
      request: async (method, params) => {
        calls.push({ method, params })
        return { ok: true }
      },
      receive: () => undefined,
    })
    const set = tools[2]
    if (set === undefined) {
      throw new Error('missing tool')
    }
    await set.handler({ attachPolicy: 'always' }, { experimental: false })
    expect(calls).toEqual([
      { method: 'settings', params: { op: 'set', patch: { attachPolicy: 'always' } } },
    ])
  })

  it('relays every key of a multi-key patch', async () => {
    const calls: Array<{ method: string; params?: unknown }> = []
    const tools = buildExtensionTools({
      request: async (method, params) => {
        calls.push({ method, params })
        return { ok: true }
      },
      receive: () => undefined,
    })
    const set = tools[2]
    if (set === undefined) {
      throw new Error('missing tool')
    }
    await set.handler(
      {
        paused: true,
        paceMs: 350,
        allowedOrigins: ['https://a.example'],
        defaultViewportWidth: 1440,
      },
      { experimental: false },
    )
    expect(calls).toEqual([
      {
        method: 'settings',
        params: {
          op: 'set',
          patch: {
            paused: true,
            paceMs: 350,
            allowedOrigins: ['https://a.example'],
            defaultViewportWidth: 1440,
          },
        },
      },
    ])
  })

  it('accepts every real setting key and rejects unknown keys', async () => {
    const tools = buildExtensionTools(undefined)
    const set = tools[2]
    if (set === undefined) {
      throw new Error('missing tool')
    }
    const strict =
      set.inputSchema instanceof z.ZodObject ? set.inputSchema.strict() : set.inputSchema
    expect(strict.safeParse({}).success).toBe(true)
    const everyKey = Object.fromEntries(SETTINGS_FIELDS.map((field) => [field.key, 'x']))
    expect(strict.safeParse(everyKey).success).toBe(true)
    expect(strict.safeParse({ attachPolicy: 'always' }).success).toBe(true)
    expect(strict.safeParse({ bogus: 1 }).success).toBe(false)
    const handler = new ToolHandler()
    handler.register(set)
    await expect(handler.call('extension_set_settings', { bogus: 1 })).rejects.toThrow(
      /unrecognized|invalid arguments/i,
    )
  })

  it('throws when the native host is not connected', async () => {
    const tools = buildExtensionTools(undefined)
    const status = tools[0]
    if (status === undefined) {
      throw new Error('missing tool')
    }
    await expect(status.handler({}, { experimental: false })).rejects.toThrow(/not connected/)
  })

  it('relays attach, detach and tab control through the extension bridge', async () => {
    const calls: Array<{ method: string; params?: unknown }> = []
    const tools = buildExtensionTools({
      request: async (method, params) => {
        calls.push({ method, params })
        return { ok: true }
      },
      receive: () => undefined,
    })
    const attach = tools[5]
    const detach = tools[6]
    const create = tools[7]
    const close = tools[8]
    const activate = tools[9]
    if (
      attach === undefined ||
      detach === undefined ||
      create === undefined ||
      close === undefined ||
      activate === undefined
    ) {
      throw new Error('missing tool')
    }
    expect(attach.name).toBe('extension_attach')
    expect(attach.category).toBe(ToolCategory.Action)
    expect(attach.readOnly).toBe(false)
    expect(attach.experimental).toBe(false)
    expect(detach.name).toBe('extension_detach')
    expect(detach.category).toBe(ToolCategory.Action)
    expect(detach.readOnly).toBe(false)
    expect(detach.experimental).toBe(false)
    expect(create.name).toBe('extension_tab_create')
    expect(create.category).toBe(ToolCategory.Action)
    expect(create.readOnly).toBe(false)
    expect(create.experimental).toBe(false)
    expect(close.name).toBe('extension_tab_close')
    expect(close.category).toBe(ToolCategory.Action)
    expect(close.readOnly).toBe(false)
    expect(close.experimental).toBe(false)
    expect(activate.name).toBe('extension_tab_activate')
    expect(activate.category).toBe(ToolCategory.Action)
    expect(activate.readOnly).toBe(false)
    expect(activate.experimental).toBe(false)

    expect(attach.inputSchema.safeParse({}).success).toBe(true)
    expect(attach.inputSchema.safeParse({ tabId: 5 }).success).toBe(true)
    expect(attach.inputSchema.safeParse({ tabId: 'x' }).success).toBe(false)
    expect(detach.inputSchema.safeParse({}).success).toBe(true)
    expect(create.inputSchema.safeParse({}).success).toBe(true)
    expect(create.inputSchema.safeParse({ url: 'https://x.example' }).success).toBe(true)
    expect(create.inputSchema.safeParse({ url: 5 }).success).toBe(false)
    expect(close.inputSchema.safeParse({ tabId: 5 }).success).toBe(true)
    expect(close.inputSchema.safeParse({}).success).toBe(false)
    expect(activate.inputSchema.safeParse({ tabId: 5 }).success).toBe(true)
    expect(activate.inputSchema.safeParse({}).success).toBe(false)

    await attach.handler({ tabId: 5 }, { experimental: false })
    await attach.handler({}, { experimental: false })
    await detach.handler({}, { experimental: false })
    await create.handler({ url: 'https://x.example' }, { experimental: false })
    await create.handler({}, { experimental: false })
    await close.handler({ tabId: 5 }, { experimental: false })
    await activate.handler({ tabId: 5 }, { experimental: false })
    // toStrictEqual: the omitted-argument shape must be `{}`, not
    // `{ tabId: undefined }` / `{ url: undefined }` (toEqual would blur them).
    expect(calls).toStrictEqual([
      { method: 'attach', params: { tabId: 5 } },
      { method: 'attach', params: {} },
      { method: 'detach', params: undefined },
      { method: 'tab_create', params: { url: 'https://x.example' } },
      { method: 'tab_create', params: {} },
      { method: 'tab_close', params: { tabId: 5 } },
      { method: 'tab_activate', params: { tabId: 5 } },
    ])
  })

  it('throws when a required tabId is missing', async () => {
    const tools = buildExtensionTools({
      request: async () => ({ ok: true }),
      receive: () => undefined,
    })
    const close = tools[8]
    const activate = tools[9]
    if (close === undefined || activate === undefined) {
      throw new Error('missing tool')
    }
    await expect(close.handler({}, { experimental: false })).rejects.toThrow(/tabId required/)
    await expect(activate.handler({}, { experimental: false })).rejects.toThrow(/tabId required/)
  })
})
