import { decideAttach } from './attachGate.js'
import {
  DEFAULT_SETTINGS,
  originFromUrl,
  parseSettings,
  patchSettings,
  type EngineSettings,
} from './settings.js'

export type TabInfo = {
  id: number
  title: string
  url: string
  active: boolean
}

export type ActivityEntry = {
  t: number
  method: string
  ok: boolean
  detail: string
}

export type PendingAttach = {
  tabId: number
  origin: string
  url: string
  title: string
}

type PendingEntry = PendingAttach & { resolve: (ok: boolean) => void }

export type SessionStatus = {
  attachedTabId: number | undefined
  pending: PendingAttach | undefined
  settings: EngineSettings
  tabs: TabInfo[]
  activity: ActivityEntry[]
}

export type SessionRequest = {
  id: string
  method: string
  params?: Record<string, unknown>
}

export type SessionReply = {
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

export type SessionDeps = {
  loadSettings: () => Promise<unknown>
  saveSettings: (settings: EngineSettings) => Promise<void>
  queryTabs: () => Promise<TabInfo[]>
  getTab: (id: number) => Promise<TabInfo | undefined>
  createTab: (url?: string) => Promise<TabInfo>
  closeTab: (id: number) => Promise<void>
  updateTab: (id: number, update: { url?: string; active?: boolean }) => Promise<void>
  attachDebugger: (tabId: number, version: string) => Promise<void>
  detachDebugger: (tabId: number) => Promise<void>
  sendCommand: (tabId: number, method: string, params?: unknown) => Promise<unknown>
  now?: () => number
}

const ACTIVITY_CAP = 50

const SILENT = new Set(['status', 'ping', 'activity', 'tabs'])

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value)
}

function numberParam(params: Record<string, unknown> | undefined, key: string): number | undefined {
  if (params === undefined) {
    return undefined
  }
  const value = params[key]
  return isFiniteNumber(value) ? value : undefined
}

function stringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  if (params === undefined) {
    return undefined
  }
  const value = params[key]
  return typeof value === 'string' ? value : undefined
}

/** In-memory cockpit: settings, attach gate, tabs, activity. */
export function createExtensionSession(deps: SessionDeps) {
  let settings = parseSettings(undefined)
  let attachedTabId: number | undefined
  let pending: PendingEntry | undefined
  const activity: ActivityEntry[] = []

  function stamp(method: string, ok: boolean, detail: string): void {
    const t = deps.now === undefined ? Date.now() : deps.now()
    activity.push({ t, method, ok, detail })
    if (activity.length > ACTIVITY_CAP) {
      activity.shift()
    }
  }

  async function persist(next: EngineSettings): Promise<EngineSettings> {
    settings = parseSettings(next)
    await deps.saveSettings(settings)
    return settings
  }

  async function load(): Promise<EngineSettings> {
    settings = parseSettings(await deps.loadSettings())
    return settings
  }

  async function statusResult(): Promise<SessionStatus> {
    await load()
    return {
      attachedTabId,
      pending:
        pending === undefined
          ? undefined
          : {
              tabId: pending.tabId,
              origin: pending.origin,
              url: pending.url,
              title: pending.title,
            },
      settings,
      tabs: await deps.queryTabs(),
      activity: [...activity],
    }
  }

  async function ensureAttached(tabId: number): Promise<void> {
    if (attachedTabId === tabId) {
      return
    }
    if (attachedTabId !== undefined) {
      try {
        await deps.detachDebugger(attachedTabId)
      } catch {
        // already detached
      }
    }
    await deps.attachDebugger(tabId, settings.debuggerVersion)
    attachedTabId = tabId
  }

  async function resolveTarget(
    params: Record<string, unknown> | undefined,
  ): Promise<TabInfo | undefined> {
    const tabId = numberParam(params, 'tabId')
    const explicitTabId = (tabId ?? 0) > 0 ? tabId : undefined
    if (explicitTabId !== undefined) {
      return deps.getTab(explicitTabId)
    }
    if (settings.autoAttachActiveTab === false) {
      return undefined
    }
    const tabs = await deps.queryTabs()
    for (const item of tabs) {
      if (item.active) {
        return item
      }
    }
    return tabs[0]
  }

  function waitForAllow(info: PendingAttach): Promise<{ approved: boolean; entry: PendingEntry }> {
    if (pending !== undefined) {
      pending.resolve(false)
    }
    return new Promise((resolve) => {
      const entry: PendingEntry = {
        ...info,
        resolve: (ok) => resolve({ approved: ok, entry }),
      }
      pending = entry
    })
  }

  async function attach(params: Record<string, unknown> | undefined): Promise<unknown> {
    await load()
    const target = await resolveTarget(params)
    if (target === undefined) {
      throw new Error('no tab')
    }
    const origin = originFromUrl(target.url)
    const decision = decideAttach(settings, origin)
    if (decision === 'deny') {
      throw new Error('paused')
    }
    if (decision === 'prompt') {
      const info = {
        tabId: target.id,
        origin: origin ?? target.url,
        url: target.url,
        title: target.title,
      }
      const wait = await waitForAllow(info)
      if (pending === wait.entry) {
        pending = undefined
      }
      if (wait.approved === false) {
        throw new Error('attach denied')
      }
      if (origin !== undefined && settings.allowedOrigins.includes(origin) === false) {
        await persist({ ...settings, allowedOrigins: [...settings.allowedOrigins, origin] })
      }
    }
    await ensureAttached(target.id)
    return { tabId: target.id }
  }

  async function handleSettings(
    params: Record<string, unknown> | undefined,
  ): Promise<EngineSettings> {
    await load()
    const safeParams = params ?? {}
    const op = stringParam(safeParams, 'op')
    if (op === 'reset') {
      return persist(DEFAULT_SETTINGS)
    }
    if (op === 'set') {
      return persist(patchSettings(settings, safeParams.patch))
    }
    return settings
  }

  async function run(
    method: string,
    params: Record<string, unknown> | undefined,
  ): Promise<unknown> {
    if (method === 'ping') {
      return { pong: true, attachedTabId }
    }
    if (method === 'status') {
      return statusResult()
    }
    if (method === 'tabs') {
      return deps.queryTabs()
    }
    if (method === 'settings') {
      return handleSettings(params)
    }
    if (method === 'activity') {
      return [...activity]
    }
    if (method === 'pause') {
      const paused = params?.paused
      return persist(patchSettings(settings, { paused: paused === true }))
    }
    if (method === 'allow') {
      const origin = stringParam(params, 'origin')
      if (pending !== undefined && (origin === undefined || origin === pending.origin)) {
        pending.resolve(true)
      } else if (origin !== undefined && settings.allowedOrigins.includes(origin) === false) {
        await persist({ ...settings, allowedOrigins: [...settings.allowedOrigins, origin] })
      }
      return { ok: true }
    }
    if (method === 'deny') {
      if (pending !== undefined) {
        pending.resolve(false)
      }
      return { ok: true }
    }
    if (method === 'attach') {
      return attach(params)
    }
    if (method === 'detach') {
      if (attachedTabId !== undefined) {
        await deps.detachDebugger(attachedTabId)
        attachedTabId = undefined
      }
      return {}
    }
    if (method === 'goto') {
      if (attachedTabId === undefined) {
        throw new Error('not attached')
      }
      const url = stringParam(params, 'url') ?? ''
      await deps.updateTab(attachedTabId, { url })
      return {}
    }
    if (method === 'tab_create') {
      return deps.createTab(stringParam(params, 'url'))
    }
    if (method === 'tab_close') {
      const tabId = numberParam(params, 'tabId')
      if (tabId === undefined) {
        throw new Error('tabId required')
      }
      await deps.closeTab(tabId)
      if (attachedTabId === tabId) {
        attachedTabId = undefined
      }
      return {}
    }
    if (method === 'tab_activate') {
      const tabId = numberParam(params, 'tabId')
      if (tabId === undefined) {
        throw new Error('tabId required')
      }
      await deps.updateTab(tabId, { active: true })
      return { tabId }
    }
    if (method === 'cdp' || method === 'evaluate') {
      if (attachedTabId === undefined) {
        throw new Error('not attached')
      }
      const cdpMethod =
        method === 'evaluate' ? 'Runtime.evaluate' : (stringParam(params, 'method') ?? '')
      const cdpParams =
        method === 'evaluate'
          ? { expression: stringParam(params, 'expression') ?? '', returnByValue: true }
          : params?.params
      return deps.sendCommand(attachedTabId, cdpMethod, cdpParams)
    }
    throw new Error(`unknown method ${method}`)
  }

  return {
    async handle(request: SessionRequest): Promise<SessionReply> {
      const silent =
        SILENT.has(request.method) ||
        (request.method === 'settings' && (stringParam(request.params, 'op') ?? 'get') === 'get')
      try {
        const result = await run(request.method, request.params)
        if (silent === false) {
          stamp(request.method, true, '')
        }
        return { id: request.id, ok: true, result }
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        if (silent === false) {
          stamp(request.method, false, text)
        }
        return { id: request.id, ok: false, error: text }
      }
    },
  }
}
