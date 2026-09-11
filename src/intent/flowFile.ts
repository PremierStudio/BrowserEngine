import type { FlowStep } from './runFlow.js'

/** Saved-flow schema. Bump only with a matching parser. */
export const FLOW_FILE_VERSION = 1

/** Durable run_flow document. No uids. */
export type FlowFile = {
  readonly version: typeof FLOW_FILE_VERSION
  readonly name: string
  readonly origin?: string
  readonly steps: readonly FlowStep[]
}

/** In-memory draft before it is stamped and checked. */
export type FlowDraft = {
  readonly name: string
  readonly origin?: string
  readonly steps: readonly FlowStep[]
}

/** Unique save, or a refusal that names the rule. */
export type FlowFileResult =
  { readonly ok: true; readonly file: FlowFile } | { readonly ok: false; readonly error: string }

const BINDABLE = new Set(['click', 'type', 'hover', 'scroll', 'select'])
const KNOWN = new Set([...BINDABLE, 'navigate', 'press', 'check'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimmed(value: string): string {
  return value.replace(/^\s+|\s+$/g, '')
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'number') {
    return undefined
  }
  return value
}

function copyStep(step: FlowStep): FlowStep {
  const next: FlowStep = { action: step.action }
  if (step.name !== undefined) {
    next.name = step.name
  }
  if (step.role !== undefined) {
    next.role = step.role
  }
  if (step.near !== undefined) {
    next.near = step.near
  }
  if (step.text !== undefined) {
    next.text = step.text
  }
  if (step.dx !== undefined) {
    next.dx = step.dx
  }
  if (step.dy !== undefined) {
    next.dy = step.dy
  }
  if (step.value !== undefined) {
    next.value = step.value
  }
  if (step.key !== undefined) {
    next.key = step.key
  }
  if (step.url !== undefined) {
    next.url = step.url
  }
  if (step.expectUrl !== undefined) {
    next.expectUrl = step.expectUrl
  }
  if (step.expectText !== undefined) {
    next.expectText = step.expectText
  }
  return next
}

function durableError(step: FlowStep): string | undefined {
  if (step.action === '') {
    return 'flow step requires action'
  }
  if (!KNOWN.has(step.action)) {
    return `unknown action: ${step.action}`
  }
  if (step.action === 'press' && step.key === undefined) {
    return 'action press requires key'
  }
  if (step.action === 'navigate' && step.url === undefined) {
    return 'action navigate requires url'
  }
  if (step.action === 'check' && step.expectUrl === undefined && step.expectText === undefined) {
    return 'action check requires expectUrl or expectText'
  }
  if (BINDABLE.has(step.action) && (step.name === undefined || trimmed(step.name) === '')) {
    return `action ${step.action} requires name`
  }
  if (
    (step.action === 'click' || step.action === 'navigate') &&
    step.expectUrl === undefined &&
    step.expectText === undefined
  ) {
    return `action ${step.action} requires expectUrl or expectText`
  }
  return undefined
}

function stepFromUnknown(value: unknown): FlowStep | string {
  if (!isRecord(value)) {
    return 'flow step must be an object'
  }
  if (typeof value.action !== 'string') {
    return 'flow step requires action'
  }
  return copyStep({
    action: value.action,
    name: optionalString(value.name),
    role: optionalString(value.role),
    near: optionalString(value.near),
    text: optionalString(value.text),
    dx: optionalNumber(value.dx),
    dy: optionalNumber(value.dy),
    value: optionalString(value.value),
    key: optionalString(value.key),
    url: optionalString(value.url),
    expectUrl: optionalString(value.expectUrl),
    expectText: optionalString(value.expectText),
  })
}

/** Stamp version 1, strip uids, and refuse a file that cannot replay. */
export function saveFlow(draft: FlowDraft): FlowFileResult {
  const name = trimmed(draft.name)
  if (name === '') {
    return { ok: false, error: 'flow name is required' }
  }
  const steps: FlowStep[] = []
  for (const step of draft.steps) {
    const error = durableError(step)
    if (error !== undefined) {
      return { ok: false, error }
    }
    steps.push(copyStep(step))
  }
  const originRaw = draft.origin
  const origin = originRaw === undefined ? undefined : trimmed(originRaw)
  if (origin === undefined || origin === '') {
    return { ok: true, file: { version: FLOW_FILE_VERSION, name, steps } }
  }
  return { ok: true, file: { version: FLOW_FILE_VERSION, name, origin, steps } }
}

/** Pretty JSON for a saved flow. */
export function serializeFlowFile(file: FlowFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/** Parse and apply the same durability rules as save. */
export function parseFlowFile(text: string): FlowFileResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'flow file is not valid JSON' }
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: 'flow file must be an object' }
  }
  if (parsed.version !== FLOW_FILE_VERSION) {
    return { ok: false, error: `unsupported flow version: ${String(parsed.version)}` }
  }
  if (typeof parsed.name !== 'string') {
    return { ok: false, error: 'flow name is required' }
  }
  if (!Array.isArray(parsed.steps)) {
    return { ok: false, error: 'flow steps must be an array' }
  }
  const steps: FlowStep[] = []
  for (const item of parsed.steps) {
    const step = stepFromUnknown(item)
    if (typeof step === 'string') {
      return { ok: false, error: step }
    }
    steps.push(step)
  }
  const origin = optionalString(parsed.origin)
  return saveFlow({ name: parsed.name, origin, steps })
}
