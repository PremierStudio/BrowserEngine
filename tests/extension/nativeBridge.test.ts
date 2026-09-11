import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createNativeBridge } from '../../src/extension/nativeBridge.js'
import { decodeNativeMessages, encodeNativeMessage } from '../../src/extension/nativeFraming.js'

class FakeStdin extends EventEmitter {
  emitData(chunk: Buffer): void {
    this.emit('data', chunk)
  }

  emitEnd(): void {
    this.emit('end')
  }
}

class FakeSocket extends EventEmitter {
  destroyed = false
  encoding: string | undefined
  ended = false
  readonly written: string[] = []

  write(data: string): boolean {
    this.written.push(data)
    return true
  }

  setEncoding(encoding: string): void {
    this.encoding = encoding
  }

  end(): void {
    this.ended = true
  }
}

type Scheduled = {
  run: () => void
  delayMs: number
}

function createHarness() {
  const stdin = new FakeStdin()
  const writes: Buffer[] = []
  const stdout = {
    write: (chunk: Buffer): boolean => {
      writes.push(chunk)
      return true
    },
  }
  const attempts: FakeSocket[] = []
  const dialed: string[] = []
  const logs: string[] = []
  const scheduled: Scheduled[] = []
  const connect = (sockPath: string): FakeSocket => {
    dialed.push(sockPath)
    const socket = new FakeSocket()
    attempts.push(socket)
    return socket
  }
  const bridge = createNativeBridge({
    stdin,
    stdout,
    connect,
    sockPath: '/tmp/engine.sock',
    log: (line) => {
      logs.push(line)
    },
    schedule: (fn, delayMs) => {
      scheduled.push({ run: fn, delayMs })
    },
  })
  return { bridge, stdin, writes, attempts, dialed, logs, scheduled }
}

type Harness = ReturnType<typeof createHarness>

function attempt(harness: Harness, index: number): FakeSocket {
  const found = harness.attempts[index]
  if (found === undefined) {
    throw new Error(`missing connect attempt ${String(index)}`)
  }
  return found
}

function lastAttempt(harness: Harness): FakeSocket {
  return attempt(harness, harness.attempts.length - 1)
}

function scheduledAt(harness: Harness, index: number): Scheduled {
  const found = harness.scheduled[index]
  if (found === undefined) {
    throw new Error(`missing schedule ${String(index)}`)
  }
  return found
}

function frames(writes: Buffer[]): Record<string, unknown>[] {
  return decodeNativeMessages(Buffer.concat(writes)).messages
}

describe('createNativeBridge', () => {
  describe('startup', () => {
    it('logs the start line and dials the configured socket immediately', () => {
      const h = createHarness()

      expect(h.dialed).toEqual(['/tmp/engine.sock'])
      expect(h.logs).toEqual(['host start sock=/tmp/engine.sock'])
      expect(h.writes).toEqual([])
    })

    it('queues stdin frames until the engine connects, then flushes them in order', () => {
      const h = createHarness()
      h.stdin.emitData(encodeNativeMessage({ id: 'first' }))
      h.stdin.emitData(encodeNativeMessage({ id: 'second' }))
      expect(attempt(h, 0).written).toEqual([])
      expect(h.writes).toEqual([])

      lastAttempt(h).emit('connect')

      expect(attempt(h, 0).encoding).toBe('utf8')
      expect(attempt(h, 0).written).toEqual(['{"id":"first"}\n', '{"id":"second"}\n'])
      expect(h.logs).toEqual(['host start sock=/tmp/engine.sock', 'connected'])
      expect(frames(h.writes)).toEqual([{ event: 'engine', connected: true }])
    })

    it('logs stdin closed when Chrome ends stdin', () => {
      const h = createHarness()

      h.stdin.emitEnd()

      expect(h.logs).toEqual(['host start sock=/tmp/engine.sock', 'stdin closed'])
    })
  })

  describe('reconnect', () => {
    it('keeps waiting and retries when the engine socket is initially missing', () => {
      const h = createHarness()
      lastAttempt(h).emit('error', new Error('ECONNREFUSED'))

      expect(h.logs).toEqual([
        'host start sock=/tmp/engine.sock',
        'waiting for engine: ECONNREFUSED',
      ])
      expect(h.scheduled).toHaveLength(1)
      expect(scheduledAt(h, 0).delayMs).toBe(1000)
      expect(h.writes).toEqual([])

      h.stdin.emitData(encodeNativeMessage({ id: 'late' }))
      expect(h.writes).toEqual([])

      scheduledAt(h, 0).run()
      expect(h.dialed).toEqual(['/tmp/engine.sock', '/tmp/engine.sock'])

      lastAttempt(h).emit('connect')
      expect(attempt(h, 1).written).toEqual(['{"id":"late"}\n'])
      expect(frames(h.writes)).toEqual([{ event: 'engine', connected: true }])
    })

    it('schedules only one retry while one is already pending', () => {
      const h = createHarness()
      lastAttempt(h).emit('error', new Error('ENOENT'))
      lastAttempt(h).emit('error', new Error('ENOENT'))

      expect(h.scheduled).toHaveLength(1)
      expect(h.logs).toEqual([
        'host start sock=/tmp/engine.sock',
        'waiting for engine: ENOENT',
        'waiting for engine: ENOENT',
      ])
    })

    it('schedules another retry when a retry attempt fails', () => {
      const h = createHarness()
      lastAttempt(h).emit('error', new Error('ECONNREFUSED'))
      scheduledAt(h, 0).run()

      expect(h.dialed).toHaveLength(2)
      lastAttempt(h).emit('error', new Error('ECONNREFUSED'))

      expect(h.scheduled).toHaveLength(2)
      scheduledAt(h, 1).run()
      expect(h.dialed).toHaveLength(3)
    })

    it('does not dial while a socket is already attached', () => {
      const h = createHarness()
      lastAttempt(h).emit('error', new Error('ECONNREFUSED'))
      lastAttempt(h).emit('connect')
      expect(h.logs).toContain('connected')

      scheduledAt(h, 0).run()

      expect(h.dialed).toHaveLength(1)
      expect(frames(h.writes)).toEqual([{ event: 'engine', connected: true }])
    })
  })

  describe('stdin frames', () => {
    it('relays a connected frame as newline-delimited JSON', () => {
      const h = createHarness()
      lastAttempt(h).emit('connect')

      h.stdin.emitData(encodeNativeMessage({ id: 'live' }))

      expect(attempt(h, 0).written).toEqual(['{"id":"live"}\n'])
    })

    it('waits for a complete length prefix and body before decoding', () => {
      const h = createHarness()
      lastAttempt(h).emit('connect')
      const frame = encodeNativeMessage({ id: 'split' })

      h.stdin.emitData(frame.subarray(0, 3))
      expect(attempt(h, 0).written).toEqual([])
      h.stdin.emitData(frame.subarray(3))

      expect(attempt(h, 0).written).toEqual(['{"id":"split"}\n'])
    })

    it('keeps frames queued while the socket is destroyed', () => {
      const h = createHarness()
      const socket = attempt(h, 0)
      socket.emit('connect')
      socket.destroyed = true

      h.stdin.emitData(encodeNativeMessage({ id: 'queued' }))
      expect(socket.written).toEqual([])

      socket.destroyed = false
      h.stdin.emitData(encodeNativeMessage({ id: 'after' }))
      expect(socket.written).toEqual(['{"id":"queued"}\n', '{"id":"after"}\n'])
    })
  })

  describe('engine lines', () => {
    it('writes one native frame per complete line and buffers the tail', () => {
      const h = createHarness()
      const socket = attempt(h, 0)
      socket.emit('connect')

      socket.emit('data', '{"a":1}\n{"b":')
      expect(frames(h.writes)).toEqual([{ event: 'engine', connected: true }, { a: 1 }])

      socket.emit('data', '2}\n')
      expect(frames(h.writes)).toEqual([{ event: 'engine', connected: true }, { a: 1 }, { b: 2 }])
    })

    it('skips empty lines and keeps parsing after them', () => {
      const h = createHarness()
      const socket = attempt(h, 0)
      socket.emit('connect')

      socket.emit('data', '\n{"a":1}\n\n')
      socket.emit('data', '\n')

      expect(frames(h.writes)).toEqual([{ event: 'engine', connected: true }, { a: 1 }])
    })
  })

  describe('engine disconnect', () => {
    it('logs a socket error, drops the socket, and retries once', () => {
      const h = createHarness()
      const socket = attempt(h, 0)
      socket.emit('connect')

      socket.emit('error', new Error('EPIPE'))

      expect(h.logs).toEqual([
        'host start sock=/tmp/engine.sock',
        'connected',
        'socket error EPIPE',
      ])
      expect(frames(h.writes)).toEqual([{ event: 'engine', connected: true }])
      expect(h.scheduled).toHaveLength(1)
      expect(scheduledAt(h, 0).delayMs).toBe(1000)

      socket.emit('close')
      expect(frames(h.writes)).toEqual([{ event: 'engine', connected: true }])
      expect(h.scheduled).toHaveLength(1)
    })

    it('announces connected:false and retries when the socket closes', () => {
      const h = createHarness()
      const socket = attempt(h, 0)
      socket.emit('connect')

      socket.emit('close')

      expect(h.logs).toEqual(['host start sock=/tmp/engine.sock', 'connected'])
      expect(frames(h.writes)).toEqual([
        { event: 'engine', connected: true },
        { event: 'engine', connected: false },
      ])
      expect(h.scheduled).toHaveLength(1)
      scheduledAt(h, 0).run()
      expect(h.dialed).toHaveLength(2)
    })
  })

  describe('stop', () => {
    it('ends a connected socket, ignores stdin, and stops retrying', () => {
      const h = createHarness()
      const socket = attempt(h, 0)
      socket.emit('connect')

      h.bridge.stop()

      expect(socket.ended).toBe(true)
      // A frame decodeNativeMessages rejects: if stop did not silence stdin,
      // decoding this throws and fails the test.
      h.stdin.emitData(encodeNativeMessage([]))
      h.stdin.emitEnd()
      expect(socket.written).toEqual([])

      socket.emit('error', new Error('late'))
      expect(h.logs).toEqual(['host start sock=/tmp/engine.sock', 'connected', 'socket error late'])
      expect(h.scheduled).toEqual([])

      socket.emit('close')
      expect(frames(h.writes)).toEqual([{ event: 'engine', connected: true }])
    })

    it('cancels a pending retry when no socket is attached', () => {
      const h = createHarness()
      lastAttempt(h).emit('error', new Error('ECONNREFUSED'))

      h.bridge.stop()
      scheduledAt(h, 0).run()

      expect(h.dialed).toHaveLength(1)
      // Same trick: a decodable-looking frame that only throws if stop failed
      // to silence the stdin handler.
      h.stdin.emitData(encodeNativeMessage([]))
      h.stdin.emitEnd()
      expect(h.logs).toEqual([
        'host start sock=/tmp/engine.sock',
        'waiting for engine: ECONNREFUSED',
      ])
    })

    it('ignores a socket that connects after stop', () => {
      const h = createHarness()
      const socket = attempt(h, 0)

      h.bridge.stop()
      socket.emit('connect')

      expect(socket.encoding).toBeUndefined()
      expect(socket.written).toEqual([])
      expect(h.writes).toEqual([])
      expect(h.logs).toEqual(['host start sock=/tmp/engine.sock'])
    })
  })
})
