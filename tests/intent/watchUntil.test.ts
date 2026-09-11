import { describe, expect, it } from 'vitest'
import {
  checkWatch,
  defaultClock,
  defaultSleep,
  eventsOf,
  matchesWatch,
  watchUntil,
} from '../../src/intent/watchUntil.js'
import type { SnapshotNode } from '../../src/snapshot/a11ySnapshot.js'
import type { BrowserEvent } from '../../src/events/types.js'

const tree: SnapshotNode = {
  uid: 'root',
  role: 'document',
  name: 'Home',
  children: [{ uid: 'btn-1', role: 'button', name: 'Submit', value: 'go' }],
}

const events: BrowserEvent[] = [{ type: 'console', timestamp: 1, level: 'error', text: 'boom' }]

describe('matchesWatch', () => {
  it('matches text against names and values', () => {
    expect(matchesWatch(tree, [], { kind: 'text', value: 'Submit' })).toBe(true)
    expect(matchesWatch(tree, [], { kind: 'text', value: 'go' })).toBe(true)
    expect(matchesWatch(tree, [], { kind: 'text', value: 'missing' })).toBe(false)
  })

  it('matches a uid', () => {
    expect(matchesWatch(tree, [], { kind: 'uid', value: 'btn-1' })).toBe(true)
    expect(matchesWatch(tree, [], { kind: 'uid', value: 'nope' })).toBe(false)
  })

  it('matches a role', () => {
    expect(matchesWatch(tree, [], { kind: 'role', value: 'button' })).toBe(true)
    expect(matchesWatch(tree, [], { kind: 'role', value: 'link' })).toBe(false)
  })

  it('matches an event type or text', () => {
    expect(matchesWatch(tree, events, { kind: 'event', value: 'console' })).toBe(true)
    expect(matchesWatch(tree, events, { kind: 'event', value: 'boom' })).toBe(true)
    expect(matchesWatch(tree, events, { kind: 'event', value: 'network' })).toBe(false)
    expect(
      matchesWatch(
        tree,
        [
          {
            type: 'resize',
            timestamp: 1,
            width: 1600,
            height: 900,
            viewportWidth: 1580,
            viewportHeight: 840,
          },
        ],
        { kind: 'event', value: 'resize' },
      ),
    ).toBe(true)
  })

  it('matches a network url and a dom target', () => {
    const mixed: BrowserEvent[] = [
      {
        type: 'network',
        timestamp: 1,
        url: 'https://api.example.com/pay',
        status: 500,
        failed: true,
      },
      { type: 'dom', timestamp: 2, kind: 'added', target: 'btn-1' },
    ]
    expect(matchesWatch(tree, mixed, { kind: 'event', value: 'api.example.com' })).toBe(true)
    expect(matchesWatch(tree, mixed, { kind: 'event', value: 'btn-1' })).toBe(true)
    expect(matchesWatch(tree, mixed, { kind: 'event', value: 'gone' })).toBe(false)
  })

  it('matches a substring of a name', () => {
    expect(matchesWatch(tree, [], { kind: 'text', value: 'Sub' })).toBe(true)
  })

  it('does not match text on a tree with no values and a different name', () => {
    expect(
      matchesWatch({ uid: 'x', role: 'generic', name: 'Other' }, [], {
        kind: 'text',
        value: 'Submit',
      }),
    ).toBe(false)
  })
})

describe('eventsOf', () => {
  it('returns an empty list when the view has no events', () => {
    expect(eventsOf({ snapshot: tree })).toEqual([])
    expect(eventsOf({ snapshot: tree })).not.toEqual(['Stryker was here'])
  })

  it('copies the events so the caller cannot mutate the view', () => {
    const events: BrowserEvent[] = [{ type: 'console', timestamp: 1, level: 'log', text: 'a' }]
    const copied = eventsOf({ snapshot: tree, events })
    expect(copied).toEqual(events)
    expect(copied).not.toBe(events)
    events.pop()
    expect(copied).toHaveLength(1)
  })
})

describe('checkWatch', () => {
  it('returns matched when the condition already holds', () => {
    expect(checkWatch(true, 0, 100)).toBe('matched')
  })

  it('returns timeout once the deadline passes', () => {
    expect(checkWatch(false, 100, 100)).toBe('timeout')
  })

  it('returns waiting before the deadline', () => {
    expect(checkWatch(false, 50, 100)).toBe('waiting')
  })
})

describe('watchUntil', () => {
  it('returns matched when the first observe satisfies the condition', async () => {
    const result = await watchUntil(
      async () => ({ snapshot: tree }),
      { kind: 'uid', value: 'btn-1' },
      { timeout: 1000, clock: () => 0, sleep: async () => undefined },
    )
    expect(result).toEqual({ matched: true, reason: 'condition met' })
  })

  it('polls until the condition becomes true', async () => {
    let n = 0
    const result = await watchUntil(
      async () => {
        n += 1
        return { snapshot: n >= 2 ? tree : { uid: 'empty', role: 'generic', name: '' } }
      },
      { kind: 'uid', value: 'btn-1' },
      { timeout: 1000, clock: () => 0, sleep: async () => undefined },
    )
    expect(result.matched).toBe(true)
    expect(n).toBe(2)
  })

  it('times out when the condition never matches', async () => {
    const result = await watchUntil(
      async () => ({ snapshot: { uid: 'empty', role: 'generic', name: '' } }),
      { kind: 'uid', value: 'btn-1' },
      { timeout: 0, clock: () => 100, sleep: async () => undefined },
    )
    expect(result).toEqual({ matched: false, reason: 'timeout' })
  })

  it('uses the default clock and sleep when the first observe matches', async () => {
    const result = await watchUntil(
      async () => ({ snapshot: tree }),
      { kind: 'role', value: 'button' },
      { timeout: 1000 },
    )
    expect(result.matched).toBe(true)
  })

  it('passes the poll interval to sleep', async () => {
    let slept = 0
    let n = 0
    await watchUntil(
      async () => {
        n += 1
        return { snapshot: n >= 2 ? tree : { uid: 'empty', role: 'generic', name: '' } }
      },
      { kind: 'uid', value: 'btn-1' },
      {
        timeout: 1000,
        clock: () => 0,
        poll: 7,
        sleep: async (ms) => {
          slept = ms
        },
      },
    )
    expect(slept).toBe(7)
  })

  it('matches an event from the same observe view', async () => {
    const result = await watchUntil(
      async () => ({
        snapshot: { uid: 'empty', role: 'generic', name: '' },
        events: [{ type: 'console', timestamp: 1, level: 'log', text: 'boom' }],
      }),
      { kind: 'event', value: 'boom' },
      { timeout: 0, clock: () => 0, sleep: async () => undefined },
    )
    expect(result).toEqual({ matched: true, reason: 'condition met' })
  })

  it('defaultSleep resolves', async () => {
    await expect(defaultSleep(1)).resolves.toBeUndefined()
  })

  it('defaultClock returns the current epoch time', () => {
    expect(defaultClock()).toBeGreaterThan(0)
  })
})
