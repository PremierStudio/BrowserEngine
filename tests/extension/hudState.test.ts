import { describe, expect, it } from 'vitest'
import { badgeSpec, groupSpec, pillText } from '../../src/extension/hudState.js'

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
