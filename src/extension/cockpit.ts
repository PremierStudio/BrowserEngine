import type { TabInfo } from './session.js'

/** Filter cockpit tabs by title, host, or url. */
export function filterTabs(tabs: readonly TabInfo[], query: string): TabInfo[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return [...tabs]
  }
  const matched: TabInfo[] = []
  for (const tab of tabs) {
    const host = tabHost(tab.url).toLowerCase()
    const hay = `${tab.title} ${tab.url} ${host}`.toLowerCase()
    if (hay.includes(needle)) {
      matched.push(tab)
    }
  }
  return matched
}

/** Host of an http(s) URL, otherwise the raw string. */
export function tabHost(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.host
    }
    return url
  } catch {
    return url
  }
}

export type CockpitFlags = {
  hostConnected: boolean
  engineConnected: boolean
  paused: boolean
  pending: boolean
  attachedTabId: number | undefined
}

/** One-line operator status for the popup and panel header. */
export function cockpitHeadline(flags: CockpitFlags): string {
  if (flags.hostConnected === false) {
    return 'Native host down'
  }
  if (flags.paused) {
    return 'Paused'
  }
  if (flags.pending) {
    return 'Allow this origin?'
  }
  if (flags.attachedTabId !== undefined) {
    return `Attached to tab ${flags.attachedTabId}`
  }
  if (flags.engineConnected === false) {
    return 'Host up · waiting for engine'
  }
  return 'Engine live · no tab attached'
}
