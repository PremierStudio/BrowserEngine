import type { ContextPage, ObserveResult } from '../context/ContextPage.js'
import { outlineFromUnknown, type OutlineItem } from '../snapshot/outline.js'
import { compileFlow } from './compileFlow.js'
import { argvHasHeaded } from '../browser/launchOptions.js'
import { foldLabel } from '../label.js'
import { bindTarget, formatBindFailure } from './resolveTarget.js'
import { verify } from './verify.js'

/** Headed default: long enough to see the HUD ripple and the next page. */
export const HUMAN_PACE_MS = 700

/** Headed default: wait for the next page instead of checking once. */
export const DEFAULT_EXPECT_TIMEOUT_MS = 5000

/** Poll gap while waiting for expectUrl / expectText. */
const DEFAULT_EXPECT_INTERVAL_MS = 20

/** Optional pause injected so tests never use a real timer. */
export type RunFlowOptions = {
  paceMs?: number
  sleep?: (ms: number) => Promise<void>
  clock?: () => number
  expectTimeoutMs?: number
  expectIntervalMs?: number
}

/**
 * Visible window: watchable pace. Headless is instant.
 * `BROWSER_ENGINE_PACE_MS` overrides (including 0).
 */
export function flowPaceMs(
  env: Record<string, string | undefined>,
  argv?: readonly string[],
): number {
  const parsed = Number(env.BROWSER_ENGINE_PACE_MS)
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }
  if (env.BROWSER_ENGINE_HEADED === '0' && !argvHasHeaded(argv)) {
    return 0
  }
  return HUMAN_PACE_MS
}

/** Pace, expect wait, and real timers used by the run_flow tool. */
export function runFlowToolOptions(
  env: Record<string, string | undefined>,
  sleep: (ms: number) => Promise<void>,
  clock: () => number,
): RunFlowOptions {
  return {
    paceMs: flowPaceMs(env, process.argv),
    expectTimeoutMs: flowExpectTimeoutMs(env, process.argv),
    sleep,
    clock,
  }
}

/**
 * Visible window: wait for expects. Headless is one shot.
 * `BROWSER_ENGINE_EXPECT_MS` overrides (including 0).
 */
export function flowExpectTimeoutMs(
  env: Record<string, string | undefined>,
  argv?: readonly string[],
): number {
  const parsed = Number(env.BROWSER_ENGINE_EXPECT_MS)
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }
  if (env.BROWSER_ENGINE_HEADED === '0' && !argvHasHeaded(argv)) {
    return 0
  }
  return DEFAULT_EXPECT_TIMEOUT_MS
}

async function pause(options: RunFlowOptions, paceMs: number): Promise<void> {
  if (paceMs <= 0 || options.sleep === undefined) {
    return
  }
  await options.sleep(paceMs)
}

/** Numbered bind or expect failure for a saved or live flow. */
export function formatStepError(index: number, step: FlowStep, message: string): string {
  return `step ${index + 1} ${step.action}: ${message}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function throwStepError(index: number, step: FlowStep, error: unknown): never {
  throw new Error(formatStepError(index, step, errorMessage(error)))
}

/** A single step in a run_flow sequence. */
export interface FlowStep {
  action: string
  uid?: string
  name?: string
  role?: string
  near?: string
  text?: string
  dx?: number
  dy?: number
  value?: string
  key?: string
  url?: string
  expectUrl?: string
  expectText?: string
}

async function readOutline(page: ContextPage): Promise<OutlineItem[]> {
  return outlineFromUnknown((await page.observe()).snapshot)
}

function pollSetup(
  options: RunFlowOptions,
):
  | { clock: () => number; sleep: (ms: number) => Promise<void>; timeout: number; poll: number }
  | undefined {
  const timeout = options.expectTimeoutMs ?? 0
  const poll = options.expectIntervalMs ?? DEFAULT_EXPECT_INTERVAL_MS
  const clock = options.clock
  const sleep = options.sleep
  if (clock === undefined || sleep === undefined || poll <= 0 || timeout <= 0) {
    return undefined
  }
  return { clock, sleep, timeout, poll }
}

async function resolveStepUid(
  page: ContextPage,
  step: FlowStep,
  cached: OutlineItem[] | undefined,
  options: RunFlowOptions,
): Promise<{ uid: string; outline: OutlineItem[] | undefined }> {
  if (step.uid !== undefined) {
    return { uid: step.uid, outline: cached }
  }
  if (step.name === undefined) {
    throw new Error(`action ${step.action} requires uid or name`)
  }
  let outline: OutlineItem[]
  if (cached === undefined) {
    outline = await readOutline(page)
  } else {
    outline = cached
  }
  let bind = bindTarget(outline, step)
  if (bind.status === 'bound') {
    return { uid: bind.uid, outline }
  }
  const polling = pollSetup(options)
  if (polling === undefined) {
    outline = await readOutline(page)
    bind = bindTarget(outline, step)
    if (bind.status !== 'bound') {
      throw new Error(formatBindFailure(step, bind))
    }
    return { uid: bind.uid, outline }
  }
  const deadline = polling.clock() + polling.timeout
  for (;;) {
    outline = await readOutline(page)
    bind = bindTarget(outline, step)
    if (bind.status === 'bound') {
      return { uid: bind.uid, outline }
    }
    if (polling.clock() >= deadline) {
      throw new Error(formatBindFailure(step, bind))
    }
    await polling.sleep(polling.poll)
  }
}

export function throwCompileError(
  steps: readonly FlowStep[],
  compiled: { error: string; index: number },
): never {
  for (const [index, step] of steps.entries()) {
    if (index === compiled.index) {
      throwStepError(index, step, compiled.error)
    }
  }
  throw new Error(`step ${String(compiled.index + 1)} flow: ${compiled.error}`)
}

function isNumberedStepError(error: unknown): boolean {
  return error instanceof Error && /^step [1-9]/.test(error.message)
}

async function compileAgainstPage(
  page: ContextPage,
  steps: FlowStep[],
  options: RunFlowOptions,
): Promise<{ planned: FlowStep[]; outline: OutlineItem[] }> {
  try {
    let outline = await readOutline(page)
    let compiled = compileFlow(outline, steps)
    if (compiled.ok) {
      return { planned: compiled.steps, outline }
    }
    const polling = pollSetup(options)
    if (polling === undefined) {
      outline = await readOutline(page)
      compiled = compileFlow(outline, steps)
      if (!compiled.ok) {
        throwCompileError(steps, compiled)
      }
      return { planned: compiled.steps, outline }
    }
    const deadline = polling.clock() + polling.timeout
    for (;;) {
      outline = await readOutline(page)
      compiled = compileFlow(outline, steps)
      if (compiled.ok) {
        return { planned: compiled.steps, outline }
      }
      if (polling.clock() >= deadline) {
        throwCompileError(steps, compiled)
      }
      await polling.sleep(polling.poll)
    }
  } catch (error) {
    if (isNumberedStepError(error)) {
      throw error
    }
    throwStepError(0, { action: 'observe' }, error)
  }
}

function textFound(observed: ObserveResult, want: string): boolean {
  const folded = foldLabel(want)
  if (folded !== '' && foldLabel(observed.pageState.title).includes(folded)) {
    return true
  }
  return verify(observed.snapshot, { kind: 'textContains', expected: want }).pass
}

function expectFailure(step: FlowStep, observed: ObserveResult): string {
  if (step.expectUrl !== undefined && !observed.pageState.url.includes(step.expectUrl)) {
    return `expectUrl failed after ${step.action} want=${step.expectUrl} got=${observed.pageState.url}`
  }
  return `expectText failed after ${step.action} want=${step.expectText}`
}

function stepExpectsMet(observed: ObserveResult, step: FlowStep): boolean {
  if (step.expectUrl !== undefined && !observed.pageState.url.includes(step.expectUrl)) {
    return false
  }
  if (step.expectText !== undefined && !textFound(observed, step.expectText)) {
    return false
  }
  return true
}

async function readExpects(
  page: ContextPage,
): Promise<{ observed: ObserveResult; outline: OutlineItem[] }> {
  const observed = await page.observe()
  return { observed, outline: outlineFromUnknown(observed.snapshot) }
}

async function assertStepExpects(
  page: ContextPage,
  step: FlowStep,
  options: RunFlowOptions,
): Promise<OutlineItem[]> {
  const timeout = options.expectTimeoutMs ?? 0
  const poll = options.expectIntervalMs ?? DEFAULT_EXPECT_INTERVAL_MS
  const clock = options.clock
  const sleep = options.sleep
  if (clock === undefined || sleep === undefined || poll <= 0) {
    const first = await readExpects(page)
    if (!stepExpectsMet(first.observed, step)) {
      throw new Error(expectFailure(step, first.observed))
    }
    return first.outline
  }
  const deadline = clock() + timeout
  for (;;) {
    const next = await readExpects(page)
    if (stepExpectsMet(next.observed, step)) {
      return next.outline
    }
    if (clock() >= deadline) {
      throw new Error(expectFailure(step, next.observed))
    }
    await sleep(poll)
  }
}

/** Runs a sequence of page actions and returns the number of steps executed. */
export async function runFlow(
  page: ContextPage,
  steps: FlowStep[],
  options: RunFlowOptions = {},
): Promise<{ ok: true; steps: number }> {
  const paceMs = options.paceMs ?? 0
  let planned = steps
  let outline: OutlineItem[] | undefined
  if (steps.length > 0) {
    const compiled = await compileAgainstPage(page, steps, options)
    planned = compiled.planned
    outline = compiled.outline
  }
  for (const [index, step] of planned.entries()) {
    try {
      if (step.action === 'check') {
        if (step.expectUrl === undefined && step.expectText === undefined) {
          throw new Error('action check requires expectUrl or expectText')
        }
        outline = await assertStepExpects(page, step, options)
        await pause(options, paceMs)
        continue
      }
      if (step.action === 'press') {
        if (step.key === undefined) {
          throw new Error('action press requires key')
        }
        await page.press(step.key)
        outline = undefined
      } else if (step.action === 'navigate') {
        if (step.url === undefined) {
          throw new Error('action navigate requires url')
        }
        await page.navigate(step.url)
        outline = undefined
      } else if (
        step.action !== 'click' &&
        step.action !== 'type' &&
        step.action !== 'hover' &&
        step.action !== 'scroll' &&
        step.action !== 'select'
      ) {
        throw new Error(`unknown action: ${step.action}`)
      } else {
        const resolved = await resolveStepUid(page, step, outline, options)
        outline = resolved.outline
        if (step.action === 'click') {
          await page.click(resolved.uid)
        } else if (step.action === 'type') {
          await page.type(resolved.uid, step.text ?? '')
        } else if (step.action === 'hover') {
          await page.hover(resolved.uid)
        } else if (step.action === 'scroll') {
          await page.scroll(resolved.uid, step.dx ?? 0, step.dy ?? 0)
        } else {
          await page.select(resolved.uid, step.value ?? '')
        }
        if (step.action === 'click' || step.action === 'select') {
          outline = undefined
        }
      }
      if (step.expectUrl !== undefined || step.expectText !== undefined) {
        outline = await assertStepExpects(page, step, options)
      }
      await pause(options, paceMs)
    } catch (error) {
      throwStepError(index, step, error)
    }
  }
  return { ok: true, steps: steps.length }
}
