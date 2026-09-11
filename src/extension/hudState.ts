import type { HudEvent } from './hudSignals.js'

/** Whether the HUD shows control, a pause, or nothing. */
export type HudState = 'active' | 'paused' | 'off'

/** Chrome tab-group title and color for a HUD state. */
export type TabGroupSpec = { title: string; color: 'green' | 'yellow' | 'grey' }

/** Tab-group title and color that match the HUD state. */
export function groupSpec(state: HudState): TabGroupSpec {
  if (state === 'paused') {
    return { title: 'BrowserEngine (paused)', color: 'yellow' }
  }
  if (state === 'off') {
    return { title: 'BrowserEngine', color: 'grey' }
  }
  return { title: 'BrowserEngine', color: 'green' }
}

/** Toolbar badge text and color that match the HUD state. */
export function badgeSpec(state: HudState): { text: string; color: string } {
  if (state === 'paused') {
    return { text: '||', color: '#b45309' }
  }
  if (state === 'off') {
    return { text: '', color: '#000000' }
  }
  return { text: 'ON', color: '#166534' }
}

/** In-page pill copy for the HUD state, empty when off. */
export function pillText(state: HudState): string {
  if (state === 'paused') {
    return 'BrowserEngine paused — Ctrl+Shift+U to resume'
  }
  if (state === 'off') {
    return ''
  }
  return 'BrowserEngine is controlling this tab — Ctrl+Shift+U to pause'
}

/** Runtime.evaluate source that forwards one HUD event to the injected overlay. */
export function hudEventExpression(event: HudEvent): string {
  return `window.__browserEngineHud && window.__browserEngineHud.handle(${JSON.stringify(event)})`
}
