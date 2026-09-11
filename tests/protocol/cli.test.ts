import { describe, expect, it } from 'vitest'
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server'
import {
  buildCliMain,
  buildHttpHandler,
  createDefaultServer,
  runInstallNativeHost,
  type Serve,
} from '../../src/protocol/cli.js'
import type { InstallDeps } from '../../src/nativeHost/install.js'
import { STDIO_LINE_BUDGET } from '../../src/protocol/tools.js'
import { createLazyContextPage } from '../../src/context/lazyPage.js'
import type { ContextPage } from '../../src/context/ContextPage.js'
import { z } from 'zod'
import { defineTool } from '../../src/tools/defineTool.js'
import { ToolCategory } from '../../src/tools/types.js'

function fakePage(): ContextPage {
  return {
    getElementByUid: async () => undefined,
    waitForEventsAfterAction: async () => undefined,
    observe: async () => ({
      snapshot: { uid: 'x', role: 'generic', name: 'n' },
      image: 'img',
      overlay: {},
      pageState: { url: 'u', title: 't' },
    }),
    emulate: async () => undefined,
    getDialog: async () => null,
    click: async () => undefined,
    type: async () => undefined,
    hover: async () => undefined,
    scroll: async () => undefined,
    select: async () => undefined,
    press: async () => undefined,
    navigate: async () => undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function connectClient(server: McpServer): Promise<{
  request: (
    id: number,
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>
  init: Record<string, unknown>
  close: () => Promise<void>
}> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await clientTransport.start()
  let pending: ((message: Record<string, unknown>) => void) | undefined
  clientTransport.onmessage = (message) => {
    if (!isRecord(message) || !('id' in message) || pending === undefined) {
      return
    }
    pending(message)
  }
  async function request(id: number, method: string, params?: Record<string, unknown>) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      pending = resolve
      const payload: {
        jsonrpc: '2.0'
        id: number
        method: string
        params?: Record<string, unknown>
      } = { jsonrpc: '2.0', id, method }
      if (params !== undefined) {
        payload.params = params
      }
      void clientTransport.send(payload).catch(reject)
    })
  }
  const init = resultOf(
    await request(1, 'initialize', {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: 'test', version: '0.0.1' },
    }),
  )
  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return { request, init, close: () => server.close() }
}

function resultOf(message: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(message.result)) {
    throw new Error('expected json-rpc result object')
  }
  return message.result
}

function listedResources(message: Record<string, unknown>): unknown[] {
  const resources = resultOf(message).resources
  if (!Array.isArray(resources)) {
    throw new Error('expected resources array')
  }
  return resources
}

function listedToolNames(message: Record<string, unknown>): string[] {
  const tools = resultOf(message).tools
  if (!Array.isArray(tools)) {
    throw new Error('expected tools array')
  }
  const names: string[] = []
  for (const tool of tools) {
    if (isRecord(tool) && typeof tool.name === 'string') {
      names.push(tool.name)
    }
  }
  return names
}

function serverInfoFromSse(body: string): unknown {
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) {
      continue
    }
    const parsed: unknown = JSON.parse(line.slice(6))
    if (!isRecord(parsed) || !isRecord(parsed.result)) {
      continue
    }
    return parsed.result.serverInfo
  }
  throw new Error('no serverInfo in sse body')
}

const DEFAULT_TOOL_NAMES = [
  'browser_status',
  'browser_open',
  'browser_close',
  'browser_reap',
  'browser_new_tab',
  'browser_close_tab',
  'browser_switch_tab',
  'observe',
  'click',
  'type',
  'hover',
  'scroll',
  'select',
  'press',
  'navigate',
  'watch_until',
  'compile_flow',
  'run_flow',
  'verify',
  'explain',
  'confirm_action',
  'list_calls',
  'get_task',
  'list_tasks',
  'cancel_task',
  'wait_task',
]

describe('buildCliMain', () => {
  it('creates a main that serves via the provided serve function', () => {
    let factory: (() => unknown) | undefined
    let served = false
    const serve: Serve = (f) => {
      factory = f
      served = true
      return { close: async () => undefined }
    }
    const main = buildCliMain(serve)
    main()
    expect(served).toBe(true)
    expect(typeof factory).toBe('function')
  })

  it('the factory returns a server built from the standard tool set', async () => {
    let factory: (() => McpServer) | undefined
    const serve: Serve = (f) => {
      factory = f
      return { close: async () => undefined }
    }
    const main = buildCliMain(serve)
    main()
    const server = factory?.()
    expect(server).toBeDefined()
    if (server === undefined) {
      throw new Error('expected factory server')
    }
    const client = await connectClient(server)
    expect(client.init.serverInfo).toEqual({ name: 'browser-engine', version: '0.0.1' })
    const names = listedToolNames(await client.request(2, 'tools/list', {}))
    expect(names).toEqual(DEFAULT_TOOL_NAMES)
    expect(listedResources(await client.request(3, 'resources/list', {}))).toEqual([
      { uri: 'browser://events', name: 'browser-events', mimeType: 'application/json' },
      {
        uri: 'ui://browser-engine/replay',
        name: 'browser-replay',
        mimeType: 'text/html;profile=mcp-app',
      },
    ])
    await client.close()
  })

  it('the factory server exposes confirm and task tools', async () => {
    let factory: (() => McpServer) | undefined
    const serve: Serve = (f) => {
      factory = f
      return { close: async () => undefined }
    }
    buildCliMain(serve)()
    const server = factory?.()
    expect(server?.toolInputSchemaJson('confirm_action')).toBeDefined()
    expect(server?.toolInputSchemaJson('get_task')).toBeDefined()
    if (server === undefined) {
      throw new Error('expected factory server')
    }
    const client = await connectClient(server)
    const listed = resultOf(
      await client.request(2, 'tools/call', { name: 'list_tasks', arguments: {} }),
    )
    expect(listed.structuredContent).toMatchObject({ value: [] })
    expect(listed.structuredContent).toMatchObject({
      trace: {
        tool: 'list_tasks',
        durationMs: expect.any(Number),
        resultBytes: expect.any(Number),
      },
    })
    await client.close()
  })
})

describe('createDefaultServer', () => {
  it('does not open chrome until a page tool is called', async () => {
    let opens = 0
    const server = createDefaultServer({
      page: createLazyContextPage(async () => {
        opens += 1
        return fakePage()
      }),
    })
    const client = await connectClient(server)
    expect(opens).toBe(0)
    await client.request(2, 'tools/list', {})
    expect(opens).toBe(0)
    await client.request(3, 'tools/call', { name: 'list_tasks', arguments: {} })
    expect(opens).toBe(0)
    await client.request(4, 'tools/call', { name: 'observe', arguments: {} })
    expect(opens).toBe(1)
    await client.close()
  })

  it('records run_flow on list_tasks through the default runner', async () => {
    const previous = process.env.BROWSER_ENGINE_HEADED
    process.env.BROWSER_ENGINE_HEADED = '0'
    try {
      const server = createDefaultServer({ page: fakePage() })
      const client = await connectClient(server)
      const ran = resultOf(
        await client.request(2, 'tools/call', {
          name: 'run_flow',
          arguments: { steps: [{ action: 'click', uid: 'x' }] },
        }),
      )
      expect(ran.structuredContent).toMatchObject({ ok: true, steps: 1 })
      const listed = resultOf(
        await client.request(3, 'tools/call', { name: 'list_tasks', arguments: {} }),
      )
      expect(listed.structuredContent).toMatchObject({
        value: [expect.objectContaining({ name: 'run_flow', status: 'completed' })],
      })
      await client.close()
    } finally {
      if (previous === undefined) {
        delete process.env.BROWSER_ENGINE_HEADED
      } else {
        process.env.BROWSER_ENGINE_HEADED = previous
      }
    }
  })

  it('registers extraTools after the default set', () => {
    const server = createDefaultServer({
      extraTools: [
        defineTool({
          name: 'extension_status',
          description: 'test',
          category: ToolCategory.Observe,
          inputSchema: z.object({}),
          handler: async () => ({ ok: true }),
        }),
      ],
    })
    expect(server.toolInputSchemaJson('extension_status')).toBeDefined()
  })

  it('accepts a page and still exposes observe', async () => {
    const server = createDefaultServer({ page: fakePage() })
    expect(server.toolInputSchemaJson('observe')).toBeDefined()
    const client = await connectClient(server)
    const observed = resultOf(
      await client.request(2, 'tools/call', { name: 'observe', arguments: {} }),
    )
    expect(observed.structuredContent).toMatchObject({
      snapshot: { uid: 'x', role: 'generic', name: 'n' },
      image: 'img',
    })
    await client.close()
  })

  it('returns an McpServer with the event resource and task tools', async () => {
    const server = createDefaultServer()
    expect(server).toBeInstanceOf(McpServer)
    expect(server.toolInputSchemaJson('observe')).toBeDefined()
    expect(server.toolInputSchemaJson('confirm_action')).toBeDefined()
    expect(server.toolInputSchemaJson('wait_task')).toBeDefined()
    expect(server.toolInputSchemaJson('watch_until')).toBeDefined()
    expect(server.toolInputSchemaJson('verify')).toBeDefined()
    expect(server.toolInputSchemaJson('explain')).toBeDefined()
    expect(server.toolInputSchemaJson('run_flow')).toBeDefined()
    expect(server.toolInputSchemaJson('compile_flow')).toBeDefined()
    const client = await connectClient(server)
    expect(client.init.serverInfo).toEqual({ name: 'browser-engine', version: '0.0.1' })
    expect(listedToolNames(await client.request(2, 'tools/list', {}))).toEqual(DEFAULT_TOOL_NAMES)
    expect(listedResources(await client.request(3, 'resources/list', {}))).toEqual([
      { uri: 'browser://events', name: 'browser-events', mimeType: 'application/json' },
      {
        uri: 'ui://browser-engine/replay',
        name: 'browser-replay',
        mimeType: 'text/html;profile=mcp-app',
      },
    ])
    await client.close()
  })

  it('keeps the tools/list JSON-RPC line under Grok stdio 8KiB', async () => {
    const server = createDefaultServer()
    const client = await connectClient(server)
    const listed = resultOf(await client.request(2, 'tools/list', {}))
    const wire = JSON.stringify({ jsonrpc: '2.0', id: 2, result: listed })
    expect(wire.length).toBeLessThan(STDIO_LINE_BUDGET)
    expect(wire.indexOf('confirm_action')).toBeLessThan(STDIO_LINE_BUDGET)
    expect(wire.includes('"title"')).toBe(false)
    await client.close()
  })
})

describe('buildHttpHandler', () => {
  it('returns a fetch-shaped handler', () => {
    const handler = buildHttpHandler()
    expect(typeof handler.fetch).toBe('function')
  })

  it('serves an initialize POST through the default server factory', async () => {
    const handler = buildHttpHandler()
    const response = await handler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2026-07-28',
            capabilities: {},
            clientInfo: { name: 'test', version: '0.0.1' },
          },
        }),
      }),
    )
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(serverInfoFromSse(body)).toEqual({ name: 'browser-engine', version: '0.0.1' })
  })
})

describe('runInstallNativeHost', () => {
  function installDeps(overrides: Partial<InstallDeps> = {}): InstallDeps {
    return {
      platform: 'linux',
      home: '/home/tester',
      env: {},
      extensionRoot: '/pkg/extension',
      exists: () => false,
      mkdirSync: () => undefined,
      writeFileSync: () => undefined,
      chmodSync: () => undefined,
      execFileSync: () => undefined,
      log: () => undefined,
      ...overrides,
    }
  }

  it('returns zero and the formatted summary when no target fails', () => {
    const result = runInstallNativeHost(
      installDeps({ exists: (path) => path === '/home/tester/.config/vivaldi' }),
      false,
    )
    expect(result).toEqual({
      code: 0,
      lines: [
        'installed: Vivaldi',
        'skipped: Google Chrome, Google Chrome Beta, Google Chrome Unstable, Chromium, Brave, Microsoft Edge, Microsoft Edge Beta, Opera',
        'failed: none',
        'native host: /pkg/extension/native/host.sh',
        'extension id: pofhkiebdcchdedejdniobgfgakllkij',
        'Load unpacked in chrome://extensions (Developer mode)',
      ],
    })
  })

  it('passes --all through to every known target', () => {
    const result = runInstallNativeHost(installDeps(), true)
    expect(result.code).toBe(0)
    expect(result.lines[0]).toBe(
      'installed: Google Chrome, Google Chrome Beta, Google Chrome Unstable, Chromium, Brave, Microsoft Edge, Microsoft Edge Beta, Vivaldi, Opera',
    )
    expect(result.lines[1]).toBe('skipped: none')
  })

  it('returns one when a target fails', () => {
    const result = runInstallNativeHost(
      installDeps({
        exists: (path) => path === '/home/tester/.config/vivaldi',
        mkdirSync: () => {
          throw new Error('denied')
        },
      }),
      false,
    )
    expect(result.code).toBe(1)
    expect(result.lines[2]).toBe('failed: Vivaldi')
  })
})
