import { bindNativePort, takeLastError } from './nativePort.js'
import { createExtensionSession, type SessionRequest, type TabInfo } from './session.js'

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
        await refreshBadge()
        broadcast()
        return
      }
      const reply = await session.handle(asSessionRequest(message))
      if (nativePort !== null) {
        nativePort.postMessage(reply)
      }
      await refreshBadge()
      broadcast()
    })()
  })
  nativePort.onDisconnect.addListener(() => {
    takeLastError(chrome.runtime)
    nativePort = null
    engineConnected = false
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
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  const tab = tabs[0]
  if (tab?.windowId !== undefined) {
    if (typeof tab.id === 'number') {
      await chrome.sidePanel.open({ windowId: tab.windowId, tabId: tab.id })
      return
    }
    await chrome.sidePanel.open({ windowId: tab.windowId })
  }
}

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
    void session
      .handle({ id: 'kill', method: 'pause', params: { paused: true } })
      .then(() => session.handle({ id: 'kill-detach', method: 'detach' }))
    return
  }
  if (command === 'open-cockpit') {
    void openCockpit()
  }
})

chrome.debugger.onDetach.addListener(() => {
  void refreshBadge()
  broadcast()
})

chrome.tabs.onUpdated.addListener(() => {
  broadcast()
})
chrome.tabs.onRemoved.addListener(() => {
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
