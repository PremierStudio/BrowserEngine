import { describe, expect, it } from 'vitest'
import { bindNativePort, takeLastError } from '../../src/extension/nativePort.js'

describe('takeLastError', () => {
  it('returns the message so Chrome treats lastError as checked', () => {
    const runtime = { lastError: { message: 'Native host has exited' } }
    expect(takeLastError(runtime)).toBe('Native host has exited')
  })

  it('returns undefined when Chrome did not set lastError', () => {
    expect(takeLastError({})).toBeUndefined()
    expect(takeLastError({ lastError: null })).toBeUndefined()
    expect(takeLastError({ lastError: undefined })).toBeUndefined()
  })
})

describe('bindNativePort', () => {
  it('does not treat the port as connected when connectNative already failed', () => {
    const port = { name: 'dead' }
    const runtime = {
      lastError: { message: 'Native host has exited' },
      connectNative(name: string) {
        expect(name).toBe('ai.premierstudio.browser_engine')
        return port
      },
    }
    expect(bindNativePort(runtime, 'ai.premierstudio.browser_engine')).toEqual({
      ok: false,
      port: null,
      error: 'Native host has exited',
    })
  })

  it('returns the port when the native host is still running', () => {
    const port = { name: 'live' }
    const runtime = {
      lastError: undefined,
      connectNative() {
        return port
      },
    }
    expect(bindNativePort(runtime, 'ai.premierstudio.browser_engine')).toEqual({
      ok: true,
      port,
      error: undefined,
    })
  })
})
