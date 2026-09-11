import { describe, expect, it } from 'vitest'
import { createExtensionPageLike, runtimeExpression } from '../../src/extension/extensionPage.js'

describe('runtimeExpression', () => {
  it('passes a bare expression through when there is no arg', () => {
    expect(runtimeExpression('1+1')).toBe('1+1')
  })

  it('applies a serialized arg to a function source', () => {
    expect(runtimeExpression('function (x) { return x }', 3)).toBe('(function (x) { return x })(3)')
  })
})

describe('createExtensionPageLike', () => {
  it('forwards cdp methods and returns the payload', async () => {
    const sent: Array<{ method: string; params?: unknown }> = []
    const page = createExtensionPageLike({
      send: async (method, params) => {
        sent.push({ method, params })
        return { nodes: [] }
      },
    })
    const result = await page.cdp('page', 'Accessibility.getFullAXTree')
    expect(result).toEqual({ nodes: [] })
    expect(sent).toEqual([{ method: 'Accessibility.getFullAXTree', params: undefined }])
  })

  it('turns Page.captureScreenshot data into a png data URL', async () => {
    const page = createExtensionPageLike({
      send: async (method) => {
        if (method === 'Page.captureScreenshot') {
          return { data: 'abc' }
        }
        throw new Error(method)
      },
    })
    await expect(page.screenshot()).resolves.toBe('data:image/png;base64,abc')
  })

  it('unwraps Runtime.evaluate returnByValue', async () => {
    const page = createExtensionPageLike({
      send: async (method, params) => {
        if (method !== 'Runtime.evaluate') {
          throw new Error(method)
        }
        if (typeof params !== 'object' || params === null || !('expression' in params)) {
          throw new Error('missing expression')
        }
        expect(params.expression).toBe('1+1')
        return { result: { value: 2 } }
      },
    })
    await expect(page.evaluate('1+1')).resolves.toBe(2)
  })

  it('returns undefined when evaluate has no result bag', async () => {
    const page = createExtensionPageLike({ send: async () => ({}) })
    await expect(page.evaluate('1')).resolves.toBeUndefined()
  })

  it('throws when screenshot data is missing', async () => {
    const page = createExtensionPageLike({ send: async () => ({}) })
    await expect(page.screenshot()).rejects.toThrow(/no data/)
  })

  it('navigates and dispatches key events', async () => {
    const methods: string[] = []
    const page = createExtensionPageLike({
      send: async (method) => {
        methods.push(method)
        return {}
      },
    })
    await page.goto('https://example.com')
    await page.keyboardPress('Enter')
    await page.accessibility.snapshot()
    expect(methods).toEqual([
      'Page.navigate',
      'Input.dispatchKeyEvent',
      'Input.dispatchKeyEvent',
      'Accessibility.getFullAXTree',
    ])
  })

  it('navigates with the url as Page.navigate params', async () => {
    const sent: Array<{ method: string; params?: unknown }> = []
    const page = createExtensionPageLike({
      send: async (method, params) => {
        sent.push({ method, params })
        return {}
      },
    })
    await page.goto('https://example.test/here')
    expect(sent).toEqual([
      { method: 'Page.navigate', params: { url: 'https://example.test/here' } },
    ])
  })

  it('captures a png screenshot with the format param', async () => {
    const sent: Array<{ method: string; params?: unknown }> = []
    const page = createExtensionPageLike({
      send: async (method, params) => {
        sent.push({ method, params })
        return { data: 'abc' }
      },
    })
    await page.screenshot()
    expect(sent).toEqual([{ method: 'Page.captureScreenshot', params: { format: 'png' } }])
  })

  it('evaluates with a serialized arg and returnByValue', async () => {
    const sent: Array<{ method: string; params?: unknown }> = []
    const page = createExtensionPageLike({
      send: async (method, params) => {
        sent.push({ method, params })
        return { result: { value: 2 } }
      },
    })
    await page.evaluate('function (x) { return x }', 3)
    expect(sent).toEqual([
      {
        method: 'Runtime.evaluate',
        params: {
          expression: '(function (x) { return x })(3)',
          returnByValue: true,
        },
      },
    ])
  })

  it('dispatches keyDown then keyUp for the pressed key', async () => {
    const sent: Array<{ method: string; params?: unknown }> = []
    const page = createExtensionPageLike({
      send: async (method, params) => {
        sent.push({ method, params })
        return {}
      },
    })
    await page.keyboardPress('Enter')
    expect(sent).toEqual([
      { method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'Enter' } },
      { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: 'Enter' } },
    ])
  })

  it('throws when a null screenshot result has no data', async () => {
    const page = createExtensionPageLike({ send: async () => null })
    await expect(page.screenshot()).rejects.toThrow(/no data/)
  })

  it('returns undefined when a null evaluate result has no bag', async () => {
    const page = createExtensionPageLike({ send: async () => null })
    await expect(page.evaluate('1')).resolves.toBeUndefined()
  })

  it('propagates send rejections from every method', async () => {
    const page = createExtensionPageLike({
      send: async () => {
        throw new Error('extension disconnected')
      },
    })
    await expect(page.accessibility.snapshot()).rejects.toThrow('extension disconnected')
    await expect(page.cdp('page', 'Runtime.evaluate')).rejects.toThrow('extension disconnected')
    await expect(page.screenshot()).rejects.toThrow('extension disconnected')
    await expect(page.evaluate('1')).rejects.toThrow('extension disconnected')
    await expect(page.goto('https://x')).rejects.toThrow('extension disconnected')
    await expect(page.keyboardPress('Enter')).rejects.toThrow('extension disconnected')
  })
})
