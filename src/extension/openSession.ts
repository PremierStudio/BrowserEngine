import type { TabHost, TabPage } from '../browser/tabDesk.js'
import { PuppeteerContextPage } from '../context/ContextPage.js'
import type { ContextPage } from '../context/ContextPage.js'
import type { createExtensionBridge } from './bridge.js'
import { createExtensionPageLike } from './extensionPage.js'

type Bridge = ReturnType<typeof createExtensionBridge>

/** A tab row as reported by the extension's `tabs` request. */
type TabRow = {
  id: number
  title?: string
  url?: string
  active?: boolean
}

/** Attach an attachable tab and wrap it as a ContextPage. */
export async function openExtensionContextPage(bridge: Bridge): Promise<ContextPage> {
  const raw = await bridge.request('tabs')
  if (!isTabList(raw)) {
    throw new Error('no attachable tab')
  }
  const target = pickAttachTarget(raw)
  if (target === undefined) {
    throw new Error('no attachable tab')
  }
  await bridge.request('attach', { tabId: target.id })
  const like = createExtensionPageLike({
    send: (method, params) => bridge.request('cdp', { method, params }),
  })
  return new PuppeteerContextPage(like)
}

// The only caller already rejects arrays through isTabList, so the array
// check lives there once.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTabList(value: unknown): value is TabRow[] {
  return Array.isArray(value)
}

function isHttpUrl(url: string | undefined): boolean {
  return url !== undefined && (url.startsWith('http://') || url.startsWith('https://'))
}

/** Prefer the active http(s) tab; otherwise the first http(s) tab. */
function pickAttachTarget(tabs: TabRow[]): TabRow | undefined {
  for (const tab of tabs) {
    if (tab.active === true && isHttpUrl(tab.url)) {
      return tab
    }
  }
  for (const tab of tabs) {
    if (isHttpUrl(tab.url)) {
      return tab
    }
  }
  return undefined
}

/** Tab desk over chrome.tabs via the extension. */
export function createExtensionTabHost(bridge: Bridge): TabHost {
  let current: string | undefined
  return {
    list: async () => {
      const raw = await bridge.request('tabs')
      const pages: TabPage[] = []
      if (!isTabList(raw)) {
        return pages
      }
      for (const tab of raw) {
        pages.push({
          id: String(tab.id),
          title: tab.title ?? '',
          url: tab.url ?? '',
        })
      }
      return pages
    },
    create: async (url) => {
      const raw = await bridge.request('tab_create', url === undefined ? {} : { url })
      if (isTabList(raw) === false && isRecord(raw) && typeof raw.id === 'number') {
        const page = {
          id: String(raw.id),
          title: typeof raw.title === 'string' ? raw.title : '',
          url: typeof raw.url === 'string' ? raw.url : (url ?? ''),
        }
        current = page.id
        return page
      }
      throw new Error('tab_create returned no tab')
    },
    close: async (id) => {
      await bridge.request('tab_close', { tabId: Number(id) })
      if (current === id) {
        current = undefined
      }
    },
    activate: async (id) => {
      await bridge.request('attach', { tabId: Number(id) })
      current = id
    },
    currentId: () => current,
    setCurrentId: (id) => {
      current = id
    },
  }
}
