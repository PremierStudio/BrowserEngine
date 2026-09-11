import { describe, expect, it } from 'vitest'
import {
  HUMAN_TYPE_MS,
  clickUid,
  hoverUid,
  navigateTo,
  pressKey,
  scrollUid,
  selectUid,
  typeCharMs,
  typeUid,
} from '../../src/context/actOnPage.js'
import type { PageLike } from '../../src/context/ContextPage.js'

interface CdpCall {
  session: string
  method: string
  params: unknown
}

function recordingPage(): PageLike & {
  cdpCalls: CdpCall[]
  evals: unknown[]
  gotos: string[]
  keys: string[]
} {
  const cdpCalls: CdpCall[] = []
  const evals: unknown[] = []
  const gotos: string[] = []
  const keys: string[] = []
  return {
    cdpCalls,
    evals,
    gotos,
    keys,
    accessibility: { snapshot: async () => ({}) },
    cdp: async (session, method, params) => {
      cdpCalls.push({ session, method, params })
      if (method === 'DOM.resolveNode') {
        return { object: { objectId: 'obj-1' } }
      }
      return {}
    },
    screenshot: async () => '',
    evaluate: async (fn, arg) => {
      evals.push({ fn, arg })
      return undefined
    },
    goto: async (url) => {
      gotos.push(url)
    },
    keyboardPress: async (key) => {
      keys.push(key)
    },
  }
}

describe('typeCharMs', () => {
  it('is snappy out of the box and instant only when forced headless', () => {
    expect(HUMAN_TYPE_MS).toBe(28)
    expect(typeCharMs({})).toBe(HUMAN_TYPE_MS)
    expect(typeCharMs({ BROWSER_ENGINE_HEADED: '0' })).toBe(0)
    expect(typeCharMs({ BROWSER_ENGINE_HEADED: '1' })).toBe(HUMAN_TYPE_MS)
    expect(typeCharMs({ BROWSER_ENGINE_TYPE_MS: '15' })).toBe(15)
    expect(typeCharMs({ BROWSER_ENGINE_TYPE_MS: '0' })).toBe(0)
    expect(typeCharMs({ BROWSER_ENGINE_HEADED: '1', BROWSER_ENGINE_TYPE_MS: '0' })).toBe(0)
    expect(typeCharMs({ BROWSER_ENGINE_TYPE_MS: '-1' })).toBe(HUMAN_TYPE_MS)
    expect(typeCharMs({ BROWSER_ENGINE_HEADED: '0', BROWSER_ENGINE_TYPE_MS: 'nope' })).toBe(0)
    expect(typeCharMs({ BROWSER_ENGINE_HEADED: '0' }, ['--headed'])).toBe(HUMAN_TYPE_MS)
  })
})

describe('actOnPage', () => {
  it('click resolves the uid and calls Runtime.callFunctionOn', async () => {
    const page = recordingPage()
    await clickUid(page, 'loader-1_42')
    expect(page.cdpCalls).toContainEqual({
      session: 'page',
      method: 'DOM.resolveNode',
      params: { backendNodeId: 42 },
    })
    const call = page.cdpCalls.find((c) => c.method === 'Runtime.callFunctionOn')
    const fn = JSON.stringify(call?.params)
    expect(fn).toMatch(/obj-1/)
    expect(fn).toMatch(/data-ba-hud/)
    expect(fn).toMatch(/this\.click\(\)/)
    expect(fn).toMatch(/getBoundingClientRect/)
  })

  it('type focuses, then inserts each character, then commits change', async () => {
    const page = recordingPage()
    await typeUid(page, 'loader-1_42', 'hi')
    expect(page.cdpCalls.some((c) => c.method === 'DOM.resolveNode')).toBe(true)
    const fns = page.cdpCalls
      .filter((c) => c.method === 'Runtime.callFunctionOn')
      .map((c) => JSON.stringify(c.params))
    expect(fns).toHaveLength(4)
    expect(fns[0]).toMatch(/data-ba-hud/)
    expect(fns[0]).toMatch(/this\.focus\(\)/)
    expect(fns[0]).not.toMatch(/insertText/)
    expect(fns[1]).toMatch(/insertText/)
    expect(fns[1]).toMatch(/data:\\"h\\"/)
    expect(fns[2]).toMatch(/insertText/)
    expect(fns[2]).toMatch(/data:\\"i\\"/)
    expect(fns[3]).toMatch(/change/)
    expect(fns.some((fn) => fn.includes('getOwnPropertyDescriptor'))).toBe(true)
  })

  it('pauses between characters when charMs is set', async () => {
    const page = recordingPage()
    const sleeps: number[] = []
    await typeUid(page, 'loader-1_42', 'ab', {
      charMs: 7,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    expect(sleeps).toEqual([7, 7])
  })

  it('skips the pause when sleep is omitted', async () => {
    const page = recordingPage()
    await expect(typeUid(page, 'loader-1_42', 'ab', { charMs: 7 })).resolves.toBeUndefined()
    expect(page.cdpCalls.filter((c) => c.method === 'Runtime.callFunctionOn')).toHaveLength(4)
  })

  it('does not pause when charMs is zero even if sleep is provided', async () => {
    const page = recordingPage()
    let slept = 0
    await typeUid(page, 'loader-1_42', 'ab', {
      charMs: 0,
      sleep: async () => {
        slept += 1
      },
    })
    expect(slept).toBe(0)
  })

  it('focuses and commits when the text is empty', async () => {
    const page = recordingPage()
    await typeUid(page, 'loader-1_42', '')
    const fns = page.cdpCalls
      .filter((c) => c.method === 'Runtime.callFunctionOn')
      .map((c) => JSON.stringify(c.params))
    expect(fns).toHaveLength(2)
    expect(fns[0]).toMatch(/focus/)
    expect(fns[1]).toMatch(/change/)
  })

  it('hover, scroll, and select dispatch through callFunctionOn', async () => {
    const page = recordingPage()
    await hoverUid(page, 'loader-1_42')
    await scrollUid(page, 'loader-1_42', 1, 2)
    await selectUid(page, 'loader-1_42', 'opt')
    const fns = page.cdpCalls
      .filter((c) => c.method === 'Runtime.callFunctionOn')
      .map((c) => JSON.stringify(c.params))
    expect(fns.some((fn) => fn.includes('mouseover') || fn.includes('hover'))).toBe(true)
    expect(fns.some((fn) => fn.includes('scrollBy') || fn.includes('scroll'))).toBe(true)
    expect(fns.some((fn) => fn.includes('opt'))).toBe(true)
    expect(fns.every((fn) => fn.includes('data-ba-hud'))).toBe(true)
  })

  it('press uses keyboardPress and navigate uses goto', async () => {
    const page = recordingPage()
    await pressKey(page, 'Enter')
    await navigateTo(page, 'https://example.com')
    expect(page.keys).toEqual(['Enter'])
    expect(page.gotos).toEqual(['https://example.com'])
    expect(JSON.stringify(page.evals)).toMatch(/data-ba-hud/)
    expect(JSON.stringify(page.evals)).toMatch(/Enter/)
  })

  it('throws on an invalid uid', async () => {
    const page = recordingPage()
    await expect(clickUid(page, 'nope')).rejects.toThrow(/invalid uid/i)
    await expect(typeUid(page, 'nope', 'x')).rejects.toThrow(/invalid uid/i)
    await expect(hoverUid(page, 'nope')).rejects.toThrow(/invalid uid/i)
    await expect(scrollUid(page, 'nope', 0, 0)).rejects.toThrow(/invalid uid/i)
    await expect(selectUid(page, 'nope', 'v')).rejects.toThrow(/invalid uid/i)
  })

  it('throws when resolveNode does not return an objectId', async () => {
    const page = recordingPage()
    page.cdp = async () => ({})
    await expect(clickUid(page, 'loader-1_42')).rejects.toThrow(/resolve/i)
  })

  it('throws when resolveNode is null or objectId is not a string', async () => {
    const payloads: unknown[] = [
      null,
      { object: null },
      { object: {} },
      { object: { objectId: 1 } },
    ]
    for (const resolved of payloads) {
      const page = recordingPage()
      page.cdp = async (session, method, params) => {
        page.cdpCalls.push({ session, method, params })
        return resolved
      }
      await expect(clickUid(page, 'loader-1_42')).rejects.toThrow('Failed to resolve element')
      expect(page.cdpCalls).toEqual([
        { session: 'page', method: 'DOM.resolveNode', params: { backendNodeId: 42 } },
      ])
    }
  })

  it('sends both CDP calls on the page session', async () => {
    const page = recordingPage()
    await clickUid(page, 'loader-1_42')
    expect(page.cdpCalls.map((call) => call.session)).toEqual(['page', 'page'])
    expect(page.cdpCalls[0]).toEqual({
      session: 'page',
      method: 'DOM.resolveNode',
      params: { backendNodeId: 42 },
    })
    expect(page.cdpCalls[1]?.session).toBe('page')
    expect(page.cdpCalls[1]?.method).toBe('Runtime.callFunctionOn')
  })
})
