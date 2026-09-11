import {
  isInputRequiredResult,
  McpServer,
  type CallToolResult,
  type InputRequiredResult,
} from '@modelcontextprotocol/server'
import type { ToolDefinition } from '../tools/types.js'
import { attachTrace, resultBytes, type CallLog } from '../tools/callTrace.js'

/** Grok's stdio client splits NDJSON at 8KiB. tools/list must stay under this. */
export const STDIO_LINE_BUDGET = 8192

/** The subset of ToolHandler that tool registration needs. */
export interface ToolCaller {
  call(name: string, args: unknown): Promise<unknown>
}

/** Optional clock and call log so MCP results carry timing. */
export interface RegisterToolsOptions {
  clock?: () => number
  traces?: CallLog
  afterCall?: () => void
}

/**
 * Maps a tool's read/write nature to MCP Tool Annotations (decision #6).
 * Read-only tools advertise readOnlyHint; write tools advertise
 * destructiveHint. Annotations are untrusted hints to the client.
 */
export function toToolAnnotations(readOnly: boolean): Record<string, boolean> {
  return readOnly ? { readOnlyHint: true } : { destructiveHint: true }
}

/**
 * Wraps a tool handler result as an MCP CallToolResult. InputRequiredResult
 * (MRTR, decision #4) is returned unchanged so the host can run elicitation.
 */
export function toCallToolResult(result: unknown): CallToolResult | InputRequiredResult {
  if (isInputRequiredResult(result)) {
    return result
  }
  const wrapped: CallToolResult = {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: isStructured(result) ? result : { value: result },
  }
  return wrapped
}

function isStructured(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Registers every tool from a ToolCaller onto an MCP server. Each tool's
 * zod input schema and annotations are passed through; the callback dispatches
 * to the ToolCaller (which enforces gating and the write mutex) and wraps the
 * result into an MCP CallToolResult with structuredContent plus a text
 * representation.
 */
function nowMs(): number {
  return Date.now()
}

function resolveClock(clock: (() => number) | undefined): () => number {
  if (clock === undefined) {
    return nowMs
  }
  return clock
}

/**
 * HITL results skip the call log and the content wrapper so the host can
 * run elicitation. Everything else is timed and traced.
 */
export function finalizeToolResult(
  name: string,
  result: unknown,
  started: number,
  clock: () => number,
  traces: CallLog | undefined,
): CallToolResult | InputRequiredResult {
  if (!isInputRequiredResult(result)) {
    const durationMs = clock() - started
    const trace = {
      tool: name,
      durationMs,
      resultBytes: resultBytes(result),
    }
    if (traces !== undefined) {
      traces.record({ ...trace, timestamp: started })
    }
    return toCallToolResult(attachTrace(result, trace))
  }
  return toCallToolResult(result)
}

export function registerTools(
  server: McpServer,
  tools: ToolDefinition[],
  handler: ToolCaller,
  options: RegisterToolsOptions = {},
): void {
  const clock = resolveClock(options.clock)
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: toToolAnnotations(tool.readOnly),
      },
      async (args) => {
        const started = clock()
        const result = await handler.call(tool.name, args)
        if (options.afterCall !== undefined) {
          options.afterCall()
        }
        return finalizeToolResult(tool.name, result, started, clock, options.traces)
      },
    )
  }
}
