import type { PageLike } from '../context/ContextPage.js'

/** Sends one CDP method through the extension. */
export type ExtensionCdpSend = (method: string, params?: unknown) => Promise<unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Build a Runtime.evaluate expression from PageLike.evaluate arguments. */
export function runtimeExpression(fn: string, arg?: unknown): string {
  if (arg === undefined) {
    return fn
  }
  return `(${fn})(${JSON.stringify(arg)})`
}

function screenshotDataUrl(result: unknown): string {
  if (!isRecord(result) || typeof result.data !== 'string') {
    throw new Error('Page.captureScreenshot returned no data')
  }
  return `data:image/png;base64,${result.data}`
}

function evaluateValue(result: unknown): unknown {
  if (!isRecord(result) || !isRecord(result.result)) {
    return undefined
  }
  return result.result.value
}

/**
 * PageLike over chrome.debugger via the unpacked extension.
 * observe/run_flow stay on the existing ContextPage stack.
 */
export function createExtensionPageLike(client: { send: ExtensionCdpSend }): PageLike {
  return {
    accessibility: {
      snapshot: async () => client.send('Accessibility.getFullAXTree'),
    },
    cdp: async (_session, method, params) => client.send(method, params),
    screenshot: async () =>
      screenshotDataUrl(await client.send('Page.captureScreenshot', { format: 'png' })),
    evaluate: async (fn, arg) =>
      evaluateValue(
        await client.send('Runtime.evaluate', {
          expression: runtimeExpression(fn, arg),
          returnByValue: true,
        }),
      ),
    goto: async (url) => {
      await client.send('Page.navigate', { url })
    },
    keyboardPress: async (key) => {
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key })
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key })
    },
  }
}
