/**
 * Chrome native-messaging host relay. Ported from the spawn-only
 * `extension/native/host.mjs`; everything process-shaped is injected so the
 * relay logic is importable and deterministic under test.
 */

import { decodeNativeMessages, encodeNativeMessage } from './nativeFraming.js'

/** Minimal stdin surface: Chrome feeds framed binary data, then closes. */
type NativeBridgeStdin = {
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  on(event: 'end', listener: () => void): unknown
}

/** Minimal stdout surface: every write is one complete native frame. */
type NativeBridgeStdout = {
  write(chunk: Buffer): unknown
}

/** Duplex-like engine socket (net.Socket in production, fake in tests). */
type NativeBridgeSocket = {
  readonly destroyed: boolean
  write(data: string): unknown
  setEncoding(encoding: BufferEncoding): unknown
  end(): unknown
  on(event: 'connect', listener: () => void): unknown
  on(event: 'data', listener: (chunk: string) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: () => void): unknown
  off(event: 'error', listener: (error: Error) => void): unknown
}

/** Everything process-shaped the bridge touches. */
type NativeBridgeDeps = {
  stdin: NativeBridgeStdin
  stdout: NativeBridgeStdout
  connect: (sockPath: string) => NativeBridgeSocket
  sockPath: string
  log: (line: string) => void
  schedule: (fn: () => void, delayMs: number) => unknown
}

/** Delay before redialing a missing or dropped engine socket. */
const RECONNECT_DELAY_MS = 1000

/**
 * Relay Chrome native-messaging frames between stdin/stdout and the engine
 * Unix socket. Never exits on its own: while the engine is missing it queues
 * inbound frames and redials after RECONNECT_DELAY_MS.
 */
export function createNativeBridge(deps: NativeBridgeDeps): { stop: () => void } {
  let socket: NativeBridgeSocket | null = null
  let stdinBuf: Buffer = Buffer.alloc(0)
  const pending: Record<string, unknown>[] = []
  let reconnectScheduled = false
  let stopped = false

  function flushPending(): void {
    if (socket === null || socket.destroyed) {
      return
    }
    for (const message of pending) {
      socket.write(`${JSON.stringify(message)}\n`)
    }
    pending.length = 0
  }

  function scheduleConnect(): void {
    if (stopped || reconnectScheduled) {
      return
    }
    reconnectScheduled = true
    deps.schedule(() => {
      reconnectScheduled = false
      connect()
    }, RECONNECT_DELAY_MS)
  }

  function attachSocket(next: NativeBridgeSocket): void {
    socket = next
    next.setEncoding('utf8')
    let lineBuf = ''
    next.on('data', (chunk) => {
      lineBuf += chunk
      const parts = lineBuf.split('\n')
      lineBuf = parts.pop() || ''
      for (const part of parts) {
        if (part === '') {
          continue
        }
        deps.stdout.write(encodeNativeMessage(JSON.parse(part)))
      }
    })
    next.on('error', (error) => {
      deps.log(`socket error ${error.message}`)
      socket = null
      scheduleConnect()
    })
    next.on('close', () => {
      if (socket === next) {
        socket = null
        deps.stdout.write(encodeNativeMessage({ event: 'engine', connected: false }))
        scheduleConnect()
      }
    })
    flushPending()
    deps.log('connected')
    deps.stdout.write(encodeNativeMessage({ event: 'engine', connected: true }))
  }

  function connect(): void {
    if (stopped || socket !== null) {
      return
    }
    const next = deps.connect(deps.sockPath)
    const onConnectError = (error: Error): void => {
      deps.log(`waiting for engine: ${error.message}`)
      scheduleConnect()
    }
    next.on('connect', () => {
      next.off('error', onConnectError)
      if (stopped) {
        return
      }
      attachSocket(next)
    })
    next.on('error', onConnectError)
  }

  deps.stdin.on('data', (chunk) => {
    if (stopped) {
      return
    }
    stdinBuf = Buffer.concat([stdinBuf, chunk])
    const decoded = decodeNativeMessages(stdinBuf)
    stdinBuf = decoded.rest
    for (const message of decoded.messages) {
      pending.push(message)
    }
    flushPending()
  })

  deps.stdin.on('end', () => {
    if (stopped) {
      return
    }
    deps.log('stdin closed')
  })

  deps.log(`host start sock=${deps.sockPath}`)
  connect()

  return {
    stop: () => {
      stopped = true
      const current = socket
      socket = null
      current?.end()
    },
  }
}
