import { encodeRequest, parseResponse, type ExtensionMethod } from './protocol.js'

/** Outbound line writer (socket or test sink). */
export type BridgeTransport = {
  write: (line: string) => void
  nextId?: () => string
}

/** In-flight request waiter. */
type Waiter = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * JSON-line RPC from the engine to one connected extension host.
 *
 * `rejectAll` is optional in the type so pre-existing fake bridges that only
 * implement `request`/`receive` stay assignable; the real bridge always
 * provides it.
 */
export type ExtensionBridge = {
  request(method: ExtensionMethod, params?: Record<string, unknown>): Promise<unknown>
  receive(line: string): void
  rejectAll?: (error: Error) => void
}

export function createExtensionBridge(transport: BridgeTransport): ExtensionBridge {
  const waiters = new Map<string, Waiter>()
  let seq = 0

  function nextId(): string {
    if (transport.nextId !== undefined) {
      return transport.nextId()
    }
    seq += 1
    return `e${seq}`
  }

  return {
    request(method: ExtensionMethod, params?: Record<string, unknown>): Promise<unknown> {
      const id = nextId()
      return new Promise((resolve, reject) => {
        waiters.set(id, { resolve, reject })
        transport.write(encodeRequest({ id, method, params }))
      })
    },
    receive(line: string): void {
      const response = parseResponse(line)
      const waiter = waiters.get(response.id)
      if (waiter === undefined) {
        return
      }
      waiters.delete(response.id)
      if (response.ok === false) {
        waiter.reject(new Error(response.error ?? 'extension error'))
        return
      }
      waiter.resolve(response.result)
    },
    rejectAll(error: Error): void {
      for (const waiter of waiters.values()) {
        waiter.reject(error)
      }
      waiters.clear()
    },
  }
}
