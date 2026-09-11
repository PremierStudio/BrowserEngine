import { describe, expect, it } from 'vitest'
import {
  createExtensionSession,
  type PendingAttach,
  type SessionDeps,
  type TabInfo,
} from '../../src/extension/session.js'
import { DEFAULT_SETTINGS } from '../../src/extension/settings.js'

function tab(id: number, url: string, active = false): TabInfo {
  return { id, title: `t${id}`, url, active }
}

function fakeDeps(initial: TabInfo[] = [tab(1, 'https://teams.cloud.microsoft', true)]): {
  deps: SessionDeps
  tabs: TabInfo[]
  box: { readonly stored: unknown }
  saved: unknown[]
  attached: number[]
  detached: number[]
  commands: Array<{ tabId: number; method: string; params: unknown }>
} {
  const tabs = [...initial]
  const saved: unknown[] = []
  const attached: number[] = []
  const detached: number[] = []
  const commands: Array<{ tabId: number; method: string; params: unknown }> = []
  let stored: unknown = undefined
  const deps: SessionDeps = {
    loadSettings: async () => stored,
    saveSettings: async (next) => {
      stored = next
      saved.push(next)
    },
    queryTabs: async () => tabs,
    getTab: async (id) => tabs.find((item) => item.id === id),
    createTab: async (url) => {
      const created = tab(tabs.length + 1, url ?? 'about:blank', true)
      tabs.push(created)
      return created
    },
    closeTab: async (id) => {
      const index = tabs.findIndex((item) => item.id === id)
      if (index >= 0) {
        tabs.splice(index, 1)
      }
    },
    updateTab: async (id, update) => {
      for (const item of tabs) {
        if (update.active === true) {
          item.active = item.id === id
        }
        if (item.id === id && update.url !== undefined) {
          item.url = update.url
        }
      }
    },
    attachDebugger: async (tabId) => {
      attached.push(tabId)
    },
    detachDebugger: async (tabId) => {
      detached.push(tabId)
      const index = attached.indexOf(tabId)
      if (index >= 0) {
        attached.splice(index, 1)
      }
    },
    sendCommand: async (tabId, method, params) => {
      commands.push({ tabId, method, params })
      return { ok: true }
    },
  }
  return {
    deps,
    tabs,
    box: {
      get stored() {
        return stored
      },
    },
    saved,
    attached,
    detached,
    commands,
  }
}

function isPending(value: unknown): value is PendingAttach {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value
  return (
    'tabId' in record &&
    typeof record.tabId === 'number' &&
    'origin' in record &&
    typeof record.origin === 'string'
  )
}

async function waitForPending(
  session: ReturnType<typeof createExtensionSession>,
): Promise<PendingAttach> {
  for (let i = 0; i < 20; i += 1) {
    const status = await session.handle({ id: `pending-${i}`, method: 'status' })
    const result = status.result
    if (
      typeof result === 'object' &&
      result !== null &&
      'pending' in result &&
      isPending(result.pending)
    ) {
      return result.pending
    }
  }
  throw new Error('attach never prompted')
}

async function waitForPendingWhere(
  session: ReturnType<typeof createExtensionSession>,
  match: (pending: PendingAttach) => boolean,
): Promise<PendingAttach> {
  for (let i = 0; i < 40; i += 1) {
    const status = await session.handle({ id: `pending-${i}`, method: 'status' })
    const result = status.result
    if (
      typeof result === 'object' &&
      result !== null &&
      'pending' in result &&
      isPending(result.pending) &&
      match(result.pending)
    ) {
      return result.pending
    }
  }
  throw new Error('attach never prompted')
}

describe('createExtensionSession', () => {
  it('returns status with defaults and the tab list', async () => {
    const { deps } = fakeDeps()
    const session = createExtensionSession(deps)
    const reply = await session.handle({ id: '1', method: 'status' })
    expect(reply).toEqual({
      id: '1',
      ok: true,
      result: expect.objectContaining({
        attachedTabId: undefined,
        pending: undefined,
        settings: DEFAULT_SETTINGS,
        tabs: [expect.objectContaining({ id: 1, url: 'https://teams.cloud.microsoft' })],
      }),
    })
  })

  it('get/set/reset settings persist through the store', async () => {
    const { deps, box } = fakeDeps()
    const session = createExtensionSession(deps)
    await session.handle({
      id: '1',
      method: 'settings',
      params: { op: 'set', patch: { paused: true, attachPolicy: 'always' } },
    })
    const got = await session.handle({ id: '2', method: 'settings', params: { op: 'get' } })
    expect(got.ok).toBe(true)
    expect(got.result).toEqual(expect.objectContaining({ paused: true, attachPolicy: 'always' }))
    expect(box.stored).toEqual(expect.objectContaining({ paused: true }))
    const reset = await session.handle({ id: '3', method: 'settings', params: { op: 'reset' } })
    expect(reset.result).toEqual(DEFAULT_SETTINGS)
  })

  it('prompts on a new origin and attaches after allow adds it to the list', async () => {
    const { deps, attached } = fakeDeps([tab(4, 'https://evil.example/x', true)])
    const session = createExtensionSession(deps)
    const first = session.handle({ id: '1', method: 'attach', params: { tabId: 4 } })
    const pending = await waitForPending(session)
    expect(pending).toEqual(
      expect.objectContaining({
        tabId: 4,
        origin: 'https://evil.example',
      }),
    )
    const allowed = await session.handle({
      id: '3',
      method: 'allow',
      params: { origin: 'https://evil.example' },
    })
    expect(allowed.ok).toBe(true)
    await expect(first).resolves.toEqual({
      id: '1',
      ok: true,
      result: { tabId: 4 },
    })
    expect(attached).toEqual([4])
    const settings = await session.handle({ id: '4', method: 'settings', params: { op: 'get' } })
    expect(settings.result).toEqual(
      expect.objectContaining({ allowedOrigins: ['https://evil.example'] }),
    )
  })

  it('deny rejects a pending attach without adding the origin', async () => {
    const { deps, attached } = fakeDeps([tab(5, 'https://nope.example', true)])
    const session = createExtensionSession(deps)
    const pending = session.handle({ id: '1', method: 'attach', params: { tabId: 5 } })
    await waitForPending(session)
    await session.handle({ id: '2', method: 'deny', params: { origin: 'https://nope.example' } })
    await expect(pending).resolves.toEqual({
      id: '1',
      ok: false,
      error: 'attach denied',
    })
    expect(attached).toEqual([])
  })

  it('refuses attach while paused and resumes after pause is cleared', async () => {
    const { deps, attached } = fakeDeps()
    const session = createExtensionSession(deps)
    await session.handle({ id: '1', method: 'pause', params: { paused: true } })
    const denied = await session.handle({ id: '2', method: 'attach', params: { tabId: 1 } })
    expect(denied).toEqual({ id: '2', ok: false, error: 'paused' })
    await session.handle({ id: '3', method: 'pause', params: { paused: false } })
    await session.handle({
      id: '4',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'always' } },
    })
    const ok = await session.handle({ id: '5', method: 'attach', params: { tabId: 1 } })
    expect(ok).toEqual({ id: '5', ok: true, result: { tabId: 1 } })
    expect(attached).toEqual([1])
  })

  it('creates and closes tabs and records activity', async () => {
    const { deps, tabs } = fakeDeps()
    const session = createExtensionSession(deps)
    const created = await session.handle({
      id: '1',
      method: 'tab_create',
      params: { url: 'https://nymbl.example' },
    })
    expect(created.ok).toBe(true)
    expect(tabs).toHaveLength(2)
    const closed = await session.handle({
      id: '2',
      method: 'tab_close',
      params: { tabId: 1 },
    })
    expect(closed.ok).toBe(true)
    expect(tabs.map((item) => item.id)).toEqual([2])
    const focused = await session.handle({ id: '2b', method: 'tab_activate', params: { tabId: 2 } })
    expect(focused).toEqual({ id: '2b', ok: true, result: { tabId: 2 } })
    expect(tabs[0]?.active).toBe(true)
    const missingFocus = await session.handle({ id: '2c', method: 'tab_activate' })
    expect(missingFocus.error).toBe('tabId required')
    const activity = await session.handle({ id: '3', method: 'activity' })
    expect(activity.result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'tab_create', ok: true }),
        expect.objectContaining({ method: 'tab_close', ok: true }),
      ]),
    )
    expect(activity.result).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ method: 'activity' })]),
    )
  })

  it('detaches, navigates, and evaluates only while attached', async () => {
    const { deps, commands } = fakeDeps()
    const session = createExtensionSession(deps)
    await session.handle({
      id: '1',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'always' } },
    })
    await expect(
      session.handle({ id: '2', method: 'goto', params: { url: 'https://x' } }),
    ).resolves.toEqual({
      id: '2',
      ok: false,
      error: 'not attached',
    })
    await session.handle({ id: '3', method: 'attach', params: { tabId: 1 } })
    await session.handle({ id: '4', method: 'goto', params: { url: 'https://x.example' } })
    await session.handle({
      id: '5',
      method: 'evaluate',
      params: { expression: '1+1' },
    })
    await session.handle({
      id: '6',
      method: 'cdp',
      params: { method: 'Runtime.evaluate', params: { expression: '2' } },
    })
    expect(commands.map((item) => item.method)).toEqual(['Runtime.evaluate', 'Runtime.evaluate'])
    await session.handle({ id: '7', method: 'detach' })
    const ping = await session.handle({ id: '8', method: 'ping' })
    expect(ping.result).toEqual({ pong: true, attachedTabId: undefined })
    const { deps: chromeDeps } = fakeDeps([tab(9, 'chrome://extensions', true)])
    const chromeSession = createExtensionSession(chromeDeps)
    const prompt = chromeSession.handle({ id: 'c1', method: 'attach', params: { tabId: 9 } })
    const pending = await waitForPending(chromeSession)
    expect(pending.origin).toBe('chrome://extensions')
    await chromeSession.handle({ id: 'c2', method: 'deny' })
    await expect(prompt).resolves.toEqual({ id: 'c1', ok: false, error: 'attach denied' })
    await chromeSession.handle({
      id: 'c3',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'always' } },
    })
    await chromeSession.handle({ id: 'c4', method: 'attach', params: { tabId: 9 } })
    const cdp = await chromeSession.handle({ id: 'c5', method: 'cdp', params: {} })
    expect(cdp.ok).toBe(true)
    const gone = await chromeSession.handle({ id: 'c6', method: 'goto' })
    expect(gone.ok).toBe(true)
    const typed = await chromeSession.handle({ id: 'c7', method: 'evaluate', params: {} })
    expect(typed.ok).toBe(true)
  })

  it('covers attach retarget, missing tabId, and silent settings get', async () => {
    const { deps } = fakeDeps([
      tab(1, 'https://a.example', true),
      tab(2, 'https://b.example', false),
    ])
    const session = createExtensionSession(deps)
    await session.handle({
      id: '1',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'always' } },
    })
    await session.handle({ id: '2', method: 'attach', params: { tabId: 1 } })
    const again = await session.handle({ id: '3', method: 'attach', params: { tabId: 1 } })
    expect(again.ok).toBe(true)
    const switched = await session.handle({ id: '4', method: 'attach', params: { tabId: 2 } })
    expect(switched.result).toEqual({ tabId: 2 })
    await session.handle({ id: '5', method: 'tab_close', params: { tabId: 2 } })
    const missing = await session.handle({ id: '6', method: 'tab_close', params: {} })
    expect(missing).toEqual({ id: '6', ok: false, error: 'tabId required' })
    const cdp = await session.handle({ id: '7', method: 'cdp', params: { method: 'X' } })
    expect(cdp.error).toBe('not attached')
    await session.handle({
      id: '8',
      method: 'settings',
      params: { op: 'set', patch: { autoAttachActiveTab: false, attachPolicy: 'always' } },
    })
    const noTab = await session.handle({ id: '9', method: 'attach', params: {} })
    expect(noTab.error).toBe('no tab')
    const get = await session.handle({ id: '10', method: 'settings' })
    expect(get.ok).toBe(true)
    const load = deps.loadSettings
    deps.loadSettings = async () => {
      throw 'store-down'
    }
    const failedGet = await session.handle({ id: '10b', method: 'settings' })
    expect(failedGet.ok).toBe(false)
    deps.loadSettings = load
    await session.handle({ id: '11', method: 'allow', params: { origin: 'https://a.example' } })
    await session.handle({ id: '11a', method: 'allow', params: { origin: 'https://a.example' } })
    await session.handle({ id: '11z', method: 'deny' })
    await session.handle({ id: '11y', method: 'detach' })
    await session.handle({
      id: '11b',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'prompt' } },
    })
    const listedPrompt = session.handle({ id: '11c', method: 'attach', params: { tabId: 1 } })
    await waitForPending(session)
    await session.handle({ id: '11d', method: 'allow', params: { origin: 'https://a.example' } })
    await expect(listedPrompt).resolves.toEqual({ id: '11c', ok: true, result: { tabId: 1 } })
    const listed = await session.handle({ id: '12', method: 'settings', params: { op: 'get' } })
    expect(listed.result).toEqual(
      expect.objectContaining({ allowedOrigins: expect.arrayContaining(['https://a.example']) }),
    )
  })

  it('detaches a dead debugger when switching tabs and uses the active tab', async () => {
    const { deps } = fakeDeps([
      tab(1, 'https://a.example', false),
      tab(2, 'https://b.example', true),
    ])
    const original = deps.detachDebugger
    deps.detachDebugger = async () => {
      throw new Error('already gone')
    }
    const session = createExtensionSession(deps)
    await session.handle({
      id: '1',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'always' } },
    })
    await session.handle({ id: '2', method: 'attach', params: { tabId: 1 } })
    const next = await session.handle({ id: '3', method: 'attach', params: {} })
    expect(next.result).toEqual({ tabId: 2 })
    deps.detachDebugger = original
  })

  it('uses tabs[0], replaces a pending attach, and caps activity', async () => {
    const { deps } = fakeDeps([
      tab(1, 'https://a.example', false),
      tab(2, 'https://b.example', false),
    ])
    deps.now = () => 42
    const session = createExtensionSession(deps)
    const listed = await session.handle({ id: 'tabs', method: 'tabs' })
    expect(listed.result).toEqual(expect.arrayContaining([expect.objectContaining({ id: 1 })]))
    const first = session.handle({ id: '1', method: 'attach', params: { tabId: 1 } })
    await waitForPending(session)
    const second = session.handle({ id: '2', method: 'attach', params: { tabId: 2 } })
    await waitForPending(session)
    await expect(first).resolves.toEqual({ id: '1', ok: false, error: 'attach denied' })
    await session.handle({ id: '3', method: 'deny', params: { origin: 'https://b.example' } })
    await expect(second).resolves.toEqual({ id: '2', ok: false, error: 'attach denied' })
    await session.handle({
      id: '4',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'always' } },
    })
    const auto = await session.handle({ id: '5', method: 'attach' })
    expect(auto.result).toEqual({ tabId: 1 })
    const missingClose = await session.handle({ id: '6', method: 'tab_close' })
    expect(missingClose.error).toBe('tabId required')
    for (let i = 0; i < 55; i += 1) {
      await session.handle({
        id: `c${i}`,
        method: 'tab_create',
        params: { url: 'https://n.example' },
      })
    }
    const activity = await session.handle({ id: 'act', method: 'activity' })
    expect(Array.isArray(activity.result) && activity.result.length).toBe(50)
    expect(activity.result).toEqual(expect.arrayContaining([expect.objectContaining({ t: 42 })]))
  })

  it('rejects an unknown method', async () => {
    const { deps } = fakeDeps()
    const session = createExtensionSession(deps)
    const reply = await session.handle({ id: '1', method: 'nope' })
    expect(reply).toEqual({ id: '1', ok: false, error: 'unknown method nope' })
  })

  it('treats malformed params as missing', async () => {
    const { deps, tabs } = fakeDeps([tab(1, 'https://a.example', true)])
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'always' } },
    })
    await session.handle({ id: '1', method: 'attach' })
    const malformed: unknown[] = ['2', Number.NaN, Number.POSITIVE_INFINITY, true, null, {}]
    for (const tabId of malformed) {
      const reply = await session.handle({ id: 'bad', method: 'tab_close', params: { tabId } })
      expect(reply).toEqual({ id: 'bad', ok: false, error: 'tabId required' })
    }
    expect(tabs).toHaveLength(1)
    await session.handle({ id: '2', method: 'goto', params: { url: 7 } })
    expect(tabs[0]?.url).toBe('')
    const created = await session.handle({ id: '3', method: 'tab_create', params: { url: 7 } })
    expect(created.result).toEqual(expect.objectContaining({ url: 'about:blank' }))
  })

  it('starts with empty activity and stamps only non-silent methods', async () => {
    const { deps } = fakeDeps()
    deps.now = () => 1234
    const session = createExtensionSession(deps)
    const initial = await session.handle({ id: 'a0', method: 'activity' })
    expect(initial.result).toEqual([])
    await session.handle({ id: 'a1', method: 'status' })
    await session.handle({ id: 'a2', method: 'ping' })
    await session.handle({ id: 'a3', method: 'tabs' })
    await session.handle({ id: 'a4', method: 'settings', params: { op: 'get' } })
    await session.handle({ id: 'a5', method: 'settings' })
    await session.handle({ id: 'a6', method: 'settings', params: { op: 12 } })
    await session.handle({ id: 'a7', method: 'settings', params: { op: 'get', '': 'set' } })
    const silent = await session.handle({ id: 'a8', method: 'activity' })
    expect(silent.result).toEqual([])
    await session.handle({ id: 'm1', method: 'settings', params: { op: 'set' } })
    await session.handle({ id: 'm2', method: 'settings', params: { op: 'set', '': 'get' } })
    await session.handle({ id: 'm3', method: 'goto' })
    const expected = [
      { t: 1234, method: 'settings', ok: true, detail: '' },
      { t: 1234, method: 'settings', ok: true, detail: '' },
      { t: 1234, method: 'goto', ok: false, detail: 'not attached' },
    ]
    const after = await session.handle({ id: 'a9', method: 'activity' })
    expect(after.result).toEqual(expected)
    const status = await session.handle({ id: 'a10', method: 'status' })
    expect(status.result).toEqual(expect.objectContaining({ activity: expected }))
  })

  it('does not stamp a silent method that fails', async () => {
    const { deps } = fakeDeps()
    const session = createExtensionSession(deps)
    deps.loadSettings = async () => {
      throw new Error('store-down')
    }
    const failed = await session.handle({ id: 's1', method: 'status' })
    expect(failed).toEqual({ id: 's1', ok: false, error: 'store-down' })
    const activity = await session.handle({ id: 's2', method: 'activity' })
    expect(activity.result).toEqual([])
  })

  it('re-attaches the same tab without detaching and switches tabs', async () => {
    const { deps, attached, detached } = fakeDeps([
      tab(1, 'https://a.example', true),
      tab(2, 'https://b.example', false),
    ])
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'always' } },
    })
    await session.handle({ id: '1', method: 'attach', params: { tabId: 1 } })
    await session.handle({ id: '2', method: 'attach', params: { tabId: 1 } })
    expect(detached).toEqual([])
    expect(attached).toEqual([1])
    await session.handle({ id: '3', method: 'attach', params: { tabId: 2 } })
    expect(detached).toEqual([1])
    expect(attached).toEqual([2])
  })

  it('falls back to the active tab for zero and negative tab ids', async () => {
    const { deps } = fakeDeps([
      tab(1, 'https://a.example', false),
      tab(2, 'https://b.example', true),
    ])
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'always' } },
    })
    const zero = await session.handle({ id: 'z', method: 'attach', params: { tabId: 0 } })
    expect(zero).toEqual({ id: 'z', ok: true, result: { tabId: 2 } })
    const negative = await session.handle({ id: 'n', method: 'attach', params: { tabId: -3 } })
    expect(negative).toEqual({ id: 'n', ok: true, result: { tabId: 2 } })
  })

  it('pauses off when params are missing', async () => {
    const { deps, box } = fakeDeps()
    const session = createExtensionSession(deps)
    const reply = await session.handle({ id: 'p', method: 'pause' })
    expect(reply).toEqual({ id: 'p', ok: true, result: expect.objectContaining({ paused: false }) })
    expect(box.stored).toEqual(expect.objectContaining({ paused: false }))
  })

  it('applies settings patches only for set and tolerates missing params', async () => {
    const { deps, saved } = fakeDeps()
    const session = createExtensionSession(deps)
    await session.handle({
      id: '1',
      method: 'settings',
      params: { op: 'set', patch: { paused: true } },
    })
    const before = saved.length
    const get = await session.handle({
      id: '2',
      method: 'settings',
      params: { op: 'get', patch: { paused: false } },
    })
    expect(get.result).toEqual(expect.objectContaining({ paused: true }))
    expect(saved.length).toBe(before)
    const set = await session.handle({ id: '3', method: 'settings', params: { op: 'set' } })
    expect(set.ok).toBe(true)
    expect(set.result).toEqual(expect.objectContaining({ paused: true }))
    expect(saved.length).toBe(before + 1)
  })

  it('keeps a pending prompt when allow names a different origin', async () => {
    const { deps, saved } = fakeDeps([tab(1, 'https://a.example', true)])
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'prompt' } },
    })
    const pending = session.handle({ id: 'p', method: 'attach', params: { tabId: 1 } })
    await waitForPendingWhere(session, (item) => item.origin === 'https://a.example')
    const before = saved.length
    const reply = await session.handle({
      id: 'ok',
      method: 'allow',
      params: { origin: 'https://other.example' },
    })
    expect(reply).toEqual({ id: 'ok', ok: true, result: { ok: true } })
    expect(saved.length).toBe(before + 1)
    const status = await session.handle({ id: 's', method: 'status' })
    expect(status.result).toEqual(
      expect.objectContaining({
        pending: expect.objectContaining({ origin: 'https://a.example', tabId: 1 }),
      }),
    )
    const listed = await session.handle({ id: 'g', method: 'settings', params: { op: 'get' } })
    expect(listed.result).toEqual(
      expect.objectContaining({ allowedOrigins: ['https://other.example'] }),
    )
    await session.handle({ id: 'd', method: 'deny' })
    await expect(pending).resolves.toEqual({ id: 'p', ok: false, error: 'attach denied' })
  })

  it('does not persist an allow for an already-listed origin', async () => {
    const { deps, saved } = fakeDeps([tab(1, 'https://a.example', true)])
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: {
        op: 'set',
        patch: { attachPolicy: 'prompt', allowedOrigins: ['https://a.example'] },
      },
    })
    const before = saved.length
    const reply = await session.handle({
      id: 'ok',
      method: 'allow',
      params: { origin: 'https://a.example' },
    })
    expect(reply).toEqual({ id: 'ok', ok: true, result: { ok: true } })
    expect(saved.length).toBe(before)
    const settings = await session.handle({ id: 'g', method: 'settings', params: { op: 'get' } })
    expect(settings.result).toEqual(
      expect.objectContaining({ allowedOrigins: ['https://a.example'] }),
    )
  })

  it('adds a new origin through allow with no pending prompt', async () => {
    const { deps, saved } = fakeDeps()
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: { op: 'set', patch: { paused: true } },
    })
    const before = saved.length
    const reply = await session.handle({
      id: 'ok',
      method: 'allow',
      params: { origin: 'https://new.example' },
    })
    expect(reply).toEqual({ id: 'ok', ok: true, result: { ok: true } })
    expect(saved.length).toBe(before + 1)
    const settings = await session.handle({ id: 'g', method: 'settings', params: { op: 'get' } })
    expect(settings.result).toEqual(
      expect.objectContaining({
        paused: true,
        allowedOrigins: ['https://new.example'],
      }),
    )
  })

  it('accepts allow and deny without a pending prompt', async () => {
    const { deps, saved } = fakeDeps()
    const session = createExtensionSession(deps)
    const allow = await session.handle({ id: 'a', method: 'allow' })
    expect(allow).toEqual({ id: 'a', ok: true, result: { ok: true } })
    const deny = await session.handle({ id: 'd', method: 'deny' })
    expect(deny).toEqual({ id: 'd', ok: true, result: { ok: true } })
    expect(saved).toEqual([])
    const settings = await session.handle({ id: 'g', method: 'settings', params: { op: 'get' } })
    expect(settings.result).toEqual(expect.objectContaining({ allowedOrigins: [] }))
  })

  it('resolves a pending prompt when allow has no origin', async () => {
    const { deps, attached } = fakeDeps([tab(1, 'https://a.example', true)])
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'prompt' } },
    })
    session.handle({ id: 'p', method: 'attach', params: { tabId: 1 } })
    await waitForPendingWhere(session, (item) => item.tabId === 1)
    const reply = await session.handle({ id: 'ok', method: 'allow' })
    expect(reply.ok).toBe(true)
    const status = await session.handle({ id: 's', method: 'status' })
    expect(status.result).toEqual(expect.objectContaining({ attachedTabId: 1, pending: undefined }))
    expect(attached).toEqual([1])
  })

  it('approves a prompt, clears it, and records the origin', async () => {
    const { deps, attached, saved } = fakeDeps([tab(1, 'https://a.example', true)])
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'prompt' } },
    })
    const pending = session.handle({ id: 'p', method: 'attach', params: { tabId: 1 } })
    await waitForPendingWhere(session, (item) => item.origin === 'https://a.example')
    const before = saved.length
    await session.handle({ id: 'ok', method: 'allow', params: { origin: 'https://a.example' } })
    await expect(pending).resolves.toEqual({ id: 'p', ok: true, result: { tabId: 1 } })
    expect(saved.length).toBe(before + 1)
    expect(attached).toEqual([1])
    const status = await session.handle({ id: 's', method: 'status' })
    expect(status.result).toEqual(expect.objectContaining({ attachedTabId: 1, pending: undefined }))
  })

  it('does not record an origin for a non-http attach', async () => {
    const { deps, attached, saved } = fakeDeps([tab(9, 'chrome://extensions', true)])
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'prompt' } },
    })
    const pending = session.handle({ id: 'p', method: 'attach', params: { tabId: 9 } })
    await waitForPendingWhere(session, (item) => item.origin === 'chrome://extensions')
    const before = saved.length
    await session.handle({ id: 'ok', method: 'allow' })
    await expect(pending).resolves.toEqual({ id: 'p', ok: true, result: { tabId: 9 } })
    expect(saved.length).toBe(before)
    expect(attached).toEqual([9])
    const settings = await session.handle({ id: 'g', method: 'settings', params: { op: 'get' } })
    expect(settings.result).toEqual(expect.objectContaining({ allowedOrigins: [] }))
    const status = await session.handle({ id: 's', method: 'status' })
    expect(status.result).toEqual(expect.objectContaining({ pending: undefined }))
  })

  it('does not re-save an already-allowed origin under prompt policy', async () => {
    const { deps, saved } = fakeDeps([tab(1, 'https://a.example', true)])
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: {
        op: 'set',
        patch: { attachPolicy: 'prompt', allowedOrigins: ['https://a.example'] },
      },
    })
    const pending = session.handle({ id: 'p', method: 'attach', params: { tabId: 1 } })
    await waitForPendingWhere(session, (item) => item.origin === 'https://a.example')
    const before = saved.length
    await session.handle({ id: 'ok', method: 'allow', params: { origin: 'https://a.example' } })
    await expect(pending).resolves.toEqual({ id: 'p', ok: true, result: { tabId: 1 } })
    expect(saved.length).toBe(before)
    const status = await session.handle({ id: 's', method: 'status' })
    expect(status.result).toEqual(expect.objectContaining({ pending: undefined }))
  })

  it('keeps a replacement prompt pending after a mismatched earlier attach', async () => {
    const { deps } = fakeDeps([
      tab(1, 'https://a.example', true),
      tab(2, 'https://a.example', false),
    ])
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'prompt' } },
    })
    const first = session.handle({ id: 'a', method: 'attach', params: { tabId: 1 } })
    await waitForPendingWhere(session, (item) => item.tabId === 1)
    const second = session.handle({ id: 'b', method: 'attach', params: { tabId: 2 } })
    await waitForPendingWhere(session, (item) => item.tabId === 2)
    await session.handle({ id: 'sync', method: 'ping' })
    const denial = await session.handle({ id: 'd', method: 'deny' })
    expect(denial).toEqual({ id: 'd', ok: true, result: { ok: true } })
    await session.handle({ id: 'settle', method: 'ping' })
    const settled = await Promise.race([second, Promise.resolve('still-pending')])
    expect(settled).toEqual({ id: 'b', ok: false, error: 'attach denied' })
    const after = await session.handle({ id: 's', method: 'status' })
    expect(after.result).toEqual(expect.objectContaining({ pending: undefined }))
    await expect(first).resolves.toEqual({ id: 'a', ok: false, error: 'attach denied' })
  })

  it('keeps a replacement prompt pending when only the origin changed', async () => {
    const { deps, tabs } = fakeDeps([tab(1, 'https://a.example', true)])
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'prompt' } },
    })
    const first = session.handle({ id: 'a', method: 'attach', params: { tabId: 1 } })
    await waitForPendingWhere(session, (item) => item.origin === 'https://a.example')
    const active = tabs[0]
    if (active !== undefined) {
      active.url = 'https://b.example'
    }
    const second = session.handle({ id: 'b', method: 'attach', params: { tabId: 1 } })
    await waitForPendingWhere(session, (item) => item.origin === 'https://b.example')
    await session.handle({ id: 'sync', method: 'ping' })
    const denial = await session.handle({ id: 'd', method: 'deny' })
    expect(denial).toEqual({ id: 'd', ok: true, result: { ok: true } })
    await session.handle({ id: 'settle', method: 'ping' })
    const settled = await Promise.race([second, Promise.resolve('still-pending')])
    expect(settled).toEqual({ id: 'b', ok: false, error: 'attach denied' })
    const after = await session.handle({ id: 's', method: 'status' })
    expect(after.result).toEqual(expect.objectContaining({ pending: undefined }))
    await expect(first).resolves.toEqual({ id: 'a', ok: false, error: 'attach denied' })
  })

  it('detaches without a call when nothing is attached', async () => {
    const { deps, detached } = fakeDeps()
    const session = createExtensionSession(deps)
    const reply = await session.handle({ id: 'd', method: 'detach' })
    expect(reply).toEqual({ id: 'd', ok: true, result: {} })
    expect(detached).toEqual([])
  })

  it('navigates, creates, activates, and closes without dropping attachment', async () => {
    const { deps, tabs, attached } = fakeDeps([
      tab(1, 'https://a.example', true),
      tab(2, 'https://b.example', false),
    ])
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'always' } },
    })
    await session.handle({ id: '1', method: 'attach', params: { tabId: 1 } })
    await session.handle({ id: '2', method: 'goto', params: { url: 'https://x.example' } })
    expect(tabs[0]?.url).toBe('https://x.example')
    await session.handle({ id: '3', method: 'goto' })
    expect(tabs[0]?.url).toBe('')
    const created = await session.handle({
      id: '4',
      method: 'tab_create',
      params: { url: 'https://real.example' },
    })
    expect(created.result).toEqual(expect.objectContaining({ url: 'https://real.example' }))
    const activated = await session.handle({
      id: '5',
      method: 'tab_activate',
      params: { tabId: 2 },
    })
    expect(activated).toEqual({ id: '5', ok: true, result: { tabId: 2 } })
    expect(tabs.map((item) => item.active)).toEqual([false, true, false])
    await session.handle({ id: '6', method: 'tab_close', params: { tabId: 2 } })
    const ping = await session.handle({ id: '7', method: 'ping' })
    expect(ping.result).toEqual({ pong: true, attachedTabId: 1 })
    expect(attached).toEqual([1])
  })

  it('sends exact cdp and evaluate payloads', async () => {
    const { deps, commands } = fakeDeps()
    const session = createExtensionSession(deps)
    await session.handle({
      id: '0',
      method: 'settings',
      params: { op: 'set', patch: { attachPolicy: 'always' } },
    })
    await session.handle({ id: '1', method: 'attach', params: { tabId: 1 } })
    await session.handle({ id: '2', method: 'evaluate', params: { expression: '1+1' } })
    await session.handle({ id: '3', method: 'evaluate' })
    await session.handle({
      id: '4',
      method: 'cdp',
      params: { method: 'Custom.command', params: { a: 1 } },
    })
    await session.handle({ id: '5', method: 'cdp' })
    expect(commands).toStrictEqual([
      { tabId: 1, method: 'Runtime.evaluate', params: { expression: '1+1', returnByValue: true } },
      { tabId: 1, method: 'Runtime.evaluate', params: { expression: '', returnByValue: true } },
      { tabId: 1, method: 'Custom.command', params: { a: 1 } },
      { tabId: 1, method: '', params: undefined },
    ])
  })
})
