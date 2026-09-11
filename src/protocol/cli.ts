import type { McpServer } from '@modelcontextprotocol/server'
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio'
import { buildIntentTools } from '../intent/intentTools.js'
import { formatInstallSummary, installNativeHost, type InstallDeps } from '../nativeHost/install.js'
import { createRuntime, type RuntimeOptions } from '../session/runtime.js'
import { buildBrowserDeskTools } from '../tools/browserDeskTools.js'
import type { ToolDefinition } from '../tools/types.js'
import { buildTools } from './buildTools.js'
import { createHttpHandler } from './http.js'
import { createServer } from './server.js'

/** A server factory producing the fully-wired MCP server. */
type ServerFactory = () => McpServer

/** The serve function used to run the server over stdio (injectable for tests). */
export type Serve = (factory: ServerFactory) => StdioServerHandle

const SERVER_NAME = 'browser-engine'
const SERVER_VERSION = '0.0.1'

/** Optional page, event source, and extra MCP tools for the default server. */
export type DefaultServerOptions = RuntimeOptions & {
  extraTools?: ToolDefinition[]
}

/**
 * Builds the fully-wired default server: page tools, confirm_action (MRTR),
 * the Tasks fallback tools, and the browser://events resource. When a page
 * is provided it is wrapped in a BrowserSession; when an event source is
 * provided, EventCollector starts immediately.
 */
export function createDefaultServer(options: DefaultServerOptions = {}): McpServer {
  const runtime = createRuntime(options)
  return createServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      tools: [
        ...buildBrowserDeskTools(runtime.controller),
        ...buildTools(),
        ...buildIntentTools({ runner: runtime.runner }),
        ...(options.extraTools ?? []),
      ],
      events: runtime.events,
      tasks: { store: runtime.store, runner: runtime.runner },
      actions: runtime.actions,
      page: runtime.page,
    },
  )
}

/**
 * Builds the CLI main function. The serve dependency is injected: the entry
 * point passes the SDK's serveStdio, tests pass a stub. The factory creates
 * the fully-wired server with the standard page-aware tool set.
 */
export function buildCliMain(serve: Serve, options: DefaultServerOptions = {}): () => void {
  return () => {
    serve(() => createDefaultServer(options))
  }
}

/** Builds the Streamable HTTP handler around the default server factory. */
export function buildHttpHandler(options: DefaultServerOptions = {}) {
  return createHttpHandler(() => createDefaultServer(options))
}

/**
 * Installs the native-messaging host with the given deps and returns the
 * process exit code plus the human summary lines the CLI prints.
 */
export function runInstallNativeHost(
  deps: InstallDeps,
  all: boolean,
): { code: number; lines: string[] } {
  const summary = installNativeHost(deps, { all })
  return {
    code: summary.failed.length > 0 ? 1 : 0,
    lines: formatInstallSummary(summary),
  }
}
