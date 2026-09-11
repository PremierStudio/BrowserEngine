import { describe, expect, it } from 'vitest'
import { createBrowserDesk } from '../../src/browser/browserDesk.js'
import { emptyRegistry, serializeRegistry } from '../../src/browser/instanceRegistry.js'
import { createManagedDesk, type ChromeSession } from '../../src/browser/managedDesk.js'
import type { TabHost } from '../../src/browser/tabDesk.js'

function memoryStore() {
  let text = serializeRegistry(emptyRegistry())
  return {
    read: () => text,
    write: (next: string) => {
      text = next
    },
  }
}

function fakeSession(pid: number, startUrl: string): ChromeSession & { closed: boolean } {
  const pages: { id: string; url: string; title: string }[] = [
    { id: 'tab-1', url: startUrl, title: 'Home' },
  ]
  let currentId: string | undefined = 'tab-1'
  let next = 1
  const host: TabHost = {
    list: async () => pages.map((page) => ({ ...page })),
    create: async (url) => {
      next += 1
      const page = {
        id: `tab-${String(next)}`,
        url: url ?? 'about:blank',
        title: url === undefined ? 'New Tab' : 'Opened',
      }
      pages.push(page)
      return page
    },
    close: async (id) => {
      const index = pages.findIndex((page) => page.id === id)
      if (index >= 0) {
        pages.splice(index, 1)
      }
    },
    activate: async (id) => {
      currentId = id
    },
    currentId: () => currentId,
    setCurrentId: (id) => {
      currentId = id
    },
  }
  const session: ChromeSession & { closed: boolean } = {
    pid,
    closed: false,
    host,
    close: async () => {
      session.closed = true
    },
  }
  return session
}

describe('createManagedDesk', () => {
  it('does not launch Chrome for status', async () => {
    let launches = 0
    const desk = createBrowserDesk({
      id: 'mine',
      mcpPid: 10,
      clock: () => 1000,
      isAlive: (pid) => pid === 10,
      store: memoryStore(),
    })
    const managed = createManagedDesk({
      desk,
      headed: true,
      launch: async () => {
        launches += 1
        return fakeSession(20, 'about:blank')
      },
      kill: () => undefined,
    })
    const snap = await managed.status()
    expect(launches).toBe(0)
    expect(snap.open).toBe(false)
    expect(snap.closed).toEqual([])
  })

  it('opens once, lists live tabs, and is a no-op when already open', async () => {
    let launches = 0
    const desk = createBrowserDesk({
      id: 'mine',
      mcpPid: 10,
      clock: () => 1000,
      isAlive: (pid) => pid === 10 || pid === 20,
      store: memoryStore(),
    })
    const managed = createManagedDesk({
      desk,
      headed: true,
      launch: async () => {
        launches += 1
        return fakeSession(20, 'https://home.example')
      },
      kill: () => undefined,
    })
    const opened = await managed.open()
    expect(launches).toBe(1)
    expect(opened.open).toBe(true)
    expect(opened.mine?.tabs).toEqual([
      { id: 'tab-1', url: 'https://home.example', title: 'Home', active: true },
    ])
    await managed.open()
    expect(launches).toBe(1)
  })

  it('opens a new tab on demand, then switches and closes it', async () => {
    const desk = createBrowserDesk({
      id: 'mine',
      mcpPid: 10,
      clock: () => 1000,
      isAlive: (pid) => pid === 10 || pid === 20,
      store: memoryStore(),
    })
    const managed = createManagedDesk({
      desk,
      headed: true,
      launch: async () => fakeSession(20, 'https://home.example'),
      kill: () => undefined,
    })
    const created = await managed.newTab('https://shop.example')
    expect(created.mine?.tabs).toEqual([
      { id: 'tab-1', url: 'https://home.example', title: 'Home', active: false },
      { id: 'tab-2', url: 'https://shop.example', title: 'Opened', active: true },
    ])
    const switched = await managed.switchTab('tab-1')
    expect(switched.mine?.tabs.find((tab) => tab.active)?.id).toBe('tab-1')
    const afterClose = await managed.closeTab('tab-2')
    expect(afterClose.mine?.tabs).toEqual([
      { id: 'tab-1', url: 'https://home.example', title: 'Home', active: true },
    ])
  })

  it('refuses tab close and switch when Chrome is not open', async () => {
    const desk = createBrowserDesk({
      id: 'mine',
      mcpPid: 10,
      clock: () => 1000,
      isAlive: (pid) => pid === 10,
      store: memoryStore(),
    })
    const managed = createManagedDesk({
      desk,
      headed: true,
      launch: async () => fakeSession(20, 'about:blank'),
      kill: () => undefined,
    })
    await expect(managed.closeTab('tab-1')).rejects.toThrow(/not open/)
    await expect(managed.switchTab('tab-1')).rejects.toThrow(/not open/)
  })

  it('closes when Chrome was never opened', async () => {
    const desk = createBrowserDesk({
      id: 'mine',
      mcpPid: 10,
      clock: () => 1000,
      isAlive: (pid) => pid === 10,
      store: memoryStore(),
    })
    const managed = createManagedDesk({
      desk,
      headed: true,
      launch: async () => fakeSession(20, 'about:blank'),
      kill: () => undefined,
    })
    const closed = await managed.close()
    expect(closed.open).toBe(false)
  })

  it('closes Chrome and keeps last tabs on the closed row', async () => {
    const session = fakeSession(20, 'https://home.example')
    const desk = createBrowserDesk({
      id: 'mine',
      mcpPid: 10,
      clock: () => 1000,
      isAlive: (pid) => pid === 10 || pid === 20,
      store: memoryStore(),
    })
    const managed = createManagedDesk({
      desk,
      headed: true,
      launch: async () => session,
      kill: () => undefined,
    })
    await managed.open()
    const closed = await managed.close()
    expect(session.closed).toBe(true)
    expect(closed.open).toBe(false)
    expect(closed.closed[0]?.tabs).toEqual([
      { id: 'tab-1', url: 'https://home.example', title: 'Home', active: true },
    ])
  })

  it('reaps leftover Chrome from a dead agent and marks it closed', async () => {
    const store = memoryStore()
    const ghost = createBrowserDesk({
      id: 'ghost',
      mcpPid: 12,
      clock: () => 1000,
      isAlive: () => true,
      store,
    })
    ghost.markOpen(22, true, [
      { id: 'g1', url: 'https://ghost.example', title: 'Ghost', active: true },
    ])
    const killed: number[] = []
    const mine = createBrowserDesk({
      id: 'mine',
      mcpPid: 10,
      clock: () => 2000,
      isAlive: (pid) => pid === 10,
      store,
    })
    const managed = createManagedDesk({
      desk: mine,
      headed: true,
      launch: async () => fakeSession(20, 'about:blank'),
      kill: (pid) => {
        killed.push(pid)
      },
    })
    const before = await managed.status()
    expect(before.orphans.map((row) => row.id)).toEqual(['ghost'])
    const after = await managed.reap()
    expect(killed).toEqual([22])
    expect(after.orphans).toEqual([])
    expect(after.closed.map((row) => row.id)).toEqual(['ghost'])
    expect(after.closed[0]?.tabs[0]?.url).toBe('https://ghost.example')
  })

  it('marks closed even when Chrome close itself throws', async () => {
    const session = fakeSession(20, 'https://home.example')
    session.close = async () => {
      session.closed = true
      throw new Error('already gone')
    }
    const desk = createBrowserDesk({
      id: 'mine',
      mcpPid: 10,
      clock: () => 1000,
      isAlive: (pid) => pid === 10 || pid === 20,
      store: memoryStore(),
    })
    const managed = createManagedDesk({
      desk,
      headed: true,
      launch: async () => session,
      kill: () => undefined,
    })
    await managed.open()
    const closed = await managed.close()
    expect(session.closed).toBe(true)
    expect(closed.open).toBe(false)
  })

  it('marks an orphan closed even when it has no Chrome pid', async () => {
    const store = memoryStore()
    const ghost = createBrowserDesk({
      id: 'ghost',
      mcpPid: 12,
      clock: () => 1000,
      isAlive: () => true,
      store,
    })
    ghost.markOpen(undefined, true, [])
    const killed: number[] = []
    const mine = createBrowserDesk({
      id: 'mine',
      mcpPid: 10,
      clock: () => 2000,
      isAlive: (pid) => pid === 10,
      store,
    })
    const managed = createManagedDesk({
      desk: mine,
      headed: true,
      launch: async () => fakeSession(20, 'about:blank'),
      kill: (pid) => {
        killed.push(pid)
      },
    })
    const after = await managed.reap()
    expect(killed).toEqual([])
    expect(after.closed.map((row) => row.id)).toEqual(['ghost'])
  })

  it('does not kill when an attached session has no Chrome pid', async () => {
    const killed: number[] = []
    const session = fakeSession(0, 'https://brave.example')
    const attached: ChromeSession = {
      pid: undefined,
      host: session.host,
      close: session.close,
    }
    const desk = createBrowserDesk({
      id: 'mine',
      mcpPid: 10,
      clock: () => 1000,
      isAlive: (pid) => pid === 10,
      store: memoryStore(),
    })
    const managed = createManagedDesk({
      desk,
      headed: true,
      launch: async () => attached,
      kill: (pid) => {
        killed.push(pid)
      },
    })
    await managed.open()
    const closed = await managed.close()
    expect(session.closed).toBe(true)
    expect(killed).toEqual([])
    expect(closed.open).toBe(false)
  })
})
