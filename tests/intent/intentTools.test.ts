import { describe, expect, it } from 'vitest'
import { buildIntentTools, diffExplainTarget } from '../../src/intent/intentTools.js'
import { TaskRunner } from '../../src/tasks/TaskRunner.js'
import { TaskStore } from '../../src/tasks/TaskStore.js'
import type { ContextPage } from '../../src/context/ContextPage.js'
import type { SnapshotNode } from '../../src/snapshot/a11ySnapshot.js'

const tree: SnapshotNode = {
  uid: 'root',
  role: 'document',
  name: 'Home',
  children: [{ uid: 'btn-1', role: 'button', name: 'Submit', value: 'go' }],
}

function recordPage(): ContextPage {
  return {
    getElementByUid: async () => undefined,
    waitForEventsAfterAction: async () => undefined,
    observe: async () => ({
      snapshot: tree,
      image: '',
      overlay: {},
      pageState: { url: '', title: '' },
    }),
    emulate: async () => undefined,
    getDialog: async () => null,
    click: async () => undefined,
    type: async () => undefined,
    hover: async () => undefined,
    scroll: async () => undefined,
    select: async () => undefined,
    press: async () => undefined,
    navigate: async () => undefined,
  }
}

function handlerFor(name: string) {
  return buildIntentTools().find((tool) => tool.name === name)?.handler
}

describe('diffExplainTarget', () => {
  it('pins kind to the diff discriminant', () => {
    const diff = { added: [{ uid: 'a' }], removed: [], changed: [] }
    expect(diffExplainTarget(diff)).toEqual({ kind: 'diff', diff })
  })
})

describe('buildIntentTools', () => {
  it('returns watch_until, compile_flow, run_flow, verify, and explain in order', () => {
    expect(buildIntentTools().map((tool) => tool.name)).toEqual([
      'watch_until',
      'compile_flow',
      'run_flow',
      'verify',
      'explain',
    ])
  })

  it('advertises exact descriptions, readOnly flags, and input schemas', () => {
    const tools = Object.fromEntries(buildIntentTools().map((tool) => [tool.name, tool]))
    expect(tools.watch_until?.description).toBe(
      'Poll the page until a condition matches or the timeout elapses.',
    )
    expect(tools.run_flow?.description).toMatch(/name/i)
    expect(tools.run_flow?.description).toMatch(/re-resolves/i)
    expect(tools.verify?.description).toBe(
      'Assert a condition against the current snapshot and return evidence.',
    )
    expect(tools.explain?.description).toBe(
      'Explain a uid, region, or diff with a summary and annotation.',
    )
    expect(tools.watch_until?.readOnly).toBe(false)
    expect(tools.compile_flow?.readOnly).toBe(true)
    expect(tools.compile_flow?.description).toMatch(/unique/i)
    expect(tools.compile_flow?.inputSchema.safeParse({ steps: [] }).success).toBe(true)
    expect(
      tools.compile_flow?.inputSchema.safeParse({
        steps: [{ action: 'click', name: 'Login' }],
        requireExpect: false,
      }).success,
    ).toBe(true)
    expect(tools.compile_flow?.inputSchema.safeParse({}).success).toBe(false)
    expect(tools.run_flow?.readOnly).toBe(false)
    expect(tools.verify?.readOnly).toBe(true)
    expect(tools.explain?.readOnly).toBe(true)
    expect(
      tools.watch_until?.inputSchema.safeParse({ kind: 'text', value: 'x', timeout: 1 }).success,
    ).toBe(true)
    expect(
      tools.watch_until?.inputSchema.safeParse({ kind: 'uid', value: 'x', timeout: 1 }).success,
    ).toBe(true)
    expect(
      tools.watch_until?.inputSchema.safeParse({ kind: 'role', value: 'x', timeout: 1 }).success,
    ).toBe(true)
    expect(
      tools.watch_until?.inputSchema.safeParse({ kind: 'event', value: 'x', timeout: 1 }).success,
    ).toBe(true)
    expect(
      tools.watch_until?.inputSchema.safeParse({ kind: 'nope', value: 'x', timeout: 1 }).success,
    ).toBe(false)
    expect(tools.watch_until?.inputSchema.safeParse({ kind: 'uid', value: 'x' }).success).toBe(
      false,
    )
    expect(tools.verify?.inputSchema.safeParse({ kind: 'uidExists' }).success).toBe(true)
    expect(tools.verify?.inputSchema.safeParse({ kind: 'role' }).success).toBe(true)
    expect(tools.verify?.inputSchema.safeParse({ kind: 'name' }).success).toBe(true)
    expect(tools.verify?.inputSchema.safeParse({ kind: 'value' }).success).toBe(true)
    expect(tools.verify?.inputSchema.safeParse({ kind: 'textContains' }).success).toBe(true)
    expect(tools.verify?.inputSchema.safeParse({ kind: 'nope' }).success).toBe(false)
    expect(tools.explain?.inputSchema.safeParse({ kind: 'uid' }).success).toBe(true)
    expect(tools.explain?.inputSchema.safeParse({ kind: 'region' }).success).toBe(true)
    expect(tools.explain?.inputSchema.safeParse({ kind: 'diff' }).success).toBe(true)
    expect(tools.explain?.inputSchema.safeParse({ kind: 'nope' }).success).toBe(false)
    expect(tools.run_flow?.inputSchema.safeParse({ steps: [] }).success).toBe(true)
    expect(tools.run_flow?.inputSchema.safeParse({}).success).toBe(false)
    expect(
      tools.run_flow?.inputSchema.safeParse({ steps: [{ action: 'click', uid: '1' }] }).success,
    ).toBe(true)
    expect(
      tools.run_flow?.inputSchema.safeParse({
        steps: [{ action: 'click', name: 'Login', near: 'Password', role: 'button' }],
      }).success,
    ).toBe(true)
    expect(
      tools.run_flow?.inputSchema.safeParse({
        steps: [{ action: 'check', expectUrl: '/secure', expectText: 'Logout' }],
      }).success,
    ).toBe(true)
    expect(tools.run_flow?.description).toMatch(/uniquely/i)
    expect(tools.run_flow?.description).toMatch(/expectUrl/i)
    expect(tools.run_flow?.inputSchema.safeParse({ steps: [{ action: 1 }] }).success).toBe(false)
    expect(tools.run_flow?.inputSchema.safeParse({ steps: [{}] }).success).toBe(false)
  })

  it('watch_until kind event matches events from the last observe', async () => {
    const page = recordPage()
    page.observe = async () => ({
      snapshot: tree,
      image: '',
      overlay: {},
      pageState: { url: '', title: '' },
      events: [{ type: 'console', timestamp: 1, level: 'log', text: 'boom' }],
    })
    const matched = await handlerFor('watch_until')?.(
      { kind: 'event', value: 'boom', timeout: 0 },
      { experimental: false, page },
    )
    expect(matched).toEqual({ matched: true, reason: 'condition met' })
    const quiet = recordPage()
    const missed = await handlerFor('watch_until')?.(
      { kind: 'event', value: 'boom', timeout: 0 },
      { experimental: false, page: quiet },
    )
    expect(missed).toEqual({ matched: false, reason: 'timeout' })
  })

  it('watch_until matches a uid on the current page', async () => {
    const result = await handlerFor('watch_until')?.(
      { kind: 'uid', value: 'btn-1', timeout: 1000 },
      { experimental: false, page: recordPage() },
    )
    expect(result).toEqual({ matched: true, reason: 'condition met' })
  })

  it('compile_flow binds unique names on the live outline', async () => {
    const result = await handlerFor('compile_flow')?.(
      { steps: [{ action: 'click', name: 'Submit', expectUrl: '/' }] },
      { experimental: false, page: recordPage() },
    )
    expect(result).toEqual({
      ok: true,
      bound: 1,
      steps: [{ action: 'click', name: 'Submit', expectUrl: '/', uid: 'btn-1' }],
    })
  })

  it('compile_flow requires expects on click unless requireExpect is false', async () => {
    const ctx = { experimental: false, page: recordPage() }
    const refused = await handlerFor('compile_flow')?.(
      { steps: [{ action: 'click', name: 'Submit' }] },
      ctx,
    )
    expect(refused).toEqual({
      ok: false,
      error: 'action click requires expectUrl or expectText',
      index: 0,
    })
    const allowed = await handlerFor('compile_flow')?.(
      { steps: [{ action: 'click', name: 'Submit' }], requireExpect: false },
      ctx,
    )
    expect(allowed).toMatchObject({ ok: true, bound: 1 })
  })

  it('records run_flow on the task runner and still returns the result', async () => {
    const previous = process.env.BROWSER_ENGINE_PACE_MS
    process.env.BROWSER_ENGINE_PACE_MS = '0'
    try {
      const store = new TaskStore(() => 'task-1')
      const runner = new TaskRunner(store)
      const run = buildIntentTools({ runner }).find((tool) => tool.name === 'run_flow')?.handler
      const result = await run?.(
        { steps: [{ action: 'click', uid: 'btn-1' }] },
        { experimental: false, page: recordPage() },
      )
      expect(result).toEqual({ ok: true, steps: 1 })
      expect(store.list()).toEqual([
        expect.objectContaining({ name: 'run_flow', status: 'completed', result }),
      ])
    } finally {
      if (previous === undefined) {
        delete process.env.BROWSER_ENGINE_PACE_MS
      } else {
        process.env.BROWSER_ENGINE_PACE_MS = previous
      }
    }
  })

  it('records watch_until and a failed run_flow', async () => {
    const previousHeaded = process.env.BROWSER_ENGINE_HEADED
    const previousExpect = process.env.BROWSER_ENGINE_EXPECT_MS
    process.env.BROWSER_ENGINE_HEADED = '0'
    process.env.BROWSER_ENGINE_EXPECT_MS = '0'
    try {
      let next = 0
      const store = new TaskStore(() => {
        next += 1
        return `task-${String(next)}`
      })
      const runner = new TaskRunner(store)
      const tools = Object.fromEntries(
        buildIntentTools({ runner }).map((tool) => [tool.name, tool]),
      )
      const watched = await tools.watch_until?.handler(
        { kind: 'uid', value: 'missing', timeout: 0 },
        { experimental: false, page: recordPage() },
      )
      expect(watched).toEqual({ matched: false, reason: 'timeout' })
      await expect(
        tools.run_flow?.handler(
          { steps: [{ action: 'explode' }] },
          { experimental: false, page: recordPage() },
        ),
      ).rejects.toThrow(/unknown action/)
      expect(store.list().map((task) => [task.name, task.status])).toEqual([
        ['watch_until', 'completed'],
        ['run_flow', 'failed'],
      ])
    } finally {
      if (previousHeaded === undefined) {
        delete process.env.BROWSER_ENGINE_HEADED
      } else {
        process.env.BROWSER_ENGINE_HEADED = previousHeaded
      }
      if (previousExpect === undefined) {
        delete process.env.BROWSER_ENGINE_EXPECT_MS
      } else {
        process.env.BROWSER_ENGINE_EXPECT_MS = previousExpect
      }
    }
  })

  it('run_flow executes steps on the page', async () => {
    const previous = process.env.BROWSER_ENGINE_PACE_MS
    process.env.BROWSER_ENGINE_PACE_MS = '0'
    try {
      const result = await handlerFor('run_flow')?.(
        { steps: [{ action: 'click', uid: 'btn-1' }] },
        { experimental: false, page: recordPage() },
      )
      expect(result).toEqual({ ok: true, steps: 1 })
    } finally {
      if (previous === undefined) {
        delete process.env.BROWSER_ENGINE_PACE_MS
      } else {
        process.env.BROWSER_ENGINE_PACE_MS = previous
      }
    }
  })

  it('verify asserts against the current snapshot', async () => {
    const result = await handlerFor('verify')?.(
      { kind: 'uidExists', uid: 'btn-1' },
      { experimental: false, page: recordPage() },
    )
    expect(result).toMatchObject({ pass: true })
  })

  it('explain describes a uid on the current snapshot', async () => {
    const result = await handlerFor('explain')?.(
      { kind: 'uid', uid: 'btn-1' },
      { experimental: false, page: recordPage() },
    )
    expect(result).toMatchObject({ annotation: { highlight: 'ring' } })
  })

  it('throws when a page is missing', async () => {
    await expect(
      handlerFor('verify')?.({ kind: 'uidExists', uid: 'x' }, { experimental: false }),
    ).rejects.toThrow(/requires a page/i)
  })

  it('throws when the page is not a ContextPage', async () => {
    await expect(
      handlerFor('verify')?.(
        { kind: 'uidExists', uid: 'x' },
        { experimental: false, page: { notAPage: true } },
      ),
    ).rejects.toThrow(/requires a page/i)
    await expect(
      handlerFor('watch_until')?.(
        { kind: 'uid', value: 'x', timeout: 1 },
        { experimental: false, page: null },
      ),
    ).rejects.toThrow(/requires a page/i)
    await expect(
      handlerFor('run_flow')?.({ steps: [] }, { experimental: false, page: { observe: 'nope' } }),
    ).rejects.toThrow(/requires a page/i)
    await expect(
      handlerFor('compile_flow')?.(
        { steps: [] },
        { experimental: false, page: { observe: 'nope' } },
      ),
    ).rejects.toThrow(/requires a page/i)
  })

  it('explain describes a diff target', async () => {
    const result = await handlerFor('explain')?.(
      {
        kind: 'diff',
        diff: { added: [{ uid: 'a' }], removed: [], changed: [] },
      },
      { experimental: false, page: recordPage() },
    )
    expect(result).toMatchObject({ annotation: { highlight: 'diff' } })
  })

  it('explain throws when a diff target has no diff', async () => {
    await expect(
      handlerFor('explain')?.({ kind: 'diff' }, { experimental: false, page: recordPage() }),
    ).rejects.toThrow(/invalid args/i)
  })

  it('throws on invalid args', async () => {
    const page = recordPage()
    const ctx = { experimental: false, page }
    const invalid = [null, undefined, 1, 'x', true, [], {}, { kind: 'uid' }, { value: 'x' }]
    for (const args of invalid) {
      await expect(handlerFor('watch_until')?.(args, ctx)).rejects.toThrow(/invalid args/i)
    }
    await expect(handlerFor('watch_until')?.({ kind: 'uid', value: 'x' }, ctx)).rejects.toThrow(
      /invalid args/i,
    )
    await expect(handlerFor('run_flow')?.({}, ctx)).rejects.toThrow(/invalid args/i)
    await expect(handlerFor('run_flow')?.({ steps: 'nope' }, ctx)).rejects.toThrow(/invalid args/i)
    await expect(handlerFor('run_flow')?.(null, ctx)).rejects.toThrow(/invalid args/i)
    await expect(handlerFor('run_flow')?.(1, ctx)).rejects.toThrow(/invalid args/i)
    await expect(handlerFor('compile_flow')?.({}, ctx)).rejects.toThrow(/invalid args/i)
    await expect(handlerFor('compile_flow')?.({ steps: 'nope' }, ctx)).rejects.toThrow(
      /invalid args/i,
    )
    await expect(handlerFor('compile_flow')?.(null, ctx)).rejects.toThrow(/invalid args/i)
    await expect(
      handlerFor('compile_flow')?.({ steps: [], requireExpect: 'yes' }, ctx),
    ).rejects.toThrow(/invalid args/i)
    await expect(handlerFor('verify')?.({}, ctx)).rejects.toThrow(/invalid args/i)
    await expect(handlerFor('verify')?.(null, ctx)).rejects.toThrow(/invalid args/i)
    await expect(handlerFor('verify')?.(1, ctx)).rejects.toThrow(/invalid args/i)
    await expect(handlerFor('explain')?.({}, ctx)).rejects.toThrow(/invalid args/i)
    await expect(handlerFor('explain')?.(null, ctx)).rejects.toThrow(/invalid args/i)
    await expect(handlerFor('explain')?.(1, ctx)).rejects.toThrow(/invalid args/i)
    await expect(handlerFor('explain')?.({ kind: 'diff', diff: null }, ctx)).rejects.toThrow(
      /invalid args/i,
    )
    await expect(
      handlerFor('explain')?.({ kind: 'diff', diff: { added: [] } }, ctx),
    ).rejects.toThrow(/invalid args/i)
    await expect(
      handlerFor('explain')?.({ kind: 'diff', diff: { added: [], changed: [] } }, ctx),
    ).rejects.toThrow(/invalid args/i)
    await expect(
      handlerFor('explain')?.({ kind: 'diff', diff: { removed: [], changed: [] } }, ctx),
    ).rejects.toThrow(/invalid args/i)
    await expect(
      handlerFor('explain')?.({ kind: 'diff', diff: { added: [], removed: [] } }, ctx),
    ).rejects.toThrow(/invalid args/i)
  })

  it('watch_until times out when the condition never matches', async () => {
    const result = await handlerFor('watch_until')?.(
      { kind: 'uid', value: 'missing', timeout: 0 },
      { experimental: false, page: recordPage() },
    )
    expect(result).toEqual({ matched: false, reason: 'timeout' })
  })

  it('watch_until event kind does not match when the page has no events', async () => {
    const result = await handlerFor('watch_until')?.(
      { kind: 'event', value: 'console', timeout: 0 },
      { experimental: false, page: recordPage() },
    )
    expect(result).toEqual({ matched: false, reason: 'timeout' })
  })

  it('rejects every non-page value', async () => {
    const args = { kind: 'uidExists', uid: 'x' }
    for (const page of [null, 1, 'x', true, {}, { observe: 1 }, { click: () => undefined }]) {
      await expect(handlerFor('verify')?.(args, { experimental: false, page })).rejects.toThrow(
        /requires a page/i,
      )
    }
  })
})
