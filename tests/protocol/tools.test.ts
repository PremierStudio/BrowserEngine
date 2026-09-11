import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server'
import { CallLog } from '../../src/tools/callTrace.js'
import { confirmGate } from '../../src/protocol/mrtr.js'
import {
  finalizeToolResult,
  registerTools,
  toToolAnnotations,
  type ToolCaller,
} from '../../src/protocol/tools.js'
import type { ToolDefinition } from '../../src/tools/types.js'

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'ping',
    description: 'Pings',
    category: 'observe',
    experimental: false,
    readOnly: true,
    inputSchema: z.object({ value: z.string() }).optional(),
    handler: async () => 'pong',
    ...overrides,
  }
}

function makeCaller(): ToolCaller {
  return { call: async () => 'pong' }
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

describe('toToolAnnotations', () => {
  it('marks read-only tools with readOnlyHint', () => {
    expect(toToolAnnotations(true)).toEqual({ readOnlyHint: true })
  })

  it('marks write tools with destructiveHint', () => {
    expect(toToolAnnotations(false)).toEqual({ destructiveHint: true })
  })
})

describe('finalizeToolResult', () => {
  it('returns an input_required result without wrapping or tracing it', () => {
    const traces = new CallLog(8)
    const gate = confirmGate('delete this', 'delete this')
    const finalized = finalizeToolResult('confirm_action', gate, 10, () => 20, traces)
    expect(finalized).toBe(gate)
    expect(finalized).toMatchObject({ resultType: 'input_required' })
    expect(isRecord(finalized) && 'content' in finalized).toBe(false)
    expect(isRecord(finalized) && 'trace' in finalized).toBe(false)
    expect(traces.all()).toEqual([])
  })

  it('times and records a normal result', () => {
    const traces = new CallLog(8)
    const finalized = finalizeToolResult('ping', { ok: true }, 10, () => 25, traces)
    expect(finalized).toMatchObject({
      structuredContent: {
        ok: true,
        trace: { tool: 'ping', durationMs: 15 },
      },
    })
    expect(traces.all()).toEqual([
      {
        tool: 'ping',
        durationMs: 15,
        resultBytes: JSON.stringify({ ok: true }).length,
        timestamp: 10,
      },
    ])
  })
})

describe('registerTools', () => {
  it('registers each tool on the server', async () => {
    const server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    )
    registerTools(server, [makeTool({ name: 'ping' })], makeCaller())
    expect(server.toolInputSchemaJson('ping')).toBeDefined()
    expect(server.toolInputSchemaJson('nope')).toBeUndefined()
    const client = await connectClient(server)
    const listed = resultOf(await client.request(2, 'tools/list', {}))
    expect(listed.tools).toEqual([
      expect.objectContaining({
        name: 'ping',
        description: 'Pings',
        annotations: { readOnlyHint: true },
        inputSchema: expect.objectContaining({
          type: 'object',
          properties: { value: { type: 'string' } },
        }),
      }),
    ])
    await client.close()
  })

  it('runs afterCall after each tools/call', async () => {
    const server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    )
    const ticks: string[] = []
    registerTools(server, [makeTool({ name: 'ping' })], makeCaller(), {
      afterCall: () => {
        ticks.push('after')
      },
    })
    const client = await connectClient(server)
    expect(ticks).toEqual([])
    await client.request(2, 'tools/call', { name: 'ping', arguments: { value: 'x' } })
    expect(ticks).toEqual(['after'])
    await client.close()
  })

  it('exposes the tool description and annotations through the server', async () => {
    const server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    )
    registerTools(
      server,
      [makeTool({ name: 'ping', description: 'Pings', readOnly: true })],
      makeCaller(),
    )
    const schema = server.toolInputSchemaJson('ping')
    expect(schema).toBeDefined()
    expect(schema).toMatchObject({
      type: 'object',
      properties: { value: { type: 'string' } },
    })
    const client = await connectClient(server)
    const listed = resultOf(await client.request(2, 'tools/list', {}))
    expect(listed.tools).toEqual([
      expect.objectContaining({
        name: 'ping',
        description: 'Pings',
        annotations: { readOnlyHint: true },
      }),
    ])
    await client.close()
  })

  it('dispatches the callback to the tool caller', async () => {
    const server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    )
    let called = 0
    registerTools(server, [makeTool({ name: 'ping' })], {
      call: async (name) => {
        called += 1
        return `${name}-result`
      },
    })
    const client = await connectClient(server)
    const result = resultOf(
      await client.request(2, 'tools/call', { name: 'ping', arguments: { value: 'x' } }),
    )
    expect(called).toBe(1)
    expect(result.structuredContent).toMatchObject({
      value: 'ping-result',
      trace: {
        tool: 'ping',
        durationMs: expect.any(Number),
        resultBytes: expect.any(Number),
      },
    })
    expect(server.toolInputSchemaJson('ping')).toBeDefined()
    await client.close()
  })

  it('uses Date.now when no clock is injected and still records a finite duration', async () => {
    const server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    )
    registerTools(server, [makeTool({ name: 'ping' })], makeCaller())
    const client = await connectClient(server)
    const result = resultOf(
      await client.request(2, 'tools/call', { name: 'ping', arguments: { value: 'x' } }),
    )
    const structured = result.structuredContent
    expect(isRecord(structured)).toBe(true)
    if (!isRecord(structured)) {
      throw new Error('expected structuredContent')
    }
    expect(isRecord(structured.trace)).toBe(true)
    if (!isRecord(structured.trace)) {
      throw new Error('expected trace')
    }
    expect(typeof structured.trace.durationMs).toBe('number')
    expect(Number.isFinite(structured.trace.durationMs)).toBe(true)
    expect(structured.trace.durationMs).toBeGreaterThanOrEqual(0)
    await client.close()
  })

  it('stamps durationMs and resultBytes using the injected clock and log', async () => {
    const server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    )
    const traces = new CallLog(8)
    let now = 100
    registerTools(
      server,
      [makeTool({ name: 'ping' })],
      { call: async () => ({ ok: true }) },
      {
        traces,
        clock: () => {
          now += 25
          return now
        },
      },
    )
    const client = await connectClient(server)
    const result = resultOf(
      await client.request(2, 'tools/call', { name: 'ping', arguments: { value: 'x' } }),
    )
    expect(result.structuredContent).toMatchObject({
      ok: true,
      trace: { tool: 'ping', durationMs: 25, resultBytes: JSON.stringify({ ok: true }).length },
    })
    expect(traces.all()).toEqual([
      {
        tool: 'ping',
        durationMs: 25,
        resultBytes: JSON.stringify({ ok: true }).length,
        timestamp: 125,
      },
    ])
    await client.close()
  })
})
