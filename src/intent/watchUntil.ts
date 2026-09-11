import type { BrowserEvent } from '../events/types.js'
import type { SnapshotNode } from '../snapshot/a11ySnapshot.js'

/** A condition that watch_until polls for. */
export interface WatchCondition {
  kind: 'text' | 'uid' | 'role' | 'event'
  value: string
}

/** A sleep function used by the poll loop (injectable). */
type Sleep = (ms: number) => Promise<void>

/** A clock function returning the current timestamp (injectable). */
type Clock = () => number

/** Options for the blocking watch poll. */
export interface WatchOptions {
  timeout: number
  clock?: Clock
  sleep?: Sleep
  poll?: number
}

/** The outcome of a single watch poll decision. */
export type WatchStatus = 'matched' | 'timeout' | 'waiting'

const DEFAULT_POLL = 20

/** The default real-timer clock used when none is injected. */
export function defaultClock(): number {
  return Date.now()
}

/** The default real-timer sleep used when none is injected. */
export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function walk(node: SnapshotNode, pred: (n: SnapshotNode) => boolean): boolean {
  if (pred(node)) {
    return true
  }
  if (node.children === undefined) {
    return false
  }
  for (const child of node.children) {
    if (walk(child, pred)) {
      return true
    }
  }
  return false
}

function eventMatches(event: BrowserEvent, value: string): boolean {
  if (event.type === value) {
    return true
  }
  if ('text' in event && event.text.includes(value)) {
    return true
  }
  if ('url' in event && event.url.includes(value)) {
    return true
  }
  if ('target' in event && event.target.includes(value)) {
    return true
  }
  return false
}

/** Returns true when the current snapshot/events satisfy the watch condition. */
export function matchesWatch(
  snapshot: SnapshotNode,
  events: BrowserEvent[],
  condition: WatchCondition,
): boolean {
  if (condition.kind === 'uid') {
    return walk(snapshot, (node) => node.uid === condition.value)
  }
  if (condition.kind === 'role') {
    return walk(snapshot, (node) => node.role === condition.value)
  }
  if (condition.kind === 'text') {
    return walk(
      snapshot,
      (node) =>
        node.name.includes(condition.value) ||
        (node.value !== undefined && node.value.includes(condition.value)),
    )
  }
  for (const event of events) {
    if (eventMatches(event, condition.value)) {
      return true
    }
  }
  return false
}

/** Pure decision for one watch poll. */
export function checkWatch(matched: boolean, now: number, deadline: number): WatchStatus {
  if (matched) {
    return 'matched'
  }
  if (now >= deadline) {
    return 'timeout'
  }
  return 'waiting'
}

/**
 * Polls observe/events until the condition matches or the timeout elapses.
 * Clock and sleep are injected so the loop is deterministic in tests.
 */
export type WatchView = {
  snapshot: SnapshotNode
  events?: readonly BrowserEvent[]
}

export function eventsOf(view: WatchView): BrowserEvent[] {
  if (view.events === undefined) {
    return []
  }
  return [...view.events]
}

export async function watchUntil(
  observe: () => Promise<WatchView>,
  condition: WatchCondition,
  options: WatchOptions,
): Promise<{ matched: boolean; reason: string }> {
  const clock = options.clock ?? defaultClock
  const sleep = options.sleep ?? defaultSleep
  const poll = options.poll ?? DEFAULT_POLL
  const deadline = clock() + options.timeout
  for (;;) {
    const view = await observe()
    const matched = matchesWatch(view.snapshot, eventsOf(view), condition)
    const status = checkWatch(matched, clock(), deadline)
    if (status === 'matched') {
      return { matched: true, reason: 'condition met' }
    }
    if (status === 'timeout') {
      return { matched: false, reason: 'timeout' }
    }
    await sleep(poll)
  }
}
