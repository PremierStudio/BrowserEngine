import { TaskStore, type Task } from './TaskStore.js'

/** A sleep function used by the blocking wait fallback (injectable). */
type Sleep = (ms: number) => Promise<void>

/** A clock function returning the current timestamp (injectable). */
type Clock = () => number

/** Options for the blocking wait fallback (decision #2). */
export interface WaitOptions {
  timeout: number
  clock?: Clock
  sleep?: Sleep
}

/** The terminal task statuses. */
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

/** The default real-timer clock used when none is injected. */
export function defaultClock(): number {
  return Date.now()
}

/** The default real-timer sleep used when none is injected. */
export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Runs long-running operations as tasks (decision #2). Each run creates a
 * task in the store and drives it to a terminal state. wait() is the hard
 * fallback path for hosts without the Tasks extension: it blocks and
 * long-polls the task until it completes, fails, cancels, or times out.
 */
export class TaskRunner {
  private readonly store: TaskStore

  constructor(store: TaskStore) {
    this.store = store
  }

  async run(name: string, fn: () => Promise<unknown>): Promise<Task> {
    const task = this.store.create(name)
    try {
      const result = await fn()
      return this.store.update(task.id, { status: 'completed', result })
    } catch (error) {
      return this.store.update(task.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Create a task, return the function value, and rethrow so MCP still fails. */
  async track<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const task = this.store.create(name)
    try {
      const result = await fn()
      this.store.update(task.id, { status: 'completed', result })
      return result
    } catch (error) {
      this.store.update(task.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Pure decision for the blocking wait: returns the task when it has reached
   * a terminal state, 'timeout' when the deadline has passed, or 'waiting'.
   * Deterministic and directly testable.
   */
  checkWait(id: string, now: number, deadline: number): Task | 'timeout' | 'waiting' {
    const task = this.store.get(id)
    if (task !== undefined && TERMINAL.has(task.status)) {
      return task
    }
    if (now >= deadline) {
      return 'timeout'
    }
    return 'waiting'
  }

  /**
   * Blocks until the task reaches a terminal state or the timeout elapses
   * (in which case the task is cancelled). The clock and sleep are injected so
   * the timing is deterministic in tests.
   */
  async wait(id: string, options: WaitOptions): Promise<Task> {
    const clock = options.clock ?? defaultClock
    const sleep = options.sleep ?? defaultSleep
    const deadline = clock() + options.timeout
    for (;;) {
      const outcome = this.checkWait(id, clock(), deadline)
      if (outcome === 'timeout') {
        return this.store.cancel(id)
      }
      if (outcome !== 'waiting') {
        return outcome
      }
      await sleep(20)
    }
  }
}
