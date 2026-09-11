import { describe, expect, it } from 'vitest'
import { cockpitHeadline, filterTabs, tabHost } from '../../src/extension/cockpit.js'
import type { TabInfo } from '../../src/extension/session.js'

describe('filterTabs', () => {
  const tabs = [
    { id: 1, title: 'Teams', url: 'https://teams.cloud.microsoft/v2/', active: true },
    { id: 2, title: 'Jira', url: 'https://nymbl.atlassian.net/browse/NYM-1', active: false },
    { id: 3, title: 'about', url: 'about:blank', active: false },
  ]

  it('returns every tab when the query is empty', () => {
    expect(filterTabs(tabs, '')).toEqual(tabs)
    expect(filterTabs(tabs, '   ')).toEqual(tabs)
  })

  it('matches title, host, or url case-insensitively', () => {
    expect(filterTabs(tabs, 'jira')).toEqual([tabs[1]])
    expect(filterTabs(tabs, 'CLOUD.microsoft')).toEqual([tabs[0]])
    expect(filterTabs(tabs, 'nym-1')).toEqual([tabs[1]])
  })

  it('returns a copied list without inspecting tabs when the query is blank', () => {
    const tab: TabInfo = {
      id: 8,
      title: 'untouched',
      url: 'https://untouched.example/',
      active: false,
    }
    Object.defineProperty(tab, 'url', {
      get() {
        throw new Error('a blank query must not inspect tab fields')
      },
    })
    const result = filterTabs([tab], '   ')
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(tab)
    expect(filterTabs(tabs, '')).not.toBe(tabs)
  })

  it('returns no tabs when the query matches nothing', () => {
    // The literal matches Stryker's string marker so the short-circuit branch
    // cannot silently treat an unmatched query as "match everything".
    expect(filterTabs(tabs, 'Stryker was here!')).toEqual([])
    expect(filterTabs(tabs, 'no-such-tab')).toEqual([])
  })

  it('lowercases the host before matching even for non-ASCII hosts', () => {
    let reads = 0
    const tab: TabInfo = { id: 7, title: 'plain', url: 'unused', active: false }
    Object.defineProperty(tab, 'url', {
      get() {
        reads += 1
        return reads === 1 ? 'faß' : 'https://plain.example/'
      },
    })
    const result = filterTabs([tab], 'ß')
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(tab)
  })
})

describe('tabHost / cockpitHeadline', () => {
  it('shows the host without the scheme', () => {
    expect(tabHost('https://teams.cloud.microsoft/v2/')).toBe('teams.cloud.microsoft')
    expect(tabHost('http://plain.example/path?q=1')).toBe('plain.example')
    expect(tabHost('https://user:pw@EXAMPLE.com:8443/x')).toBe('example.com:8443')
    expect(tabHost('ftp://files.example/pub')).toBe('ftp://files.example/pub')
    expect(tabHost('about:blank')).toBe('about:blank')
    expect(tabHost('not a url')).toBe('not a url')
    expect(tabHost('')).toBe('')
  })

  it('writes an operator headline from live flags', () => {
    expect(
      cockpitHeadline({
        hostConnected: false,
        engineConnected: false,
        paused: false,
        pending: false,
        attachedTabId: undefined,
      }),
    ).toBe('Native host down')
    expect(
      cockpitHeadline({
        hostConnected: true,
        engineConnected: false,
        paused: false,
        pending: false,
        attachedTabId: undefined,
      }),
    ).toBe('Host up · waiting for engine')
    expect(
      cockpitHeadline({
        hostConnected: true,
        engineConnected: true,
        paused: true,
        pending: false,
        attachedTabId: 4,
      }),
    ).toBe('Paused')
    expect(
      cockpitHeadline({
        hostConnected: true,
        engineConnected: true,
        paused: false,
        pending: true,
        attachedTabId: undefined,
      }),
    ).toBe('Allow this origin?')
    expect(
      cockpitHeadline({
        hostConnected: true,
        engineConnected: true,
        paused: false,
        pending: false,
        attachedTabId: 12,
      }),
    ).toBe('Attached to tab 12')
    expect(
      cockpitHeadline({
        hostConnected: true,
        engineConnected: true,
        paused: false,
        pending: false,
        attachedTabId: undefined,
      }),
    ).toBe('Engine live · no tab attached')
  })
})
