import { describe, expect, it } from 'vitest'
import { compileFlow } from '../../src/intent/compileFlow.js'
import type { OutlineItem } from '../../src/snapshot/outline.js'

const login: OutlineItem[] = [
  { uid: 'user', role: 'textbox', name: 'Username' },
  { uid: 'pass', role: 'textbox', name: 'Password' },
  { uid: 'go', role: 'button', name: 'Login' },
]

const shop: OutlineItem[] = [
  { uid: 'bp', role: 'link', name: 'Sauce Labs Backpack' },
  { uid: 'add1', role: 'button', name: 'Add to cart' },
  { uid: 'bl', role: 'link', name: 'Sauce Labs Bike Light' },
  { uid: 'add2', role: 'button', name: 'Add to cart' },
]

describe('compileFlow', () => {
  it('returns an empty compiled flow', () => {
    expect(compileFlow([], [])).toEqual({ ok: true, steps: [], bound: 0 })
  })

  it('fills uids for a unique same-page prefix and stops after the first click', () => {
    const result = compileFlow(login, [
      { action: 'type', name: 'Username', text: 'tomsmith' },
      { action: 'type', name: 'Password', text: 'secret' },
      { action: 'click', name: 'Login', expectUrl: '/secure' },
      { action: 'click', name: 'Add to cart', near: 'Bike Light' },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bound).toBe(3)
      expect(result.steps).toEqual([
        { action: 'type', name: 'Username', text: 'tomsmith', uid: 'user' },
        { action: 'type', name: 'Password', text: 'secret', uid: 'pass' },
        { action: 'click', name: 'Login', expectUrl: '/secure', uid: 'go' },
        { action: 'click', name: 'Add to cart', near: 'Bike Light' },
      ])
    }
  })

  it('does not mutate the input steps', () => {
    const steps = [{ action: 'type', name: 'Username', text: 'a' }]
    const result = compileFlow(login, steps)
    expect(result.ok).toBe(true)
    expect(steps[0]).toEqual({ action: 'type', name: 'Username', text: 'a' })
  })

  it('refuses an ambiguous name on the current page', () => {
    const result = compileFlow(shop, [{ action: 'click', name: 'Add to cart' }])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(
        /ambiguous target for click name=Add to cart candidates=button:Add to cart;button:Add to cart/,
      )
    }
  })

  it('names the failing step index for a later unknown action', () => {
    const result = compileFlow(shop, [
      { action: 'hover', name: 'Sauce Labs Backpack' },
      { action: 'explode' },
    ])
    expect(result).toEqual({
      ok: false,
      error: 'unknown action: explode',
      index: 1,
    })
  })

  it('names the failing step index for a later same-page miss', () => {
    const result = compileFlow(shop, [
      { action: 'hover', name: 'Sauce Labs Backpack' },
      { action: 'click', name: 'Add to cart' },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect('index' in result).toBe(true)
      expect('index' in result && result.index).toBe(1)
      expect(result.error).toMatch(/ambiguous target for click name=Add to cart/)
    }
  })

  it('refuses a missing name and lists candidates', () => {
    const result = compileFlow(login, [{ action: 'click', name: 'Checkout' }])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/no target for click name=Checkout/)
    }
  })

  it('binds the closest Add to cart when near is unique', () => {
    const result = compileFlow(shop, [{ action: 'click', name: 'Add to cart', near: 'Bike Light' }])
    expect(result).toEqual({
      ok: true,
      bound: 1,
      steps: [{ action: 'click', name: 'Add to cart', near: 'Bike Light', uid: 'add2' }],
    })
  })

  it('keeps an explicit uid and still stops after click', () => {
    const result = compileFlow(login, [
      { action: 'click', uid: 'go' },
      { action: 'type', name: 'Username', text: 'x' },
    ])
    expect(result).toEqual({
      ok: true,
      bound: 1,
      steps: [
        { action: 'click', uid: 'go' },
        { action: 'type', name: 'Username', text: 'x' },
      ],
    })
  })

  it('stops after navigate so later names stay unbound', () => {
    const result = compileFlow(login, [
      { action: 'navigate', url: 'https://example.com/shop' },
      { action: 'type', name: 'Username', text: 'x' },
    ])
    expect(result).toEqual({
      ok: true,
      bound: 0,
      steps: [
        { action: 'navigate', url: 'https://example.com/shop' },
        { action: 'type', name: 'Username', text: 'x' },
      ],
    })
  })

  it('stops after press so the next name is not bound to this page', () => {
    const result = compileFlow(login, [
      { action: 'type', name: 'Username', text: 'a' },
      { action: 'press', key: 'Tab' },
      { action: 'type', name: 'Password', text: 'b' },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bound).toBe(1)
      expect(result.steps[0]).toEqual({
        action: 'type',
        name: 'Username',
        text: 'a',
        uid: 'user',
      })
      expect(result.steps[2]).toEqual({ action: 'type', name: 'Password', text: 'b' })
    }
  })

  it('rejects unknown actions and incomplete steps', () => {
    expect(compileFlow([], [{ action: 'explode' }])).toEqual({
      ok: false,
      error: 'unknown action: explode',
      index: 0,
    })
    expect(compileFlow([], [{ action: 'press' }])).toEqual({
      ok: false,
      error: 'action press requires key',
      index: 0,
    })
    expect(compileFlow([], [{ action: 'navigate' }])).toEqual({
      ok: false,
      error: 'action navigate requires url',
      index: 0,
    })
    expect(compileFlow([], [{ action: 'check' }])).toEqual({
      ok: false,
      error: 'action check requires expectUrl or expectText',
      index: 0,
    })
    expect(compileFlow([], [{ action: 'click' }])).toEqual({
      ok: false,
      error: 'action click requires uid or name',
      index: 0,
    })
    expect(compileFlow([], [{ action: 'type', name: '   ', text: 'x' }])).toEqual({
      ok: false,
      error: 'action type requires uid or name',
      index: 0,
    })
  })

  it('requires expectUrl or expectText on click and navigate when asked', () => {
    expect(
      compileFlow(login, [{ action: 'click', name: 'Login' }], { requireExpect: true }),
    ).toEqual({
      ok: false,
      error: 'action click requires expectUrl or expectText',
      index: 0,
    })
    expect(
      compileFlow([], [{ action: 'navigate', url: 'https://example.com' }], {
        requireExpect: true,
      }),
    ).toEqual({
      ok: false,
      error: 'action navigate requires expectUrl or expectText',
      index: 0,
    })
    expect(
      compileFlow(login, [{ action: 'click', name: 'Login', expectUrl: '/secure' }], {
        requireExpect: true,
      }).ok,
    ).toBe(true)
    expect(
      compileFlow(login, [{ action: 'click', name: 'Login', expectText: 'Logout' }], {
        requireExpect: true,
      }).ok,
    ).toBe(true)
    expect(
      compileFlow([], [{ action: 'navigate', url: 'https://example.com', expectText: 'Home' }], {
        requireExpect: true,
      }).ok,
    ).toBe(true)
    expect(
      compileFlow(login, [{ action: 'type', name: 'Username', text: 'a' }], {
        requireExpect: true,
      }).ok,
    ).toBe(true)
  })

  it('fills uids for hover, select, and scroll before a page break', () => {
    const items: OutlineItem[] = [
      { uid: 'bp', role: 'link', name: 'Backpack' },
      { uid: 'sel', role: 'combobox', name: 'Qty' },
      { uid: 'box', role: 'slider', name: 'List' },
    ]
    const result = compileFlow(items, [
      { action: 'hover', name: 'Backpack' },
      { action: 'scroll', name: 'List', dy: 10 },
      { action: 'select', name: 'Qty', value: '2' },
    ])
    expect(result).toEqual({
      ok: true,
      bound: 3,
      steps: [
        { action: 'hover', name: 'Backpack', uid: 'bp' },
        { action: 'scroll', name: 'List', dy: 10, uid: 'box' },
        { action: 'select', name: 'Qty', value: '2', uid: 'sel' },
      ],
    })
  })

  it('stops binding after select so a later Login can appear', () => {
    const items: OutlineItem[] = [
      { uid: 'sel', role: 'combobox', name: 'Your Name' },
      { uid: 'home', role: 'button', name: 'Home' },
    ]
    expect(
      compileFlow(items, [
        { action: 'select', name: 'Your Name', value: 'Harry Potter' },
        { action: 'click', name: 'Login', expectUrl: '/account' },
      ]),
    ).toEqual({
      ok: true,
      bound: 1,
      steps: [
        { action: 'select', name: 'Your Name', value: 'Harry Potter', uid: 'sel' },
        { action: 'click', name: 'Login', expectUrl: '/account' },
      ],
    })
  })

  it('accepts a check step in the prefix without binding', () => {
    const result = compileFlow(login, [{ action: 'check', expectText: 'Login' }])
    expect(result).toEqual({
      ok: true,
      bound: 0,
      steps: [{ action: 'check', expectText: 'Login' }],
    })
    expect(compileFlow(login, [{ action: 'check', expectUrl: '/login' }])).toEqual({
      ok: true,
      bound: 0,
      steps: [{ action: 'check', expectUrl: '/login' }],
    })
  })
})
