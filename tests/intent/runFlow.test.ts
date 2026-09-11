import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXPECT_TIMEOUT_MS,
  HUMAN_PACE_MS,
  flowExpectTimeoutMs,
  flowPaceMs,
  runFlow,
  runFlowToolOptions,
  throwCompileError,
} from '../../src/intent/runFlow.js'
import { bindTarget } from '../../src/intent/resolveTarget.js'
import { outlineFromUnknown } from '../../src/snapshot/outline.js'

const DEFAULT_EXPECT_INTERVAL_MS = 20
import type { ContextPage } from '../../src/context/ContextPage.js'

function recordPage(): ContextPage & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    getElementByUid: async () => undefined,
    waitForEventsAfterAction: async () => undefined,
    observe: async () => ({
      snapshot: { uid: 'x', role: 'generic', name: '' },
      image: '',
      overlay: {},
      pageState: { url: '', title: '' },
    }),
    emulate: async () => undefined,
    getDialog: async () => null,
    click: async (uid) => {
      calls.push(`click:${uid}`)
    },
    type: async (uid, text) => {
      calls.push(`type:${uid}:${text}`)
    },
    hover: async (uid) => {
      calls.push(`hover:${uid}`)
    },
    scroll: async (uid, dx, dy) => {
      calls.push(`scroll:${uid}:${dx}:${dy}`)
    },
    select: async (uid, value) => {
      calls.push(`select:${uid}:${value}`)
    },
    press: async (key) => {
      calls.push(`press:${key}`)
    },
    navigate: async (url) => {
      calls.push(`navigate:${url}`)
    },
  }
}

describe('flowPaceMs', () => {
  it('is the watchable headed default unless forced headless', () => {
    expect(HUMAN_PACE_MS).toBe(700)
    expect(flowPaceMs({})).toBe(HUMAN_PACE_MS)
    expect(flowPaceMs({ BROWSER_ENGINE_HEADED: '1' })).toBe(HUMAN_PACE_MS)
    expect(flowPaceMs({ BROWSER_ENGINE_HEADED: '0' })).toBe(0)
  })

  it('honors BROWSER_ENGINE_PACE_MS and ignores junk', () => {
    expect(flowPaceMs({ BROWSER_ENGINE_PACE_MS: '200' })).toBe(200)
    expect(flowPaceMs({ BROWSER_ENGINE_HEADED: '0', BROWSER_ENGINE_PACE_MS: '50' })).toBe(50)
    expect(flowPaceMs({ BROWSER_ENGINE_PACE_MS: '0' })).toBe(0)
    expect(flowPaceMs({ BROWSER_ENGINE_HEADED: '1', BROWSER_ENGINE_PACE_MS: '0' })).toBe(0)
    expect(flowPaceMs({ BROWSER_ENGINE_PACE_MS: 'nope' })).toBe(HUMAN_PACE_MS)
    expect(flowPaceMs({ BROWSER_ENGINE_PACE_MS: '-1' })).toBe(HUMAN_PACE_MS)
    expect(flowPaceMs({ BROWSER_ENGINE_HEADED: '0', BROWSER_ENGINE_PACE_MS: 'nope' })).toBe(0)
    expect(flowPaceMs({ BROWSER_ENGINE_HEADED: '0' }, ['--headed'])).toBe(HUMAN_PACE_MS)
  })
})

describe('throwCompileError', () => {
  it('uses the matching step action, not the last step', () => {
    expect(() =>
      throwCompileError(
        [
          { action: 'hover', name: 'Go' },
          { action: 'click', name: 'Login', expectText: 'x' },
        ],
        { error: 'unknown action: explode', index: 0 },
      ),
    ).toThrow(/^step 1 hover: unknown action: explode$/)
  })

  it('falls back to flow when the index is missing', () => {
    expect(() => throwCompileError([], { error: 'gone', index: 0 })).toThrow(/^step 1 flow: gone$/)
  })
})

describe('flowExpectTimeoutMs', () => {
  it('is a headed wait unless forced headless', () => {
    expect(DEFAULT_EXPECT_TIMEOUT_MS).toBe(5000)
    expect(flowExpectTimeoutMs({})).toBe(DEFAULT_EXPECT_TIMEOUT_MS)
    expect(flowExpectTimeoutMs({ BROWSER_ENGINE_HEADED: '1' })).toBe(DEFAULT_EXPECT_TIMEOUT_MS)
    expect(flowExpectTimeoutMs({ BROWSER_ENGINE_HEADED: '0' })).toBe(0)
  })

  it('honors BROWSER_ENGINE_EXPECT_MS and ignores junk', () => {
    expect(flowExpectTimeoutMs({ BROWSER_ENGINE_EXPECT_MS: '250' })).toBe(250)
    expect(
      flowExpectTimeoutMs({ BROWSER_ENGINE_HEADED: '0', BROWSER_ENGINE_EXPECT_MS: '40' }),
    ).toBe(40)
    expect(flowExpectTimeoutMs({ BROWSER_ENGINE_EXPECT_MS: '0' })).toBe(0)
    expect(flowExpectTimeoutMs({ BROWSER_ENGINE_EXPECT_MS: 'nope' })).toBe(
      DEFAULT_EXPECT_TIMEOUT_MS,
    )
    expect(flowExpectTimeoutMs({ BROWSER_ENGINE_EXPECT_MS: '-1' })).toBe(DEFAULT_EXPECT_TIMEOUT_MS)
    expect(
      flowExpectTimeoutMs({ BROWSER_ENGINE_HEADED: '0', BROWSER_ENGINE_EXPECT_MS: 'nope' }),
    ).toBe(0)
    expect(flowExpectTimeoutMs({ BROWSER_ENGINE_HEADED: '0' }, ['--headed'])).toBe(
      DEFAULT_EXPECT_TIMEOUT_MS,
    )
  })

  it('packs pace, expect timeout, and timers for the run_flow tool', () => {
    const sleep = async () => undefined
    const clock = () => 7
    expect(
      runFlowToolOptions(
        { BROWSER_ENGINE_PACE_MS: '0', BROWSER_ENGINE_EXPECT_MS: '40' },
        sleep,
        clock,
      ),
    ).toEqual({
      paceMs: 0,
      expectTimeoutMs: 40,
      sleep,
      clock,
    })
    expect(runFlowToolOptions({ BROWSER_ENGINE_HEADED: '0' }, sleep, clock).expectTimeoutMs).toBe(0)
    expect(runFlowToolOptions({}, sleep, clock).expectTimeoutMs).toBe(DEFAULT_EXPECT_TIMEOUT_MS)
  })
})

describe('runFlow', () => {
  it('runs a sequence of steps against the page', async () => {
    const page = recordPage()
    const result = await runFlow(page, [
      { action: 'navigate', url: 'https://example.com' },
      { action: 'click', uid: 'btn-1' },
      { action: 'type', uid: 'in-1', text: 'hi' },
      { action: 'hover', uid: 'btn-1' },
      { action: 'scroll', uid: 'box', dx: 0, dy: 10 },
      { action: 'select', uid: 'sel', value: 'a' },
      { action: 'press', key: 'Enter' },
    ])
    expect(result).toEqual({ ok: true, steps: 7 })
    expect(page.calls).toEqual([
      'navigate:https://example.com',
      'click:btn-1',
      'type:in-1:hi',
      'hover:btn-1',
      'scroll:box:0:10',
      'select:sel:a',
      'press:Enter',
    ])
  })

  it('returns zero steps for an empty flow', async () => {
    const page = recordPage()
    expect(await runFlow(page, [])).toEqual({ ok: true, steps: 0 })
    expect(page.calls).toEqual([])
    let observes = 0
    page.observe = async () => {
      observes += 1
      return {
        snapshot: { uid: 'x', role: 'generic', name: '' },
        image: '',
        overlay: {},
        pageState: { url: '', title: '' },
      }
    }
    await runFlow(page, [])
    expect(observes).toBe(0)
  })

  it('names a compile-time observe failure after the first real step', async () => {
    const page = recordPage()
    page.observe = async () => {
      throw new Error('snapshot failed')
    }
    await expect(runFlow(page, [{ action: 'click', name: 'Login' }])).rejects.toThrow(
      /^step 1 observe: snapshot failed$/,
    )
    await expect(
      runFlow(page, [
        { action: 'hover', name: 'Sauce Labs Backpack' },
        { action: 'click', name: 'Add to cart' },
      ]),
    ).rejects.toThrow(/^step 1 observe: snapshot failed$/)
    page.observe = async () => {
      throw new Error('prefix step 2 click: snapshot failed')
    }
    await expect(runFlow(page, [{ action: 'click', name: 'Login' }])).rejects.toThrow(
      /^step 1 observe: prefix step 2 click: snapshot failed$/,
    )
  })

  it('wraps a non-Error throw from the page with the step number', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: {
        uid: 'root',
        role: 'document',
        name: 'Home',
        children: [{ uid: 'go', role: 'button', name: 'Login' }],
      },
      image: '',
      overlay: {},
      pageState: { url: 'https://example.com', title: 'Home' },
    })
    page.click = async () => {
      throw 'nope'
    }
    await expect(runFlow(page, [{ action: 'click', name: 'Login' }])).rejects.toThrow(
      /step 1 click: nope/,
    )
  })

  it('throws on an unknown action', async () => {
    const page = recordPage()
    await expect(runFlow(page, [{ action: 'explode', uid: 'x' }])).rejects.toThrow(
      /^step 1 explode: unknown action: explode$/,
    )
    await expect(
      runFlow(page, [{ action: 'explode' }, { action: 'click', name: 'Login', expectText: 'x' }]),
    ).rejects.toThrow(/^step 1 explode: unknown action: explode$/)
    await expect(
      runFlow(page, [{ action: 'navigate', url: 'https://example.com' }, { action: 'explode' }]),
    ).rejects.toThrow(/unknown action/i)
    await expect(
      runFlow(page, [{ action: 'navigate', url: 'https://example.com' }, { action: 'press' }]),
    ).rejects.toThrow(/requires key/i)
    await expect(
      runFlow(page, [{ action: 'press', key: 'Tab' }, { action: 'navigate' }]),
    ).rejects.toThrow(/requires url/i)
    await expect(
      runFlow(page, [{ action: 'navigate', url: 'https://example.com' }, { action: 'click' }]),
    ).rejects.toThrow(/requires uid or name/i)
    await expect(
      runFlow(page, [{ action: 'navigate', url: 'https://example.com' }, { action: 'check' }]),
    ).rejects.toThrow(/action check requires expectUrl or expectText/)
  })

  it('throws when a uid-based action is missing uid', async () => {
    const page = recordPage()
    await expect(runFlow(page, [{ action: 'click' }])).rejects.toThrow(/requires uid/i)
  })

  it('throws when press is missing key', async () => {
    const page = recordPage()
    await expect(runFlow(page, [{ action: 'press' }])).rejects.toThrow(/requires key/i)
  })

  it('throws when navigate is missing url', async () => {
    const page = recordPage()
    await expect(runFlow(page, [{ action: 'navigate' }])).rejects.toThrow(/requires url/i)
  })

  it('re-binds a named click after press from a fresh outline', async () => {
    const page = recordPage()
    const snapshot = {
      uid: 'root',
      role: 'document',
      name: 'Home',
      children: [{ uid: 'go', role: 'button', name: 'Next' }],
    }
    expect(outlineFromUnknown(snapshot).map((item) => item.name)).toEqual(['Next'])
    expect(bindTarget(outlineFromUnknown(snapshot), { action: 'click', name: 'Next' }).status).toBe(
      'bound',
    )
    page.observe = async () => ({
      snapshot,
      image: '',
      overlay: {},
      pageState: { url: 'https://example.com/home', title: 'Home' },
    })
    await expect(
      runFlow(page, [
        { action: 'press', key: 'Tab' },
        { action: 'click', name: 'Next' },
      ]),
    ).resolves.toEqual({ ok: true, steps: 2 })
    expect(page.calls).toEqual(['press:Tab', 'click:go'])
  })

  it('defaults missing type text, select value, and scroll deltas', async () => {
    const page = recordPage()
    await runFlow(page, [
      { action: 'type', uid: 'in-1' },
      { action: 'select', uid: 'sel' },
      { action: 'scroll', uid: 'box' },
    ])
    expect(page.calls).toEqual(['type:in-1:', 'select:sel:', 'scroll:box:0:0'])
  })

  it('pauses after every step when paceMs is set', async () => {
    const page = recordPage()
    const sleeps: number[] = []
    await runFlow(
      page,
      [
        { action: 'navigate', url: 'https://example.com' },
        { action: 'click', uid: 'btn-1' },
        { action: 'type', uid: 'in-1', text: 'hi' },
      ],
      {
        paceMs: 12,
        sleep: async (ms) => {
          sleeps.push(ms)
        },
      },
    )
    expect(sleeps).toEqual([12, 12, 12])
    expect(page.calls).toEqual(['navigate:https://example.com', 'click:btn-1', 'type:in-1:hi'])
  })

  it('skips the pause when sleep is omitted', async () => {
    const page = recordPage()
    await expect(
      runFlow(page, [{ action: 'click', uid: 'btn-1' }], { paceMs: 12 }),
    ).resolves.toEqual({ ok: true, steps: 1 })
    expect(page.calls).toEqual(['click:btn-1'])
  })

  it('does not pause when paceMs is zero', async () => {
    const page = recordPage()
    let slept = 0
    await runFlow(page, [{ action: 'click', uid: 'btn-1' }], {
      paceMs: 0,
      sleep: async () => {
        slept += 1
      },
    })
    expect(slept).toBe(0)
  })

  it('resolves name and near from an outline and re-reads after click', async () => {
    const login = {
      uid: 'root',
      role: 'generic',
      name: '',
      children: [
        { uid: 'user', role: 'textbox', name: 'Username' },
        { uid: 'pass', role: 'textbox', name: 'Password' },
        { uid: 'go', role: 'button', name: 'Login' },
      ],
    }
    const shop = {
      uid: 'root',
      role: 'generic',
      name: '',
      children: [
        { uid: 'bp', role: 'link', name: 'Sauce Labs Backpack' },
        { uid: 'add1', role: 'button', name: 'Add to cart' },
        { uid: 'bl', role: 'link', name: 'Sauce Labs Bike Light' },
        { uid: 'add2', role: 'button', name: 'Add to cart' },
      ],
    }
    let scene = 'login'
    let observes = 0
    const page = recordPage()
    page.observe = async () => {
      observes += 1
      return {
        snapshot: scene === 'login' ? login : shop,
        image: '',
        overlay: {},
        pageState: { url: '', title: '' },
      }
    }
    const originalClick = page.click
    page.click = async (uid) => {
      await originalClick(uid)
      if (uid === 'go') {
        scene = 'shop'
      }
    }
    const result = await runFlow(page, [
      { action: 'type', name: 'Username', text: 'standard_user' },
      { action: 'type', name: 'Password', text: 'secret_sauce' },
      { action: 'click', name: 'Login' },
      { action: 'click', name: 'Add to cart', near: 'Bike Light' },
    ])
    expect(result).toEqual({ ok: true, steps: 4 })
    expect(page.calls).toEqual([
      'type:user:standard_user',
      'type:pass:secret_sauce',
      'click:go',
      'click:add2',
    ])
    expect(observes).toBe(2)
  })

  it('re-reads the outline after press and navigate', async () => {
    const tree = {
      uid: 'root',
      role: 'generic',
      name: '',
      children: [
        { uid: 'user', role: 'textbox', name: 'Username' },
        { uid: 'go', role: 'button', name: 'Login' },
      ],
    }
    let observes = 0
    const page = recordPage()
    page.observe = async () => {
      observes += 1
      return {
        snapshot: tree,
        image: '',
        overlay: {},
        pageState: { url: '', title: '' },
      }
    }
    await runFlow(page, [
      { action: 'type', name: 'Username', text: 'a' },
      { action: 'press', key: 'Tab' },
      { action: 'type', name: 'Username', text: 'b' },
      { action: 'navigate', url: 'https://example.com/next' },
      { action: 'click', name: 'Login' },
    ])
    expect(observes).toBe(3)
    expect(page.calls).toEqual([
      'type:user:a',
      'press:Tab',
      'type:user:b',
      'navigate:https://example.com/next',
      'click:go',
    ])
  })

  it('throws when a named target is missing', async () => {
    const page = recordPage()
    await expect(runFlow(page, [{ action: 'click', name: 'Nope' }])).rejects.toThrow(/no target/i)
  })

  it('binds after navigate so a missing later name still fails closed', async () => {
    const page = recordPage()
    await expect(
      runFlow(page, [
        { action: 'navigate', url: 'https://example.com' },
        { action: 'click', name: 'Nope' },
      ]),
    ).rejects.toThrow(/no target for click name=Nope/)
    expect(page.calls).toEqual(['navigate:https://example.com'])
  })

  it('throws when a named target is ambiguous and lists the candidates', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: {
        uid: 'root',
        role: 'generic',
        name: '',
        children: [
          { uid: 'add1', role: 'button', name: 'Add to cart' },
          { uid: 'add2', role: 'button', name: 'Add to cart' },
        ],
      },
      image: '',
      overlay: {},
      pageState: { url: '', title: '' },
    })
    await expect(runFlow(page, [{ action: 'click', name: 'Add to cart' }])).rejects.toThrow(
      /ambiguous target for click name=Add to cart candidates=button:Add to cart;button:Add to cart/,
    )
    expect(page.calls).toEqual([])
  })

  it('checks expectUrl and expectText after a step', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: {
        uid: 'root',
        role: 'document',
        name: 'Secure Area',
        children: [{ uid: 'out', role: 'link', name: 'Logout' }],
      },
      image: '',
      overlay: {},
      pageState: { url: 'https://example.com/secure', title: 'Secure Area' },
    })
    await expect(
      runFlow(page, [
        {
          action: 'navigate',
          url: 'https://example.com/secure',
          expectUrl: '/secure',
          expectText: 'Logout',
        },
      ]),
    ).resolves.toEqual({ ok: true, steps: 1 })
  })

  it('fails closed when expectUrl does not match the live page', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: { uid: 'root', role: 'document', name: 'Login', children: [] },
      image: '',
      overlay: {},
      pageState: { url: 'https://example.com/login', title: 'Login' },
    })
    await expect(
      runFlow(page, [
        { action: 'navigate', url: 'https://example.com/login', expectUrl: '/secure' },
      ]),
    ).rejects.toThrow(
      /expectUrl failed after navigate want=\/secure got=https:\/\/example.com\/login/,
    )
    expect(page.calls).toEqual(['navigate:https://example.com/login'])
  })

  it('fails closed when expectText folds to an empty icon glyph', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: { uid: 'root', role: 'document', name: 'Home', children: [] },
      image: '',
      overlay: {},
      pageState: { url: 'https://example.com/', title: 'Home' },
    })
    await expect(
      runFlow(page, [{ action: 'navigate', url: 'https://example.com/', expectText: '' }]),
    ).rejects.toThrow(/expectText failed after navigate/)
  })

  it('fails closed when expectText is missing from the live page', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: { uid: 'root', role: 'document', name: 'Home', children: [] },
      image: '',
      overlay: {},
      pageState: { url: 'https://example.com/', title: 'Home' },
    })
    await expect(
      runFlow(page, [{ action: 'navigate', url: 'https://example.com/', expectText: 'Logout' }]),
    ).rejects.toThrow(/expectText failed after navigate want=Logout/)
  })

  it('matches expectText against a CSS-uppercased heading', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: {
        uid: 'root',
        role: 'document',
        name: 'Shop',
        children: [{ uid: 'h', role: 'heading', name: 'FEATURES ITEMS' }],
      },
      image: '',
      overlay: {},
      pageState: { url: 'https://automationexercise.com/', title: 'Automation Exercise' },
    })
    await expect(
      runFlow(page, [
        {
          action: 'navigate',
          url: 'https://automationexercise.com/',
          expectUrl: 'automationexercise.com',
          expectText: 'Features Items',
        },
      ]),
    ).resolves.toEqual({ ok: true, steps: 1 })
  })

  it('matches expectText against a CSS-uppercased page title', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: { uid: 'root', role: 'generic', name: '', children: [] },
      image: '',
      overlay: {},
      pageState: { url: 'https://example.com/done', title: 'ORDER COMPLETE' },
    })
    await expect(
      runFlow(page, [
        { action: 'navigate', url: 'https://example.com/done', expectText: 'Order complete' },
      ]),
    ).resolves.toEqual({ ok: true, steps: 1 })
  })

  it('treats the page title as expectText evidence', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: { uid: 'root', role: 'generic', name: '', children: [] },
      image: '',
      overlay: {},
      pageState: { url: 'https://example.com/done', title: 'Order complete' },
    })
    await expect(
      runFlow(page, [
        { action: 'navigate', url: 'https://example.com/done', expectText: 'complete' },
      ]),
    ).resolves.toEqual({ ok: true, steps: 1 })
  })

  it('runs a check step without clicking', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: {
        uid: 'root',
        role: 'document',
        name: 'Cart',
        children: [{ uid: 'go', role: 'button', name: 'Checkout' }],
      },
      image: '',
      overlay: {},
      pageState: { url: 'https://shop.example/cart', title: 'Cart' },
    })
    await expect(
      runFlow(page, [{ action: 'check', expectUrl: '/cart', expectText: 'Checkout' }]),
    ).resolves.toEqual({ ok: true, steps: 1 })
    expect(page.calls).toEqual([])
  })

  it('throws when check has no expectation', async () => {
    const page = recordPage()
    await expect(runFlow(page, [{ action: 'check' }])).rejects.toThrow(
      /action check requires expectUrl or expectText/,
    )
  })

  it('accepts a check that only names expectText', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: {
        uid: 'root',
        role: 'document',
        name: 'Done',
        children: [{ uid: 'msg', role: 'alert', name: 'Thanks' }],
      },
      image: '',
      overlay: {},
      pageState: { url: 'https://shop.example/done', title: 'Done' },
    })
    await expect(runFlow(page, [{ action: 'check', expectText: 'Thanks' }])).resolves.toEqual({
      ok: true,
      steps: 1,
    })
  })

  it('accepts a check that only names expectUrl', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: { uid: 'root', role: 'document', name: 'Cart' },
      image: '',
      overlay: {},
      pageState: { url: 'https://shop.example/cart', title: 'Cart' },
    })
    await expect(runFlow(page, [{ action: 'check', expectUrl: '/cart' }])).resolves.toEqual({
      ok: true,
      steps: 1,
    })
  })

  it('re-observes after a click so expectUrl sees the next page', async () => {
    let observes = 0
    const page = recordPage()
    page.observe = async () => {
      observes += 1
      return {
        snapshot: {
          uid: 'root',
          role: 'generic',
          name: '',
          children: [{ uid: 'go', role: 'button', name: 'Login' }],
        },
        image: '',
        overlay: {},
        pageState:
          observes === 1
            ? { url: 'https://example.com/login', title: 'Login' }
            : { url: 'https://example.com/secure', title: 'Secure' },
      }
    }
    await runFlow(page, [{ action: 'click', name: 'Login', expectUrl: '/secure' }])
    expect(page.calls).toEqual(['click:go'])
    expect(observes).toBe(2)
  })

  it('preflights the page so an ambiguous later click never hovers first', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: {
        uid: 'root',
        role: 'generic',
        name: '',
        children: [
          { uid: 'bp', role: 'link', name: 'Sauce Labs Backpack' },
          { uid: 'add1', role: 'button', name: 'Add to cart' },
          { uid: 'bl', role: 'link', name: 'Sauce Labs Bike Light' },
          { uid: 'add2', role: 'button', name: 'Add to cart' },
        ],
      },
      image: '',
      overlay: {},
      pageState: { url: '', title: '' },
    })
    await expect(
      runFlow(page, [
        { action: 'hover', name: 'Sauce Labs Backpack' },
        { action: 'click', name: 'Add to cart' },
      ]),
    ).rejects.toThrow(/^step 2 click: ambiguous target for click name=Add to cart/)
    expect(page.calls).toEqual([])
  })

  it('polls expectUrl until the page catches up', async () => {
    let observes = 0
    const page = recordPage()
    page.observe = async () => {
      observes += 1
      return {
        snapshot: { uid: 'root', role: 'document', name: 'Page' },
        image: '',
        overlay: {},
        pageState: {
          url: observes < 4 ? 'https://example.com/login' : 'https://example.com/secure',
          title: 'Page',
        },
      }
    }
    let now = 0
    await expect(
      runFlow(
        page,
        [{ action: 'navigate', url: 'https://example.com/login', expectUrl: '/secure' }],
        {
          expectTimeoutMs: 100,
          expectIntervalMs: 10,
          clock: () => now,
          sleep: async (ms) => {
            now += ms
          },
        },
      ),
    ).resolves.toEqual({ ok: true, steps: 1 })
    expect(observes).toBe(4)
    expect(now).toBe(20)
  })

  it('times out expectUrl after the deadline with the last url', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: { uid: 'root', role: 'document', name: 'Login' },
      image: '',
      overlay: {},
      pageState: { url: 'https://example.com/login', title: 'Login' },
    })
    let now = 0
    await expect(
      runFlow(
        page,
        [{ action: 'navigate', url: 'https://example.com/login', expectUrl: '/secure' }],
        {
          expectTimeoutMs: 20,
          expectIntervalMs: 10,
          clock: () => now,
          sleep: async (ms) => {
            now += ms
          },
        },
      ),
    ).rejects.toThrow(
      /expectUrl failed after navigate want=\/secure got=https:\/\/example.com\/login/,
    )
    expect(now).toBe(20)
  })

  it('does not poll when expectIntervalMs is zero', async () => {
    let observes = 0
    const page = recordPage()
    page.observe = async () => {
      observes += 1
      return {
        snapshot: { uid: 'root', role: 'document', name: 'Login' },
        image: '',
        overlay: {},
        pageState: { url: 'https://example.com/login', title: 'Login' },
      }
    }
    await expect(
      runFlow(
        page,
        [{ action: 'navigate', url: 'https://example.com/login', expectUrl: '/secure' }],
        {
          expectTimeoutMs: 100,
          expectIntervalMs: 0,
          clock: () => 0,
          sleep: async () => undefined,
        },
      ),
    ).rejects.toThrow(/expectUrl failed after navigate/)
    expect(observes).toBe(2)
  })

  it('does not preflight names that come after a leading navigate', async () => {
    let observes = 0
    const page = recordPage()
    page.observe = async () => {
      observes += 1
      return {
        snapshot: {
          uid: 'root',
          role: 'generic',
          name: '',
          children: [{ uid: 'go', role: 'button', name: 'Login' }],
        },
        image: '',
        overlay: {},
        pageState: { url: '', title: '' },
      }
    }
    await runFlow(page, [
      { action: 'navigate', url: 'https://example.com/login' },
      { action: 'click', name: 'Login' },
    ])
    expect(page.calls).toEqual(['navigate:https://example.com/login', 'click:go'])
    expect(observes).toBe(2)
  })

  it('reuses the outline for two named types after navigate', async () => {
    let observes = 0
    const page = recordPage()
    page.observe = async () => {
      observes += 1
      return {
        snapshot: {
          uid: 'root',
          role: 'generic',
          name: '',
          children: [
            { uid: 'user', role: 'textbox', name: 'Username' },
            { uid: 'pass', role: 'textbox', name: 'Password' },
          ],
        },
        image: '',
        overlay: {},
        pageState: { url: '', title: '' },
      }
    }
    await runFlow(page, [
      { action: 'navigate', url: 'https://example.com/login' },
      { action: 'type', name: 'Username', text: 'a' },
      { action: 'type', name: 'Password', text: 'b' },
    ])
    expect(page.calls).toEqual(['navigate:https://example.com/login', 'type:user:a', 'type:pass:b'])
    expect(observes).toBe(2)
  })

  it('does not poll when only a clock or only a sleep is provided', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: { uid: 'root', role: 'document', name: 'Login' },
      image: '',
      overlay: {},
      pageState: { url: 'https://example.com/login', title: 'Login' },
    })
    await expect(
      runFlow(
        page,
        [{ action: 'navigate', url: 'https://example.com/login', expectUrl: '/secure' }],
        { expectTimeoutMs: 100, expectIntervalMs: 10, clock: () => 0 },
      ),
    ).rejects.toThrow(/expectUrl failed after navigate/)
    await expect(
      runFlow(
        page,
        [{ action: 'navigate', url: 'https://example.com/login', expectUrl: '/secure' }],
        { expectTimeoutMs: 100, expectIntervalMs: 10, sleep: async () => undefined },
      ),
    ).rejects.toThrow(/expectUrl failed after navigate/)
  })

  it('forgets the pre-click outline so a later name sees the new page', async () => {
    const login = {
      uid: 'root',
      role: 'generic',
      name: '',
      children: [
        { uid: 'user', role: 'textbox', name: 'Username' },
        { uid: 'go', role: 'button', name: 'Login' },
      ],
    }
    const shop = {
      uid: 'root',
      role: 'generic',
      name: '',
      children: [{ uid: 'add1', role: 'button', name: 'Add to cart' }],
    }
    let scene = 'login'
    const page = recordPage()
    page.observe = async () => ({
      snapshot: scene === 'login' ? login : shop,
      image: '',
      overlay: {},
      pageState: { url: '', title: '' },
    })
    const originalClick = page.click
    page.click = async (uid) => {
      await originalClick(uid)
      scene = 'shop'
    }
    await expect(
      runFlow(page, [
        { action: 'type', name: 'Username', text: 'a' },
        { action: 'click', name: 'Login' },
        { action: 'type', name: 'Username', text: 'b' },
      ]),
    ).rejects.toThrow(/no target for type name=Username/)
    expect(page.calls).toEqual(['type:user:a', 'click:go'])
  })

  it('re-observes after navigate when the next name is not on the first snapshot', async () => {
    let observes = 0
    const page = recordPage()
    page.observe = async () => {
      observes += 1
      const children = observes >= 3 ? [{ uid: 'go', role: 'button', name: 'Login' }] : []
      return {
        snapshot: { uid: 'root', role: 'generic', name: '', children },
        image: '',
        overlay: {},
        pageState: { url: 'https://example.com/login', title: 'Login' },
      }
    }
    await expect(
      runFlow(page, [
        { action: 'navigate', url: 'https://example.com/login' },
        { action: 'click', name: 'Login' },
      ]),
    ).resolves.toEqual({ ok: true, steps: 2 })
    expect(page.calls).toEqual(['navigate:https://example.com/login', 'click:go'])
    expect(observes).toBe(3)
  })

  it('polls for a named target until expectTimeoutMs after a late render', async () => {
    let observes = 0
    const page = recordPage()
    page.observe = async () => {
      observes += 1
      const children = observes >= 5 ? [{ uid: 'go', role: 'button', name: 'Customer Login' }] : []
      return {
        snapshot: { uid: 'root', role: 'generic', name: '', children },
        image: '',
        overlay: {},
        pageState: { url: 'https://bank.example/#/login', title: 'XYZ Bank' },
      }
    }
    let now = 0
    await expect(
      runFlow(page, [{ action: 'click', name: 'Customer Login' }], {
        expectTimeoutMs: 80,
        expectIntervalMs: 10,
        clock: () => now,
        sleep: async (ms) => {
          now += ms
        },
      }),
    ).resolves.toEqual({ ok: true, steps: 1 })
    expect(page.calls).toEqual(['click:go'])
    expect(observes).toBeGreaterThan(2)
  })

  it('re-observes after select so a newly shown Login can bind', async () => {
    let selected = false
    const page = recordPage()
    page.observe = async () => {
      const children: { uid: string; role: string; name: string }[] = [
        { uid: 'sel', role: 'combobox', name: 'Your Name' },
        {
          uid: selected ? 'go' : 'trap',
          role: 'button',
          name: 'Login',
        },
      ]
      return {
        snapshot: { uid: 'root', role: 'generic', name: '', children },
        image: '',
        overlay: {},
        pageState: { url: 'https://bank.example/#/customer', title: 'XYZ Bank' },
      }
    }
    const originalSelect = page.select
    page.select = async (uid, value) => {
      selected = true
      await originalSelect(uid, value)
    }
    await expect(
      runFlow(page, [
        { action: 'select', name: 'Your Name', value: 'Harry Potter' },
        { action: 'click', name: 'Login' },
      ]),
    ).resolves.toEqual({ ok: true, steps: 2 })
    expect(page.calls).toEqual(['select:sel:Harry Potter', 'click:go'])
  })

  it('times out when a first-page click never appears', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: { uid: 'root', role: 'generic', name: '' },
      image: '',
      overlay: {},
      pageState: { url: '', title: '' },
    })
    let now = 0
    await expect(
      runFlow(page, [{ action: 'click', name: 'Customer Login' }], {
        expectTimeoutMs: 20,
        expectIntervalMs: 10,
        clock: () => now,
        sleep: async (ms) => {
          now += ms
        },
      }),
    ).rejects.toThrow(/no target for click name=Customer Login/)
    expect(now).toBe(20)
  })

  it('does not poll a missing first click when the expect timeout is zero', async () => {
    let observes = 0
    let clockCalls = 0
    const page = recordPage()
    page.observe = async () => {
      observes += 1
      return {
        snapshot: { uid: 'root', role: 'generic', name: '' },
        image: '',
        overlay: {},
        pageState: { url: '', title: '' },
      }
    }
    await expect(
      runFlow(page, [{ action: 'click', name: 'Customer Login' }], {
        expectTimeoutMs: 0,
        expectIntervalMs: 10,
        clock: () => {
          clockCalls += 1
          return clockCalls
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/no target for click name=Customer Login/)
    expect(observes).toBe(2)
    expect(clockCalls).toBe(0)
  })

  it('does not poll binds when only a sleep or only a clock is provided', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: { uid: 'root', role: 'generic', name: '' },
      image: '',
      overlay: {},
      pageState: { url: '', title: '' },
    })
    await expect(
      runFlow(page, [{ action: 'click', name: 'Customer Login' }], {
        expectTimeoutMs: 40,
        expectIntervalMs: 10,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/no target/)
    await expect(
      runFlow(page, [{ action: 'click', name: 'Customer Login' }], {
        expectTimeoutMs: 40,
        expectIntervalMs: 10,
        clock: () => 1,
      }),
    ).rejects.toThrow(/no target/)
  })

  it('uses the default expect interval when polling a missing first click', async () => {
    const sleeps: number[] = []
    let now = 0
    const page = recordPage()
    page.observe = async () => ({
      snapshot: { uid: 'root', role: 'generic', name: '' },
      image: '',
      overlay: {},
      pageState: { url: '', title: '' },
    })
    await expect(
      runFlow(page, [{ action: 'click', name: 'Customer Login' }], {
        expectTimeoutMs: 40,
        clock: () => now,
        sleep: async (ms) => {
          sleeps.push(ms)
          now += ms
        },
      }),
    ).rejects.toThrow(/no target/)
    expect(sleeps.length).toBeGreaterThan(0)
    expect(sleeps[0]).toBe(DEFAULT_EXPECT_INTERVAL_MS)
  })

  it('does not poll binds when the expect interval is zero', async () => {
    let clockCalls = 0
    const page = recordPage()
    page.observe = async () => ({
      snapshot: { uid: 'root', role: 'generic', name: '' },
      image: '',
      overlay: {},
      pageState: { url: '', title: '' },
    })
    await expect(
      runFlow(page, [{ action: 'click', name: 'Customer Login' }], {
        expectTimeoutMs: 40,
        expectIntervalMs: 0,
        clock: () => {
          clockCalls += 1
          return clockCalls
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/no target/)
    expect(clockCalls).toBe(0)
  })

  it('times out name polling after navigate when the next click never appears', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: { uid: 'root', role: 'generic', name: '' },
      image: '',
      overlay: {},
      pageState: { url: 'https://example.com/', title: '' },
    })
    let now = 0
    await expect(
      runFlow(
        page,
        [
          { action: 'navigate', url: 'https://example.com/' },
          { action: 'click', name: 'Customer Login' },
        ],
        {
          expectTimeoutMs: 20,
          expectIntervalMs: 10,
          clock: () => now,
          sleep: async (ms) => {
            now += ms
          },
        },
      ),
    ).rejects.toThrow(/no target for click name=Customer Login/)
    expect(now).toBe(20)
  })

  it('polls after navigate until a late Customer Login appears', async () => {
    let observes = 0
    const page = recordPage()
    page.observe = async () => {
      observes += 1
      const children = observes >= 4 ? [{ uid: 'go', role: 'button', name: 'Customer Login' }] : []
      return {
        snapshot: { uid: 'root', role: 'generic', name: '', children },
        image: '',
        overlay: {},
        pageState: { url: 'https://bank.example/#/login', title: 'XYZ Bank' },
      }
    }
    let now = 0
    await expect(
      runFlow(
        page,
        [
          { action: 'navigate', url: 'https://bank.example/#/login' },
          { action: 'click', name: 'Customer Login' },
        ],
        {
          expectTimeoutMs: 80,
          expectIntervalMs: 10,
          clock: () => now,
          sleep: async (ms) => {
            now += ms
          },
        },
      ),
    ).resolves.toEqual({ ok: true, steps: 2 })
    expect(page.calls).toEqual(['navigate:https://bank.example/#/login', 'click:go'])
    expect(observes).toBeGreaterThan(2)
  })

  it('re-observes once when the first bind misses a name that is about to appear', async () => {
    let observes = 0
    const page = recordPage()
    page.observe = async () => {
      observes += 1
      const children = observes === 1 ? [] : [{ uid: 'go', role: 'button', name: 'Login' }]
      return {
        snapshot: { uid: 'root', role: 'generic', name: '', children },
        image: '',
        overlay: {},
        pageState: { url: '', title: '' },
      }
    }
    await expect(runFlow(page, [{ action: 'click', name: 'Login' }])).resolves.toEqual({
      ok: true,
      steps: 1,
    })
    expect(page.calls).toEqual(['click:go'])
    expect(observes).toBe(2)
  })

  it('binds View Product near a generic product title that is not a paragraph', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: {
        uid: 'root',
        role: 'generic',
        name: '',
        children: [
          { uid: 'g', role: 'generic', name: 'Winter Jacket' },
          { uid: 'add1', role: 'button', name: 'Add to cart' },
          { uid: 'view', role: 'link', name: 'View Product' },
          { uid: 'g2', role: 'cell', name: 'Canvas Tote' },
          { uid: 'add2', role: 'button', name: 'Add to cart' },
        ],
      },
      image: '',
      overlay: {},
      pageState: { url: 'https://shop.example/list', title: 'Shop' },
    })
    await expect(
      runFlow(page, [{ action: 'click', name: 'View Product', near: 'Winter Jacket' }]),
    ).resolves.toEqual({ ok: true, steps: 1 })
    expect(page.calls).toEqual(['click:view'])
  })

  it('runs an Automation Exercise cart flow from human labels', async () => {
    const home = {
      uid: 'root',
      role: 'generic',
      name: '',
      children: [
        { uid: 'products', role: 'link', name: ' Products' },
        { uid: 'feat', role: 'heading', name: 'FEATURES ITEMS' },
      ],
    }
    const listing = {
      uid: 'root',
      role: 'generic',
      name: '',
      children: [
        { uid: 'products', role: 'link', name: ' Products' },
        { uid: 'all', role: 'heading', name: 'ALL PRODUCTS' },
        { uid: 'box', role: 'textbox', name: 'Search Product' },
        { uid: 'find', role: 'button', name: '' },
      ],
    }
    const results = {
      uid: 'root',
      role: 'generic',
      name: '',
      children: [
        { uid: 'box', role: 'textbox', name: 'Search Product', value: 'Blue Top' },
        { uid: 'find', role: 'button', name: '' },
        { uid: 'searched', role: 'heading', name: 'SEARCHED PRODUCTS' },
        { uid: 'title', role: 'paragraph', name: 'Blue Top' },
        { uid: 'price', role: 'heading', name: 'Rs. 500' },
        { uid: 'add1', role: 'link', name: ' Add to cart' },
        { uid: 'price2', role: 'heading', name: 'Rs. 500' },
        { uid: 'add2', role: 'link', name: ' Add to cart' },
        { uid: 'view', role: 'link', name: ' View Product' },
      ],
    }
    const details = {
      uid: 'root',
      role: 'generic',
      name: '',
      children: [
        { uid: 'name', role: 'heading', name: 'Blue Top' },
        { uid: 'add', role: 'button', name: ' Add to cart' },
        { uid: 'added', role: 'heading', name: 'Added!' },
        { uid: 'cart', role: 'link', name: 'View Cart' },
      ],
    }
    const cart = {
      uid: 'root',
      role: 'generic',
      name: '',
      children: [
        { uid: 'row', role: 'link', name: 'Blue Top' },
        { uid: 'check', role: 'link', name: 'Proceed To Checkout' },
      ],
    }
    let scene = 'home'
    const page = recordPage()
    page.observe = async () => {
      const snapshot =
        scene === 'home'
          ? home
          : scene === 'listing'
            ? listing
            : scene === 'results'
              ? results
              : scene === 'details'
                ? details
                : cart
      const url =
        scene === 'home'
          ? 'https://automationexercise.com/'
          : scene === 'listing'
            ? 'https://automationexercise.com/products'
            : scene === 'results'
              ? 'https://automationexercise.com/products?search=Blue%20Top'
              : scene === 'details'
                ? 'https://automationexercise.com/product_details/1'
                : 'https://automationexercise.com/view_cart'
      return {
        snapshot,
        image: '',
        overlay: {},
        pageState: { url, title: 'Automation Exercise' },
      }
    }
    const originalClick = page.click
    page.click = async (uid) => {
      await originalClick(uid)
      if (uid === 'products') {
        scene = 'listing'
      } else if (uid === 'find') {
        scene = 'results'
      } else if (uid === 'view') {
        scene = 'details'
      } else if (uid === 'cart') {
        scene = 'cart'
      }
    }
    await expect(
      runFlow(page, [
        {
          action: 'navigate',
          url: 'https://automationexercise.com',
          expectUrl: 'automationexercise.com',
          expectText: 'Features Items',
        },
        { action: 'click', name: 'Products', expectUrl: '/products', expectText: 'All Products' },
        { action: 'type', name: 'Search Product', text: 'Blue Top' },
        { action: 'click', name: 'Search', expectText: 'Blue Top' },
        {
          action: 'click',
          name: 'View Product',
          near: 'Blue Top',
          expectUrl: '/product_details',
          expectText: 'Add to cart',
        },
        { action: 'click', name: 'Add to cart', expectText: 'Added!' },
        { action: 'click', name: 'View Cart', expectUrl: '/view_cart', expectText: 'Blue Top' },
      ]),
    ).resolves.toEqual({ ok: true, steps: 7 })
    expect(page.calls).toEqual([
      'navigate:https://automationexercise.com',
      'click:products',
      'type:box:Blue Top',
      'click:find',
      'click:view',
      'click:add',
      'click:cart',
    ])
  })
})
