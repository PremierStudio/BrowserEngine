import { z } from 'zod'
import { definePageTool } from '../tools/defineTool.js'
import { ToolCategory } from '../tools/types.js'
import type { ToolDefinition } from '../tools/types.js'
import type { ContextPage } from '../context/ContextPage.js'
import type { DiffResult } from '../diff/diff.js'
import { explain, type ExplainTarget } from './explain.js'
import { compileFlow } from './compileFlow.js'
import { outlineFromUnknown } from '../snapshot/outline.js'
import { runFlow, runFlowToolOptions, type FlowStep } from './runFlow.js'
import { defaultClock, defaultSleep } from './watchUntil.js'
import { verify, type Assertion } from './verify.js'
import { watchUntil, type WatchCondition } from './watchUntil.js'
import type { BrowserEvent } from '../events/types.js'
import type { ObserveResult } from '../context/ContextPage.js'
import type { TaskRunner } from '../tasks/TaskRunner.js'

/** Optional task recording for the long-running intent tools. */
export type IntentToolOptions = {
  readonly runner?: TaskRunner
}

function eventsFromObserve(observed: ObserveResult): BrowserEvent[] {
  if (observed.events === undefined) {
    return []
  }
  return [...observed.events]
}

async function maybeTrack<T>(
  runner: TaskRunner | undefined,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (runner === undefined) {
    return fn()
  }
  return runner.track(name, fn)
}

/** Builds the explain() diff target. Exported so tests pin `kind: 'diff'`. */
export function diffExplainTarget(diff: DiffResult): ExplainTarget {
  return { kind: 'diff', diff }
}

function isContextPage(page: unknown): page is ContextPage {
  if (typeof page !== 'object' || page === null) {
    return false
  }
  return 'observe' in page && typeof page.observe === 'function'
}

function requirePage(page: unknown): ContextPage {
  if (!isContextPage(page)) {
    throw new Error('requires a page')
  }
  return page
}

function isWatchArgs(args: unknown): args is WatchCondition & { timeout: number } {
  return (
    typeof args === 'object' &&
    args !== null &&
    'kind' in args &&
    'value' in args &&
    'timeout' in args
  )
}

function isFlowArgs(args: unknown): args is { steps: FlowStep[] } {
  return typeof args === 'object' && args !== null && 'steps' in args && Array.isArray(args.steps)
}

function isCompileArgs(args: unknown): args is { steps: FlowStep[]; requireExpect?: boolean } {
  if (!isFlowArgs(args)) {
    return false
  }
  if (!('requireExpect' in args)) {
    return true
  }
  return typeof args.requireExpect === 'boolean'
}

const flowStepSchema = z.object({ action: z.string() }).passthrough()

function isVerifyArgs(args: unknown): args is Assertion {
  return typeof args === 'object' && args !== null && 'kind' in args
}

function isExplainArgs(args: unknown): args is ExplainTarget {
  return typeof args === 'object' && args !== null && 'kind' in args
}

function isDiffResult(value: unknown): value is DiffResult {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return 'added' in value && 'removed' in value && 'changed' in value
}

/** The M6 intent tools: watch_until, compile_flow, run_flow, verify, explain. */
export function buildIntentTools(options: IntentToolOptions = {}): ToolDefinition[] {
  return [
    definePageTool({
      name: 'watch_until',
      description: 'Poll the page until a condition matches or the timeout elapses.',
      category: ToolCategory.Intent,
      inputSchema: z.object({
        kind: z.enum(['text', 'uid', 'role', 'event']),
        value: z.string(),
        timeout: z.number(),
      }),
      handler: async (args, _context, page) => {
        if (!isWatchArgs(args)) {
          throw new Error('invalid args')
        }
        const contextPage = requirePage(page)
        return maybeTrack(options.runner, 'watch_until', async () =>
          watchUntil(
            async () => {
              const observed = await contextPage.observe()
              return { snapshot: observed.snapshot, events: eventsFromObserve(observed) }
            },
            { kind: args.kind, value: args.value },
            { timeout: args.timeout },
          ),
        )
      },
    }),
    definePageTool({
      name: 'compile_flow',
      description:
        'Compile a run_flow against the live outline. Fills uids. A name must bind uniquely or this returns candidates. Does not act.',
      category: ToolCategory.Intent,
      readOnly: true,
      inputSchema: z.object({
        steps: z.array(flowStepSchema),
        requireExpect: z.boolean().optional(),
      }),
      handler: async (args, _context, page) => {
        if (!isCompileArgs(args)) {
          throw new Error('invalid args')
        }
        const observed = await requirePage(page).observe()
        return compileFlow(outlineFromUnknown(observed.snapshot), args.steps, {
          requireExpect: args.requireExpect !== false,
        })
      },
    }),
    definePageTool({
      name: 'run_flow',
      description:
        'Run a named sequence. Prefer name (role/near) over uid. A name must bind uniquely. Re-resolves after click/navigate. Optional expectUrl/expectText poll. Call once instead of observe-per-page.',
      category: ToolCategory.Intent,
      inputSchema: z.object({
        steps: z.array(flowStepSchema),
      }),
      handler: async (args, _context, page) => {
        if (!isFlowArgs(args)) {
          throw new Error('invalid args')
        }
        return maybeTrack(options.runner, 'run_flow', () =>
          runFlow(
            requirePage(page),
            args.steps,
            runFlowToolOptions(process.env, defaultSleep, defaultClock),
          ),
        )
      },
    }),
    definePageTool({
      name: 'verify',
      description: 'Assert a condition against the current snapshot and return evidence.',
      category: ToolCategory.Intent,
      readOnly: true,
      inputSchema: z.object({
        kind: z.enum(['uidExists', 'role', 'name', 'value', 'textContains']),
        uid: z.string().optional(),
        expected: z.string().optional(),
      }),
      handler: async (args, _context, page) => {
        if (!isVerifyArgs(args)) {
          throw new Error('invalid args')
        }
        const observed = await requirePage(page).observe()
        return verify(observed.snapshot, args)
      },
    }),
    definePageTool({
      name: 'explain',
      description: 'Explain a uid, region, or diff with a summary and annotation.',
      category: ToolCategory.Intent,
      readOnly: true,
      inputSchema: z.object({
        kind: z.enum(['uid', 'region', 'diff']),
        uid: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        diff: z.unknown().optional(),
      }),
      handler: async (args, _context, page) => {
        if (!isExplainArgs(args)) {
          throw new Error('invalid args')
        }
        const observed = await requirePage(page).observe()
        if (args.kind === 'diff') {
          const diff = 'diff' in args ? args.diff : undefined
          if (!isDiffResult(diff)) {
            throw new Error('invalid args')
          }
          return explain(observed.snapshot, observed.overlay, diffExplainTarget(diff))
        }
        return explain(observed.snapshot, observed.overlay, args)
      },
    }),
  ]
}
