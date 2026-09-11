import { McpServer, type ServerOptions } from '@modelcontextprotocol/server'
import { ToolHandler } from '../tools/ToolHandler.js'
import type { ToolDefinition } from '../tools/types.js'
import type { ActionLog } from '../actions/ActionLog.js'
import type { ContextPage } from '../context/ContextPage.js'
import type { EventBuffer } from '../events/EventBuffer.js'
import { BrowserSession } from '../session/BrowserSession.js'
import type { TaskRunner } from '../tasks/TaskRunner.js'
import type { TaskStore } from '../tasks/TaskStore.js'
import { buildConfirmTool } from './confirmTool.js'
import { createEventResource } from './eventResource.js'
import { createReplayResource } from './replayResource.js'
import { buildTaskTools } from './taskTools.js'
import { CallLog } from '../tools/callTrace.js'
import { buildListCallsTool } from '../tools/listCalls.js'
import { registerTools, type RegisterToolsOptions } from './tools.js'

/** The implementation info for the MCP server. */
export interface ServerInfo {
  name: string
  version: string
}

/** The owned Tasks extension pair (decision #2). */
interface TaskWiring {
  store: TaskStore
  runner: TaskRunner
}

/** Options for wiring browser services into the server. */
export interface ServerWiring {
  tools?: ToolDefinition[]
  events?: EventBuffer
  tasks?: TaskWiring
  actions?: ActionLog
  page?: ContextPage
}

/**
 * Builds a fully-wired MCP server: creates a ToolHandler, registers the
 * provided tool definitions, and bridges them onto an McpServer via the
 * protocol layer. When an event buffer is provided, a browser://events
 * subscription resource is registered (decision #3). This is the composition
 * root for the runnable server.
 */
export function createServer(
  info: ServerInfo,
  wiring: ServerWiring = {},
  options?: ServerOptions,
): McpServer {
  const server = new McpServer(info, options)
  const handler = new ToolHandler()
  const traces = new CallLog(100)
  const tools: ToolDefinition[] = [
    ...(wiring.tools ?? []),
    buildConfirmTool(),
    buildListCallsTool(traces),
  ]
  if (wiring.tasks !== undefined) {
    tools.push(...buildTaskTools(wiring.tasks.store, wiring.tasks.runner))
  }
  for (const tool of tools) {
    handler.register(tool)
  }
  if (wiring.page !== undefined) {
    handler.setPage(
      new BrowserSession(wiring.page, {
        events: wiring.events,
        log: wiring.actions,
      }),
    )
  }
  const events =
    wiring.events === undefined
      ? undefined
      : createEventResource(server, wiring.events, 'browser://events')
  const registerOptions: RegisterToolsOptions = { traces }
  if (events !== undefined) {
    registerOptions.afterCall = () => {
      events.check()
    }
  }
  registerTools(server, tools, handler, registerOptions)
  if (wiring.actions !== undefined) {
    createReplayResource(server, wiring.actions, 'ui://browser-engine/replay')
  }
  return server
}
