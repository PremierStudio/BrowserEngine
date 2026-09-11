import { describe, expect, it } from 'vitest'
import { signalFromCdp } from '../../src/extension/hudSignals.js'

describe('signalFromCdp', () => {
  it('maps a mouse move with finite coordinates', () => {
    expect(signalFromCdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 4 })).toEqual({
      kind: 'move',
      x: 3,
      y: 4,
    })
    expect(
      signalFromCdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1.5, y: -2.25 }),
    ).toEqual({ kind: 'move', x: 1.5, y: -2.25 })
    expect(signalFromCdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })).toEqual({
      kind: 'move',
      x: 0,
      y: 0,
    })
  })

  it('maps a mouse press to a click with finite coordinates', () => {
    expect(
      signalFromCdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 10, y: 20 }),
    ).toEqual({ kind: 'click', x: 10, y: 20 })
    expect(signalFromCdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 0, y: 0 })).toEqual(
      {
        kind: 'click',
        x: 0,
        y: 0,
      },
    )
  })

  it('maps a wheel event to a scroll carrying a finite deltaY', () => {
    expect(
      signalFromCdp('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: 1,
        y: 2,
        deltaY: -120,
      }),
    ).toEqual({ kind: 'scroll', x: 1, y: 2, deltaY: -120 })
    expect(
      signalFromCdp('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: 1,
        y: 2,
        deltaY: 0,
      }),
    ).toEqual({ kind: 'scroll', x: 1, y: 2, deltaY: 0 })
  })

  it('defaults a missing or non-finite wheel deltaY to zero', () => {
    const base = { type: 'mouseWheel', x: 5, y: 6 }
    expect(signalFromCdp('Input.dispatchMouseEvent', base)).toEqual({
      kind: 'scroll',
      x: 5,
      y: 6,
      deltaY: 0,
    })
    expect(signalFromCdp('Input.dispatchMouseEvent', { ...base, deltaY: Number.NaN })).toEqual({
      kind: 'scroll',
      x: 5,
      y: 6,
      deltaY: 0,
    })
    expect(
      signalFromCdp('Input.dispatchMouseEvent', { ...base, deltaY: Number.POSITIVE_INFINITY }),
    ).toEqual({ kind: 'scroll', x: 5, y: 6, deltaY: 0 })
    expect(signalFromCdp('Input.dispatchMouseEvent', { ...base, deltaY: '80' })).toEqual({
      kind: 'scroll',
      x: 5,
      y: 6,
      deltaY: 0,
    })
    expect(signalFromCdp('Input.dispatchMouseEvent', { ...base, deltaY: null })).toEqual({
      kind: 'scroll',
      x: 5,
      y: 6,
      deltaY: 0,
    })
  })

  it('rejects a mouse event whose coordinates are missing, non-numeric, or non-finite', () => {
    expect(signalFromCdp('Input.dispatchMouseEvent', { type: 'mouseMoved', y: 1 })).toBeUndefined()
    expect(signalFromCdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1 })).toBeUndefined()
    expect(
      signalFromCdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Number.NaN, y: 1 }),
    ).toBeUndefined()
    expect(
      signalFromCdp('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: 1,
        y: Number.POSITIVE_INFINITY,
      }),
    ).toBeUndefined()
    expect(
      signalFromCdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: '1', y: 1 }),
    ).toBeUndefined()
    expect(
      signalFromCdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: null }),
    ).toBeUndefined()
    expect(signalFromCdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1 })).toBeUndefined()
  })

  it('ignores mouse events with an unknown or missing type', () => {
    expect(
      signalFromCdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1 }),
    ).toBeUndefined()
    expect(signalFromCdp('Input.dispatchMouseEvent', { x: 1, y: 1 })).toBeUndefined()
    expect(signalFromCdp('Input.dispatchMouseEvent', {})).toBeUndefined()
  })

  it('maps inserted text, including the empty string', () => {
    expect(signalFromCdp('Input.insertText', { text: 'hi' })).toEqual({ kind: 'type', text: 'hi' })
    expect(signalFromCdp('Input.insertText', { text: '' })).toEqual({ kind: 'type', text: '' })
  })

  it('rejects inserted text that is missing or not a string', () => {
    expect(signalFromCdp('Input.insertText', {})).toBeUndefined()
    expect(signalFromCdp('Input.insertText', { text: 3 })).toBeUndefined()
    expect(signalFromCdp('Input.insertText', { text: null })).toBeUndefined()
  })

  it('maps keyDown, rawKeyDown, and char to a key', () => {
    expect(signalFromCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter' })).toEqual({
      kind: 'key',
      key: 'Enter',
    })
    expect(signalFromCdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'A' })).toEqual({
      kind: 'key',
      key: 'A',
    })
    expect(signalFromCdp('Input.dispatchKeyEvent', { type: 'char', key: 'x' })).toEqual({
      kind: 'key',
      key: 'x',
    })
  })

  it('prefers a non-empty key and otherwise falls back to text', () => {
    expect(
      signalFromCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', text: 'ignored' }),
    ).toEqual({ kind: 'key', key: 'Enter' })
    expect(
      signalFromCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: '', text: 'a' }),
    ).toEqual({
      kind: 'key',
      key: 'a',
    })
    expect(signalFromCdp('Input.dispatchKeyEvent', { type: 'keyDown', text: 'b' })).toEqual({
      kind: 'key',
      key: 'b',
    })
    expect(signalFromCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 5, text: 'c' })).toEqual(
      {
        kind: 'key',
        key: 'c',
      },
    )
  })

  it('rejects key events without a usable key or text', () => {
    expect(signalFromCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: '' })).toBeUndefined()
    expect(
      signalFromCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: '', text: '' }),
    ).toBeUndefined()
    expect(
      signalFromCdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 5, text: 7 }),
    ).toBeUndefined()
    expect(signalFromCdp('Input.dispatchKeyEvent', { type: 'keyDown' })).toBeUndefined()
    expect(signalFromCdp('Input.dispatchKeyEvent', {})).toBeUndefined()
  })

  it('rejects key events that are neither down nor char', () => {
    expect(signalFromCdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter' })).toBeUndefined()
    expect(
      signalFromCdp('Input.dispatchKeyEvent', { type: 'char', key: '', text: '' }),
    ).toBeUndefined()
  })

  it('maps every navigated url string', () => {
    expect(signalFromCdp('Page.navigate', { url: 'https://example.test/a' })).toEqual({
      kind: 'navigate',
      url: 'https://example.test/a',
    })
    expect(signalFromCdp('Page.navigate', { url: '' })).toEqual({ kind: 'navigate', url: '' })
  })

  it('rejects navigation without a string url', () => {
    expect(signalFromCdp('Page.navigate', {})).toBeUndefined()
    expect(signalFromCdp('Page.navigate', { url: 3 })).toBeUndefined()
    expect(signalFromCdp('Page.navigate', { url: null })).toBeUndefined()
  })

  it('returns undefined when params are missing or the method is unknown', () => {
    expect(signalFromCdp('Input.dispatchMouseEvent', undefined)).toBeUndefined()
    expect(signalFromCdp('Input.insertText', undefined)).toBeUndefined()
    expect(signalFromCdp('Input.dispatchKeyEvent', undefined)).toBeUndefined()
    expect(signalFromCdp('Page.navigate', undefined)).toBeUndefined()
    expect(signalFromCdp('Runtime.evaluate', { expression: '1' })).toBeUndefined()
    expect(
      signalFromCdp('Runtime.evaluate', { url: 'https://example.test/unknown' }),
    ).toBeUndefined()
    expect(signalFromCdp('', undefined)).toBeUndefined()
  })
})
