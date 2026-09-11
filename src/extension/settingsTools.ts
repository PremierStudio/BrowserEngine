import { z } from 'zod'
import { defineTool } from '../tools/defineTool.js'
import { ToolCategory } from '../tools/types.js'
import type { ToolDefinition } from '../tools/types.js'
import type { createExtensionBridge } from './bridge.js'

type Bridge = ReturnType<typeof createExtensionBridge>

function requireBridge(bridge: Bridge | undefined): Bridge {
  if (bridge === undefined) {
    throw new Error('extension native host is not connected')
  }
  return bridge
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const record: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry
  }
  return record
}

/** MCP tools that read and write the unpacked-extension cockpit. */
export function buildExtensionTools(bridge: Bridge | undefined): ToolDefinition[] {
  return [
    defineTool({
      name: 'extension_status',
      description:
        'Cockpit snapshot: attached tab, pending attach prompt, settings, tabs, activity.',
      category: ToolCategory.Observe,
      readOnly: true,
      inputSchema: z.object({}),
      handler: async () => requireBridge(bridge).request('status'),
    }),
    defineTool({
      name: 'extension_get_settings',
      description: 'Read every BrowserEngine cockpit setting (attach policy, pace, viewport, …).',
      category: ToolCategory.Observe,
      readOnly: true,
      inputSchema: z.object({}),
      handler: async () => requireBridge(bridge).request('settings', { op: 'get' }),
    }),
    defineTool({
      name: 'extension_set_settings',
      description: 'Patch cockpit settings. Same keys as the options page.',
      category: ToolCategory.Action,
      inputSchema: z.object({}).passthrough(),
      handler: async (args) =>
        requireBridge(bridge).request('settings', { op: 'set', patch: asRecord(args) }),
    }),
    defineTool({
      name: 'extension_allow_origin',
      description: 'Allow chrome.debugger on this origin and resolve a pending attach prompt.',
      category: ToolCategory.Action,
      inputSchema: z.object({ origin: z.string() }),
      handler: async (args) => {
        const origin = asRecord(args).origin
        return requireBridge(bridge).request('allow', {
          origin: typeof origin === 'string' ? origin : '',
        })
      },
    }),
    defineTool({
      name: 'extension_deny_origin',
      description: 'Deny a pending attach prompt for this origin.',
      category: ToolCategory.Action,
      inputSchema: z.object({ origin: z.string() }),
      handler: async (args) => {
        const origin = asRecord(args).origin
        return requireBridge(bridge).request('deny', {
          origin: typeof origin === 'string' ? origin : '',
        })
      },
    }),
  ]
}
