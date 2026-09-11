import { describe, expect, it } from 'vitest'
import { badgeSpec, groupSpec, hudEventExpression, pillText } from '../../src/extension/hudState.js'

describe('groupSpec', () => {
  it('groups an active tab in green', () => {
    expect(groupSpec('active')).toEqual({ title: 'BrowserEngine', color: 'green' })
  })

  it('groups a paused tab in yellow', () => {
    expect(groupSpec('paused')).toEqual({ title: 'BrowserEngine (paused)', color: 'yellow' })
  })

  it('groups an off tab in grey', () => {
    expect(groupSpec('off')).toEqual({ title: 'BrowserEngine', color: 'grey' })
  })
})

describe('badgeSpec', () => {
  it('shows a green ON badge while active', () => {
    expect(badgeSpec('active')).toEqual({ text: 'ON', color: '#166534' })
  })

  it('shows an amber pause badge when paused', () => {
    expect(badgeSpec('paused')).toEqual({ text: '||', color: '#b45309' })
  })

  it('shows nothing while off', () => {
    expect(badgeSpec('off')).toEqual({ text: '', color: '#000000' })
  })
})

describe('pillText', () => {
  it('offers the pause shortcut while active', () => {
    expect(pillText('active')).toBe('BrowserEngine is controlling this tab — Ctrl+Shift+U to pause')
  })

  it('offers the resume shortcut when paused', () => {
    expect(pillText('paused')).toBe('BrowserEngine paused — Ctrl+Shift+U to resume')
  })

  it('is empty while off', () => {
    expect(pillText('off')).toBe('')
  })
})

describe('hudEventExpression', () => {
  it('guards on the injected handle and serializes the event', () => {
    expect(hudEventExpression({ kind: 'move', x: 1, y: 2 })).toBe(
      'window.__browserEngineHud && window.__browserEngineHud.handle({"kind":"move","x":1,"y":2})',
    )
    expect(hudEventExpression({ kind: 'click', x: 3, y: 4 })).toBe(
      'window.__browserEngineHud && window.__browserEngineHud.handle({"kind":"click","x":3,"y":4})',
    )
    expect(hudEventExpression({ kind: 'type', text: 'hi' })).toBe(
      'window.__browserEngineHud && window.__browserEngineHud.handle({"kind":"type","text":"hi"})',
    )
    expect(hudEventExpression({ kind: 'key', key: 'Enter' })).toBe(
      'window.__browserEngineHud && window.__browserEngineHud.handle({"kind":"key","key":"Enter"})',
    )
    expect(hudEventExpression({ kind: 'scroll', x: 5, y: 6, deltaY: -120 })).toBe(
      'window.__browserEngineHud && window.__browserEngineHud.handle({"kind":"scroll","x":5,"y":6,"deltaY":-120})',
    )
    expect(hudEventExpression({ kind: 'navigate', url: 'https://example.test/a' })).toBe(
      'window.__browserEngineHud && window.__browserEngineHud.handle({"kind":"navigate","url":"https://example.test/a"})',
    )
  })

  it('escapes an event string with JSON rules', () => {
    const expression = hudEventExpression({ kind: 'type', text: 'a"b' })
    expect(expression).toBe(
      'window.__browserEngineHud && window.__browserEngineHud.handle({"kind":"type","text":"a\\"b"})',
    )
  })
})
