import { describe, expect, it } from 'vitest'
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { createServer } from '../../src/protocol/server.js'
import { buildTools } from '../../src/protocol/buildTools.js'
import { ActionLog } from '../../src/actions/ActionLog.js'
import type { ContextPage } from '../../src/context/ContextPage.js'
import { EventBuffer } from '../../src/events/EventBuffer.js'
import { TaskRunner } from '../../src/tasks/TaskRunner.js'
import { TaskStore } from '../../src/tasks/TaskStore.js'
import { ToolCategory, type ToolDefinition } from '../../src/tools/types.js'

function fakePage(calls: string[] = []): ContextPage {
  return {
    getElementByUid: async () => undefined,
    waitForEventsAfterAction: async () => {
      calls.push('wait')
    },
    observe: async () => ({
      snapshot: { uid: 'x', role: 'generic', name: 'n' },
      image: 'img',
      overlay: {},
      pageState: { url: 'u', title: 't' },
    }),
    emulate: async () => undefined,
    getDialog: async () => null,
    click: async (uid: string) => {
      calls.push(`click:${uid}`)
    },
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
  await request(1, 'initialize', {
    protocolVersion: '2026-07-28',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.1' },
  })
  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return { request, close: () => server.close() }
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

describe('createServer', () => {
  it('returns an McpServer with implementation info', async () => {
    const server = createServer({ name: 'browser-engine', version: '0.0.1' })
    expect(server).toBeInstanceOf(McpServer)
    const client = await connectClient(server)
    const confirmMessage = await client.request(2, 'tools/call', {
      name: 'confirm_action',
      arguments: { message: 'ok?' },
    })
    const confirmText = JSON.stringify(confirmMessage)
    expect(confirmText).toContain('elicitation/create')
    expect(confirmText).not.toMatch(/unknown tool/i)
    await client.close()
  })

  it('registers each provided tool', async () => {
    const tool = {
      name: 'ping',
      description: 'Pings',
      category: ToolCategory.Observe,
      experimental: false,
      readOnly: true,
      inputSchema: z.object({ value: z.string() }),
      handler: async () => 'pong',
    }
    const server = createServer({ name: 'browser-engine', version: '0.0.1' }, { tools: [tool] })
    expect(server).toBeInstanceOf(McpServer)
    const jsonSchema = server.toolInputSchemaJson('ping')
    expect(jsonSchema).toBeDefined()
    expect(jsonSchema).toMatchObject({
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    })
    const client = await connectClient(server)
    const called = resultOf(
      await client.request(2, 'tools/call', { name: 'ping', arguments: { value: 'x' } }),
    )
    expect(called.structuredContent).toMatchObject({
      value: 'pong',
      trace: { tool: 'ping', durationMs: expect.any(Number), resultBytes: expect.any(Number) },
    })
    await client.close()
  })

  it('registers the event resource when an event buffer is provided', async () => {
    const buffer = new EventBuffer(10)
    buffer.push({ type: 'console', timestamp: 1, level: 'log', text: 'hello' })
    const server = createServer({ name: 'browser-engine', version: '0.0.1' }, { events: buffer })
    expect(server).toBeInstanceOf(McpServer)
    expect(server.toolInputSchemaJson('nope')).toBeUndefined()
    const client = await connectClient(server)
    expect(listedResources(await client.request(2, 'resources/list', {}))).toEqual([
      { uri: 'browser://events', name: 'browser-events', mimeType: 'application/json' },
    ])
    const read = resultOf(await client.request(3, 'resources/read', { uri: 'browser://events' }))
    expect(read.contents).toEqual([
      {
        uri: 'browser://events',
        mimeType: 'application/json',
        text: JSON.stringify([{ type: 'console', timestamp: 1, level: 'log', text: 'hello' }]),
      },
    ])
    await client.close()
  })

  it('notifies browser://events after a tool call when the buffer grew', async () => {
    const buffer = new EventBuffer(10)
    const ping: ToolDefinition = {
      name: 'ping',
      description: 'Pings',
      category: 'observe',
      experimental: false,
      readOnly: true,
      inputSchema: z.object({}),
      handler: async () => 'pong',
    }
    const server = createServer(
      { name: 'browser-engine', version: '0.0.1' },
      { tools: [ping], events: buffer },
    )
    const notified: string[] = []
    const original = server.server.sendResourceUpdated.bind(server.server)
    server.server.sendResourceUpdated = (params: { uri: string }) => {
      notified.push(params.uri)
      return original(params)
    }
    const client = await connectClient(server)
    buffer.push({ type: 'console', timestamp: 2, level: 'log', text: 'later' })
    await client.request(2, 'tools/call', { name: 'ping', arguments: {} })
    expect(notified).toEqual(['browser://events'])
    await client.request(3, 'tools/call', { name: 'ping', arguments: {} })
    expect(notified).toEqual(['browser://events'])
    await client.close()
  })

  it('records each tools/call into list_calls', async () => {
    const tool: ToolDefinition = {
      name: 'ping',
      description: 'Pings',
      category: 'observe',
      experimental: false,
      readOnly: true,
      inputSchema: z.object({ value: z.string() }),
      handler: async () => 'pong',
    }
    const server = createServer({ name: 'browser-engine', version: '0.0.1' }, { tools: [tool] })
    const client = await connectClient(server)
    await client.request(2, 'tools/call', { name: 'ping', arguments: { value: 'x' } })
    const listed = resultOf(
      await client.request(3, 'tools/call', { name: 'list_calls', arguments: {} }),
    )
    expect(listed.structuredContent).toMatchObject({
      calls: [{ tool: 'ping' }],
    })
    await client.close()
  })

  it('always registers the confirm_action tool', () => {
    const server = createServer({ name: 'browser-engine', version: '0.0.1' })
    const schema = server.toolInputSchemaJson('confirm_action')
    expect(schema).toBeDefined()
    expect(schema).toMatchObject({
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    })
  })

  it('wraps a provided page in a BrowserSession', async () => {
    const calls: string[] = []
    const page = fakePage(calls)
    const events = new EventBuffer(10)
    events.push({ type: 'console', timestamp: 1, level: 'log', text: 'hello' })
    const actions = new ActionLog(10)
    const server = createServer(
      { name: 'browser-engine', version: '0.0.1' },
      { tools: buildTools(), page, events, actions },
    )
    expect(server).toBeInstanceOf(McpServer)
    const client = await connectClient(server)
    const observed = resultOf(
      await client.request(2, 'tools/call', { name: 'observe', arguments: {} }),
    )
    expect(observed.structuredContent).toMatchObject({
      snapshot: { uid: 'x', role: 'generic', name: 'n' },
      events: [{ type: 'console', timestamp: 1, level: 'log', text: 'hello' }],
    })
    await client.request(3, 'tools/call', { name: 'click', arguments: { uid: 'btn-1' } })
    expect(calls).toContain('click:btn-1')
    expect(actions.all()).toEqual([{ action: 'click', uid: 'btn-1', timestamp: 0 }])
    await client.close()
  })

  it('registers the replay resource when an action log is provided', async () => {
    const actions = new ActionLog(10)
    actions.record({ action: 'click', uid: 'btn-1', timestamp: 1 })
    const server = createServer({ name: 'browser-engine', version: '0.0.1' }, { actions })
    expect(server).toBeInstanceOf(McpServer)
    const client = await connectClient(server)
    expect(listedResources(await client.request(2, 'resources/list', {}))).toEqual([
      {
        uri: 'ui://browser-engine/replay',
        name: 'browser-replay',
        mimeType: 'text/html;profile=mcp-app',
      },
    ])
    const read = resultOf(
      await client.request(3, 'resources/read', { uri: 'ui://browser-engine/replay' }),
    )
    expect(read.contents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uri: 'ui://browser-engine/replay',
          mimeType: 'text/html;profile=mcp-app',
        }),
      ]),
    )
    await client.close()
  })

  it('registers task tools when a task store is provided', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    store.create('run-flow')
    const server = createServer(
      { name: 'browser-engine', version: '0.0.1' },
      { tasks: { store, runner } },
    )
    expect(server.toolInputSchemaJson('get_task')).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    })
    expect(server.toolInputSchemaJson('list_tasks')).toBeDefined()
    expect(server.toolInputSchemaJson('cancel_task')).toBeDefined()
    expect(server.toolInputSchemaJson('wait_task')).toBeDefined()
    const client = await connectClient(server)
    const got = resultOf(
      await client.request(2, 'tools/call', { name: 'get_task', arguments: { id: 'task-1' } }),
    )
    expect(got.structuredContent).toMatchObject({
      id: 'task-1',
      name: 'run-flow',
      status: 'working',
    })
    await client.close()
  })

  it('wires page, events, actions, and tasks together', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    store.create('run-flow')
    const events = new EventBuffer(10)
    const actions = new ActionLog(10)
    const server = createServer(
      { name: 'browser-engine', version: '0.0.1' },
      { tools: buildTools(), page: fakePage(), events, actions, tasks: { store, runner } },
    )
    expect(server.toolInputSchemaJson('observe')).toBeDefined()
    expect(server.toolInputSchemaJson('list_calls')).toBeDefined()
    expect(server.toolInputSchemaJson('confirm_action')).toBeDefined()
    expect(server.toolInputSchemaJson('get_task')).toBeDefined()
    const client = await connectClient(server)
    const resources = listedResources(await client.request(2, 'resources/list', {}))
    expect(resources).toEqual([
      { uri: 'browser://events', name: 'browser-events', mimeType: 'application/json' },
      {
        uri: 'ui://browser-engine/replay',
        name: 'browser-replay',
        mimeType: 'text/html;profile=mcp-app',
      },
    ])
    await client.close()
  })

  it('leaves observe unusable when no page is wired', async () => {
    const server = createServer(
      { name: 'browser-engine', version: '0.0.1' },
      { tools: buildTools() },
    )
    const client = await connectClient(server)
    const observe = await client.request(2, 'tools/call', { name: 'observe', arguments: {} })
    const text = JSON.stringify(observe)
    expect(text).toMatch(/requires a page/i)
    await client.close()
  })
})
