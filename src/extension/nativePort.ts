/** Chrome-like runtime surface used by the native-messaging host bind. */
export type NativeRuntime = {
  lastError?: { message?: string } | null
  connectNative: (name: string) => unknown
}

/** Read chrome.runtime.lastError in the same turn as the API that set it. */
export function takeLastError(runtime: {
  lastError?: { message?: string } | null
}): string | undefined {
  const err = runtime.lastError
  if (err === undefined || err === null) {
    return undefined
  }
  return String(err.message)
}

/** connectNative, then consume lastError before any other chrome.* call. */
export function bindNativePort(runtime: NativeRuntime, hostName: string) {
  const port = runtime.connectNative(hostName)
  const error = takeLastError(runtime)
  if (error !== undefined) {
    return { ok: false as const, port: null, error }
  }
  return { ok: true as const, port, error: undefined }
}
