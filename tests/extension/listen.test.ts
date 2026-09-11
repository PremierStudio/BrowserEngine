import { mkdtempSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultExtensionSocketPath, listenExtensionSocket } from '../../src/extension/listen.js'

vi.mock('node:fs', { spy: true })

describe('listenExtensionSocket', () => {
  it('defaults the socket under ~/.local/share/browser-engine', () => {
    expect(defaultExtensionSocketPath()).toContain('browser-engine/native.sock')
  })

  it('relays a request to the connected host and returns the reply', async () => {
    const sock = join(mkdtempSync(join(tmpdir(), 'be-ext-')), 'native.sock')
    const server = listenExtensionSocket(sock)
    const client = net.connect(sock)
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve())
      client.once('error', reject)
    })
    const pending = server.bridge.request('ping')
    const line = await new Promise<string>((resolve) => {
      client.once('data', (chunk) => resolve(chunk.toString('utf8')))
    })
    expect(line).toContain('"method":"ping"')
    const parsed: unknown = JSON.parse(line)
    const id =
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof parsed.id === 'string'
        ? parsed.id
        : ''
    client.write(`${JSON.stringify({ id, ok: true, result: { pong: true } })}\n`)
    await expect(pending).resolves.toEqual({ pong: true })
    client.write('\n\n')
    const extra = net.connect(sock)
    await new Promise<void>((resolve, reject) => {
      extra.once('connect', () => resolve())
      extra.once('error', reject)
    })
    extra.end()
    client.end()
    server.close()
    // second listen reuses the path after unlink
    const again = listenExtensionSocket(sock)
    again.close()
  })

  it('drops an open host connection on close so the listener process can exit', async () => {
    const sock = join(mkdtempSync(join(tmpdir(), 'be-ext-')), 'native.sock')
    const server = listenExtensionSocket(sock)
    const client = net.connect(sock)
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve())
      client.once('error', reject)
    })
    const closed = new Promise<void>((resolve) => {
      client.once('close', () => resolve())
    })
    server.close()
    await closed
    expect(client.destroyed).toBe(true)
  })
})

class FakeSocket {
  readonly writes: string[] = []
  encoding: string | undefined = undefined
  destroyed = false
  private readonly listeners = new Map<string, Array<(...args: string[]) => void>>()

  setEncoding(encoding: string): void {
    this.encoding = encoding
  }

  on(event: string, listener: (...args: string[]) => void): void {
    const existing = this.listeners.get(event)
    if (existing === undefined) {
      this.listeners.set(event, [listener])
      return
    }
    existing.push(listener)
  }

  emit(event: string, ...args: string[]): void {
    const handlers = this.listeners.get(event)
    if (handlers === undefined) {
      return
    }
    for (const handler of handlers) {
      handler(...args)
    }
  }

  destroy(): void {
    this.destroyed = true
  }

  write(chunk: string): void {
    this.writes.push(chunk)
  }

  written(): string {
    return this.writes.join('')
  }
}

let createdServers: net.Server[] = []

function fakeCreateServer(
  optionsOrListener?: net.ServerOpts | ((socket: net.Socket) => void),
  connectionListener?: (socket: net.Socket) => void,
): net.Server {
  const listener = typeof optionsOrListener === 'function' ? optionsOrListener : connectionListener
  const server = listener === undefined ? new net.Server() : new net.Server(listener)
  createdServers.push(server)
  return server
}

function spyOnCreateServer(): void {
  createdServers = []
  vi.spyOn(net, 'createServer').mockImplementation(fakeCreateServer)
}

function createdServer(): net.Server {
  const server = createdServers[0]
  if (server === undefined) {
    throw new Error('listenExtensionSocket created no server')
  }
  return server
}

function tempSocketPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'be-ext-')), 'native.sock')
}

describe('listenExtensionSocket with a fake host', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    createdServers = []
  })

  it('unlinks the socket path before listening and again on teardown', () => {
    const unlink = vi.mocked(fs.unlinkSync)
    unlink.mockClear()
    const sock = tempSocketPath()
    const server = listenExtensionSocket(sock)
    expect(unlink).toHaveBeenCalledWith(sock)
    unlink.mockClear()
    server.close()
    expect(unlink).toHaveBeenCalledWith(sock)
  })

  it('does not write to a connection before the native host connects', async () => {
    const server = listenExtensionSocket(tempSocketPath())
    let settled: string | undefined
    server.bridge.request('ping').then(
      () => {
        settled = 'resolved'
      },
      () => {
        settled = 'rejected'
      },
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBeUndefined()
    server.close()
  })

  it('sets utf8 encoding, buffers partial lines, and skips blank lines', () => {
    spyOnCreateServer()
    const server = listenExtensionSocket(tempSocketPath())
    const socket = new FakeSocket()
    createdServer().emit('connection', socket)
    expect(socket.encoding).toBe('utf8')

    const received: string[] = []
    server.bridge.receive = (line: string) => {
      received.push(line)
    }

    socket.emit('data', '\n')
    socket.emit('data', '{"one":')
    socket.emit('data', '1}\n{"two":2}')
    socket.emit('data', '\n\n')
    socket.emit('data', '{"three":3}')
    expect(received).toEqual(['{"one":1}', '{"two":2}'])
    socket.emit('data', '\n')
    expect(received).toEqual(['{"one":1}', '{"two":2}', '{"three":3}'])
    server.close()
  })

  it('routes writes to the newest connection and clears it when that host closes', () => {
    spyOnCreateServer()
    const server = listenExtensionSocket(tempSocketPath())
    const first = new FakeSocket()
    const second = new FakeSocket()
    const host = createdServer()
    host.emit('connection', first)
    host.emit('connection', second)

    server.bridge.request('ping').catch(() => undefined)
    expect(first.written()).toBe('')
    expect(second.written()).toContain('"method":"ping"')

    first.emit('close')
    second.writes.length = 0
    server.bridge.request('ping').catch(() => undefined)
    expect(second.written()).toContain('"method":"ping"')

    second.emit('close')
    second.writes.length = 0
    server.bridge.request('ping').catch(() => undefined)
    expect(second.written()).toBe('')

    server.close()
    expect(first.destroyed).toBe(false)
    expect(second.destroyed).toBe(false)
  })
})
