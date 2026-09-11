import { describe, expect, it } from 'vitest'
import { TaskRunner, defaultClock, defaultSleep } from '../../src/tasks/TaskRunner.js'
import { TaskStore } from '../../src/tasks/TaskStore.js'

describe('TaskRunner', () => {
  it('runs a task function and marks it completed with the result', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    const task = await runner.run('run-flow', async () => ({ ok: true }))
    expect(task.status).toBe('completed')
    expect(task.result).toEqual({ ok: true })
  })

  it('track returns the function result and still records the task', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    const result = await runner.track('run-flow', async () => ({ ok: true, steps: 2 }))
    expect(result).toEqual({ ok: true, steps: 2 })
    expect(store.list()).toEqual([
      expect.objectContaining({ name: 'run-flow', status: 'completed', result }),
    ])
  })

  it('track rethrows and records a failed task', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    await expect(
      runner.track('watch-until', async () => {
        throw new Error('gone')
      }),
    ).rejects.toThrow('gone')
    expect(store.list()).toEqual([
      expect.objectContaining({ name: 'watch-until', status: 'failed', error: 'gone' }),
    ])
  })

  it('track stringifies a non-Error throw', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    await expect(
      runner.track('run-flow', async () => {
        throw 'not-an-error'
      }),
    ).rejects.toBe('not-an-error')
    expect(store.list()[0]?.error).toBe('not-an-error')
  })

  it('marks a task failed when the function throws', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    const task = await runner.run('run-flow', async () => {
      throw new Error('boom')
    })
    expect(task.status).toBe('failed')
    expect(task.error).toBe('boom')
  })

  it('stringifies a non-Error thrown value', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    const task = await runner.run('run-flow', async () => {
      throw 'not-an-error'
    })
    expect(task.status).toBe('failed')
    expect(task.error).toBe('not-an-error')
  })

  it('checkWait returns the task once it reaches a terminal state', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    const task = await runner.run('run-flow', async () => ({ ok: true }))
    const outcome = runner.checkWait(task.id, 0, 1000)
    expect(outcome).toEqual(task)
    expect(task.status).toBe('completed')
  })

  it('checkWait treats a failed task as terminal', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    const task = await runner.run('run-flow', async () => {
      throw new Error('boom')
    })
    expect(task.status).toBe('failed')
    expect(runner.checkWait(task.id, 0, 1000)).toEqual(task)
  })

  it('checkWait treats a cancelled task as terminal', () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    const created = store.create('run-flow')
    const cancelled = store.cancel(created.id)
    expect(cancelled.status).toBe('cancelled')
    expect(runner.checkWait(cancelled.id, 0, 1000)).toEqual(cancelled)
  })

  it('checkWait does not treat input_required as terminal', () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    const created = store.create('run-flow')
    store.update(created.id, { status: 'input_required' })
    expect(runner.checkWait(created.id, 50, 100)).toBe('waiting')
  })

  it('checkWait returns timeout once the deadline passes', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    // A task that stays working; at the deadline it times out.
    const task = store.create('run-flow')
    expect(runner.checkWait(task.id, 100, 100)).toBe('timeout')
  })

  it('checkWait returns waiting before the deadline for a working task', () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    const task = store.create('run-flow')
    expect(runner.checkWait(task.id, 50, 100)).toBe('waiting')
  })

  it('checkWait returns waiting for an unknown id before the deadline', () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    expect(runner.checkWait('missing', 50, 100)).toBe('waiting')
  })

  it('checkWait returns timeout for an unknown id at the deadline', () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    expect(runner.checkWait('missing', 100, 100)).toBe('timeout')
  })

  it('wait() cancels a task that never completes', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    const task = store.create('run-flow')
    // Deadline already passed, so wait() cancels immediately.
    const result = await runner.wait(task.id, {
      timeout: 0,
      clock: () => 100,
      sleep: async () => undefined,
    })
    expect(result.status).toBe('cancelled')
  })

  it('wait() returns a completed task immediately', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    const task = await runner.run('run-flow', async () => ({ ok: true }))
    const result = await runner.wait(task.id, {
      timeout: 1000,
      clock: () => 0,
      sleep: async () => undefined,
    })
    expect(result.status).toBe('completed')
  })

  it('wait() polls via sleep until the task completes', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    const task = store.create('run-flow')
    let polls = 0
    const sleep = async (): Promise<void> => {
      polls += 1
      if (polls >= 2) {
        store.update(task.id, { status: 'completed', result: { ok: true } })
      }
    }
    const result = await runner.wait(task.id, { timeout: 1000, clock: () => 0, sleep })
    expect(result.status).toBe('completed')
    expect(polls).toBe(2)
  })

  it('defaultSleep resolves', async () => {
    await expect(defaultSleep(1)).resolves.toBeUndefined()
  })

  it('defaultClock returns the current epoch time', () => {
    expect(defaultClock()).toBeGreaterThan(0)
  })

  it('wait() uses the default clock and sleep for a completed task', async () => {
    const store = new TaskStore(() => 'task-1')
    const runner = new TaskRunner(store)
    const task = await runner.run('run-flow', async () => ({ ok: true }))
    const result = await runner.wait(task.id, { timeout: 1000 })
    expect(result.status).toBe('completed')
  })
})
