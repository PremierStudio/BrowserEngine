import { badgeSpec, groupSpec, type HudState } from './hudState.js'
import { titleMarkExpression, titleUnmarkExpression } from './hudTitle.js'
import { bindNativePort, takeLastError } from './nativePort.js'
import {
  createExtensionSession,
  type SessionReply,
  type SessionRequest,
  type TabInfo,
} from './session.js'

const HOST_NAME = 'ai.premierstudio.browser_engine'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false
}

function asTab(tab: chrome.tabs.Tab): TabInfo {
  return {
    id: tab.id ?? 0,
    title: tab.title ?? '',
    url: tab.url ?? '',
    active: tab.active === true,
  }
}

function asSessionRequest(value: unknown): SessionRequest {
  if (value === undefined || value === null) {
    return { id: 'ui', method: 'status' }
  }
  if (isRecord(value) === false) {
    return { id: '', method: '' }
  }
  const params = value.params
  return {
    id: typeof value.id === 'string' ? value.id : '',
    method: typeof value.method === 'string' ? value.method : '',
    params: isRecord(params) ? params : undefined,
  }
}

const session = createExtensionSession({
  loadSettings: async () => {
    const stored = await chrome.storage.local.get('settings')
    return stored.settings
  },
  saveSettings: async (settings) => {
    await chrome.storage.local.set({ settings })
    broadcast()
  },
  queryTabs: async () => {
    const tabs = await chrome.tabs.query({})
    return tabs.map(asTab)
  },
  getTab: async (id) => {
    try {
      return asTab(await chrome.tabs.get(id))
    } catch {
      return undefined
    }
  },
  createTab: async (url) => asTab(await chrome.tabs.create(url === undefined ? {} : { url })),
  closeTab: async (id) => {
    await chrome.tabs.remove(id)
  },
  updateTab: async (id, update) => {
    await chrome.tabs.update(id, update)
  },
  attachDebugger: async (tabId, version) => {
    await chrome.debugger.attach({ tabId }, version)
  },
  detachDebugger: async (tabId) => {
    await chrome.debugger.detach({ tabId })
  },
  sendCommand: async (tabId, method, params) => {
    if (isRecord(params)) {
      return chrome.debugger.sendCommand({ tabId }, method, params)
    }
    return chrome.debugger.sendCommand({ tabId }, method)
  },
})

let nativePort: chrome.runtime.Port | null = null
let engineConnected = false
const cockpits = new Set<chrome.runtime.Port>()

function broadcast(): void {
  for (const port of cockpits) {
    port.postMessage({ type: 'changed' })
  }
}

function setBadge(text: string, color: string): void {
  void chrome.action.setBadgeText({ text })
  void chrome.action.setBadgeBackgroundColor({ color })
}

async function refreshBadge(): Promise<void> {
  const status = await session.handle({ id: 'badge', method: 'status' })
  const result = isRecord(status.result) ? status.result : undefined
  const settings =
    result === undefined ? undefined : isRecord(result.settings) ? result.settings : undefined
  const show = settings === undefined ? true : settings.showBadge !== false
  if (show === false) {
    setBadge('', '#111')
    return
  }
  const paused = settings !== undefined && settings.paused === true
  if (paused) {
    setBadge('||', '#b45309')
    return
  }
  if (nativePort === null) {
    setBadge('!', '#b91c1c')
    return
  }
  const pending = result === undefined ? undefined : result.pending
  if (pending !== undefined && pending !== null) {
    setBadge('?', '#b45309')
    return
  }
  if (engineConnected === false) {
    setBadge('…', '#6b7280')
    return
  }
  const attached = result === undefined ? undefined : result.attachedTabId
  if (typeof attached === 'number') {
    setBadge('on', '#166534')
    return
  }
  setBadge('ok', '#166534')
}

/* --------------------------------------------------------------------------
   Remote-control signals: tab group, title marker, per-tab badge, page HUD.
   -------------------------------------------------------------------------- */

let controlledTabId: number | undefined
let controlledGroupId: number | undefined
let hudInstalled = false
let hudScriptId: string | undefined
let titleScriptId: string | undefined
let hudSource: string | undefined

function readTabId(result: unknown): number | undefined {
  if (isRecord(result) === false) {
    return undefined
  }
  const tabId = result.tabId
  return typeof tabId === 'number' && Number.isFinite(tabId) ? tabId : undefined
}

async function hudAllowed(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get('settings')
    return isRecord(stored.settings) === false || stored.settings.showHud !== false
  } catch {
    return true
  }
}

async function evaluateInTab(tabId: number, expression: string): Promise<void> {
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression })
  } catch {
    // Detached, tab gone, or a page that forbids evaluation.
  }
}

async function getHudSource(): Promise<string | undefined> {
  if (hudSource !== undefined) {
    return hudSource
  }
  try {
    const response = await fetch(chrome.runtime.getURL('hudOverlay.js'))
    if (response.ok) {
      hudSource = await response.text()
    }
  } catch {
    hudSource = undefined
  }
  return hudSource
}

async function setHudState(state: HudState): Promise<void> {
  if (controlledTabId === undefined || hudInstalled === false) {
    return
  }
  await evaluateInTab(
    controlledTabId,
    `window.__browserEngineHud && window.__browserEngineHud.setState(${JSON.stringify(state)})`,
  )
}

async function paintChrome(state: HudState): Promise<void> {
  const tabId = controlledTabId
  if (tabId === undefined) {
    return
  }
  const spec = groupSpec(state)
  const badge = badgeSpec(state)
  if (state !== 'off' && chrome.tabGroups !== undefined) {
    try {
      if (controlledGroupId === undefined) {
        const current = await chrome.tabs.get(tabId)
        if (current.groupId === -1) {
          controlledGroupId = await chrome.tabs.group({ tabIds: [tabId] })
        }
      }
      if (controlledGroupId !== undefined) {
        await chrome.tabGroups.update(controlledGroupId, { title: spec.title, color: spec.color })
      }
    } catch {
      controlledGroupId = undefined
    }
  }
  try {
    await chrome.action.setBadgeText({ tabId, text: badge.text })
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color })
  } catch {
    // The tab closed between attach and paint.
  }
  if (state === 'active') {
    await evaluateInTab(tabId, titleMarkExpression())
    if (titleScriptId === undefined) {
      try {
        const result = await chrome.debugger.sendCommand(
          { tabId },
          'Page.addScriptToEvaluateOnNewDocument',
          { source: titleMarkExpression() },
        )
        if (isRecord(result) && typeof result.identifier === 'string') {
          titleScriptId = result.identifier
        }
      } catch {
        titleScriptId = undefined
      }
    }
  }
}

async function installHud(tabId: number): Promise<void> {
  if ((await hudAllowed()) === false) {
    return
  }
  const source = await getHudSource()
  if (source === undefined) {
    return
  }
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      'Page.addScriptToEvaluateOnNewDocument',
      { source },
    )
    if (isRecord(result) && typeof result.identifier === 'string') {
      hudScriptId = result.identifier
    }
  } catch {
    hudScriptId = undefined
  }
  await evaluateInTab(tabId, source)
  hudInstalled = true
  await setHudState('active')
}

async function markControlled(tabId: number): Promise<void> {
  controlledTabId = tabId
  await paintChrome('active')
  await installHud(tabId)
  broadcast()
}

async function clearControlled(): Promise<void> {
  const tabId = controlledTabId
  const groupId = controlledGroupId
  controlledTabId = undefined
  controlledGroupId = undefined
  if (tabId === undefined) {
    return
  }
  if (hudScriptId !== undefined) {
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Page.removeScriptToEvaluateOnNewDocument', {
        identifier: hudScriptId,
      })
    } catch {
      // Already detached.
    }
  }
  if (titleScriptId !== undefined) {
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Page.removeScriptToEvaluateOnNewDocument', {
        identifier: titleScriptId,
      })
    } catch {
      // Already detached.
    }
  }
  if (hudInstalled) {
    await evaluateInTab(tabId, 'window.__browserEngineHud && window.__browserEngineHud.destroy()')
  }
  hudInstalled = false
  hudScriptId = undefined
  titleScriptId = undefined
  await evaluateInTab(tabId, titleUnmarkExpression())
  if (groupId !== undefined) {
    try {
      await chrome.tabs.ungroup(tabId)
    } catch {
      // Tab closed or grouping unsupported.
    }
  }
  try {
    await chrome.action.setBadgeText({ tabId, text: '' })
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#000000' })
  } catch {
    // Tab gone.
  }
  broadcast()
}

async function handleControlTraffic(request: SessionRequest, reply: SessionReply): Promise<void> {
  if (request.method === 'attach' && reply.ok === true) {
    const tabId = readTabId(reply.result)
    if (tabId !== undefined) {
      await markControlled(tabId)
    }
    return
  }
  if (request.method === 'detach') {
    await clearControlled()
    return
  }
  if (request.method === 'pause') {
    if (controlledTabId !== undefined) {
      const state: HudState = request.params?.paused === true ? 'paused' : 'active'
      await paintChrome(state)
      await setHudState(state)
    }
    return
  }
}

function isRuntimePort(value: unknown): value is chrome.runtime.Port {
  return (
    typeof value === 'object' &&
    value !== null &&
    'postMessage' in value &&
    typeof value.postMessage === 'function' &&
    'onMessage' in value &&
    'onDisconnect' in value
  )
}

function bindPort(): ReturnType<typeof bindNativePort> | undefined {
  try {
    return bindNativePort(chrome.runtime, HOST_NAME)
  } catch {
    return undefined
  }
}

function connectNative(): void {
  if (nativePort !== null) {
    return
  }
  const bound = bindPort()
  if (bound === undefined || bound.ok === false || isRuntimePort(bound.port) === false) {
    setBadge('!', '#b91c1c')
    setTimeout(connectNative, 1500)
    return
  }
  nativePort = bound.port
  nativePort.onMessage.addListener((message: unknown) => {
    void (async () => {
      if (isRecord(message) && message.event === 'engine') {
        engineConnected = message.connected === true
        if (engineConnected === false) {
          await clearControlled()
        }
        await refreshBadge()
        broadcast()
        return
      }
      const request = asSessionRequest(message)
      const reply = await session.handle(request)
      if (nativePort !== null) {
        nativePort.postMessage(reply)
      }
      await handleControlTraffic(request, reply)
      await refreshBadge()
      broadcast()
    })()
  })
  nativePort.onDisconnect.addListener(() => {
    takeLastError(chrome.runtime)
    nativePort = null
    engineConnected = false
    void clearControlled()
    setBadge('!', '#b91c1c')
    broadcast()
    setTimeout(connectNative, 1500)
  })
  void refreshBadge()
}

async function openCockpit(): Promise<void> {
  if (chrome.sidePanel === undefined) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') })
    return
  }
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    const tab = tabs[0]
    if (tab?.windowId !== undefined) {
      if (typeof tab.id === 'number') {
        await chrome.sidePanel.open({ windowId: tab.windowId, tabId: tab.id })
        return
      }
      await chrome.sidePanel.open({ windowId: tab.windowId })
    }
  } catch {
    // sidePanel.open() requires a user gesture; when this runs from a message
    // or a command that lost it, open the cockpit as a normal tab instead.
    await chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') })
  }
}

const RECONNECT_ALARM = 'browser-engine-reconnect'

chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 })

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM && nativePort === null) {
    connectNative()
  }
})

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cockpit') {
    return
  }
  cockpits.add(port)
  port.onDisconnect.addListener(() => {
    cockpits.delete(port)
  })
})

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  void (async () => {
    if (isRecord(message) === false) {
      return
    }
    if (message.type === 'command') {
      const reply = await session.handle(asSessionRequest(message.request))
      await refreshBadge()
      sendResponse({ reply, hostConnected: nativePort !== null, engineConnected })
      return
    }
    if (message.type === 'openOptions') {
      await chrome.runtime.openOptionsPage()
      sendResponse({ ok: true })
      return
    }
    if (message.type === 'openPanel') {
      await openCockpit()
      sendResponse({ ok: true })
    }
  })()
  return true
})

chrome.commands.onCommand.addListener((command) => {
  if (command === 'kill-switch') {
    void (async () => {
      const pauseRequest = { id: 'kill', method: 'pause', params: { paused: true } }
      const paused = await session.handle(pauseRequest)
      await handleControlTraffic(pauseRequest, paused)
      const detachRequest = { id: 'kill-detach', method: 'detach' }
      const detached = await session.handle(detachRequest)
      await handleControlTraffic(detachRequest, detached)
      await refreshBadge()
      broadcast()
    })()
    return
  }
  if (command === 'open-cockpit') {
    void openCockpit()
  }
})

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === controlledTabId) {
    void clearControlled()
  }
  void refreshBadge()
  broadcast()
})

chrome.tabs.onUpdated.addListener(() => {
  broadcast()
})
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === controlledTabId) {
    void clearControlled()
  }
  broadcast()
})
chrome.tabs.onActivated.addListener(() => {
  broadcast()
})

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel !== undefined) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
  }
})

connectNative()
void refreshBadge()
