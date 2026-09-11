import { cockpitHeadline, filterTabs, tabHost } from './cockpit.js'
import type { ActivityEntry, PendingAttach, TabInfo } from './session.js'

type CommandReply = {
  ok: boolean
  error?: string
  result?: unknown
}

type CommandPayload = {
  hostConnected: boolean
  engineConnected: boolean
  reply: CommandReply
}

type CommandMessage = {
  type: 'command'
  request: {
    id: string
    method: string
    params?: Record<string, unknown>
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false
}

function elementById(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (element instanceof HTMLElement === false) {
    throw new Error(`Missing element #${id}`)
  }
  return element
}

function inputById(id: string): HTMLInputElement {
  const element = elementById(id)
  if (element instanceof HTMLInputElement === false) {
    throw new Error(`Missing input #${id}`)
  }
  return element
}

function asCommandPayload(raw: unknown): CommandPayload {
  const record = isRecord(raw) ? raw : {}
  const reply = isRecord(record.reply) ? record.reply : {}
  return {
    hostConnected: record.hostConnected === true,
    engineConnected: record.engineConnected === true,
    reply: {
      ok: reply.ok === true,
      error: typeof reply.error === 'string' ? reply.error : undefined,
      result: reply.result,
    },
  }
}

function command(method: string, params?: Record<string, unknown>): Promise<CommandPayload> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage<CommandMessage, unknown>(
      { type: 'command', request: { id: method, method, params } },
      (raw) => {
        if (chrome.runtime.lastError) {
          resolve({
            hostConnected: false,
            engineConnected: false,
            reply: { ok: false, error: chrome.runtime.lastError.message },
          })
          return
        }
        resolve(asCommandPayload(raw))
      },
    )
  })
}

function asPendingAttach(value: unknown): PendingAttach | undefined {
  if (isRecord(value) === false) {
    return undefined
  }
  return {
    tabId: typeof value.tabId === 'number' ? value.tabId : 0,
    origin: typeof value.origin === 'string' ? value.origin : '',
    url: typeof value.url === 'string' ? value.url : '',
    title: typeof value.title === 'string' ? value.title : '',
  }
}

function asTabs(value: unknown): TabInfo[] {
  if (Array.isArray(value) === false) {
    return []
  }
  const tabs: TabInfo[] = []
  for (const item of value) {
    if (isRecord(item) === false) {
      continue
    }
    tabs.push({
      id: typeof item.id === 'number' ? item.id : 0,
      title: typeof item.title === 'string' ? item.title : '',
      url: typeof item.url === 'string' ? item.url : '',
      active: item.active === true,
    })
  }
  return tabs
}

function asActivity(value: unknown): ActivityEntry[] {
  if (Array.isArray(value) === false) {
    return []
  }
  const entries: ActivityEntry[] = []
  for (const item of value) {
    if (isRecord(item) === false) {
      continue
    }
    entries.push({
      t: typeof item.t === 'number' ? item.t : 0,
      method: typeof item.method === 'string' ? item.method : '',
      ok: item.ok === true,
      detail: typeof item.detail === 'string' ? item.detail : '',
    })
  }
  return entries
}

function setDot(element: HTMLElement, state: string): void {
  element.className = `dot ${state}`
}

let lastPayload: CommandPayload | null = null
let query = ''

function render(payload: CommandPayload): void {
  lastPayload = payload
  const connected = payload.hostConnected
  const engine = payload.engineConnected
  const result = isRecord(payload.reply.result) ? payload.reply.result : {}
  const settings = isRecord(result.settings) ? result.settings : {}
  const pending = asPendingAttach(result.pending)
  const tabs = asTabs(result.tabs)
  const activity = asActivity(result.activity)
  const attached = result.attachedTabId
  const paused = settings.paused === true

  elementById('subtitle').textContent = cockpitHeadline({
    hostConnected: connected,
    engineConnected: engine,
    paused,
    pending: Boolean(pending),
    attachedTabId: typeof attached === 'number' ? attached : undefined,
  })
  elementById('hostText').textContent = connected ? 'native' : 'down'
  setDot(elementById('hostDot'), connected ? 'on' : 'off')
  elementById('engineText').textContent = engine ? 'socket' : connected ? 'waiting' : '—'
  setDot(elementById('engineDot'), engine ? 'on' : connected ? 'warn' : 'off')
  elementById('attachText').textContent = paused
    ? 'paused'
    : attached === undefined
      ? 'none'
      : `tab ${attached}`
  setDot(elementById('attachDot'), paused ? 'warn' : attached === undefined ? 'off' : 'on')
  elementById('policy').textContent = String(settings.attachPolicy ?? '—')
  elementById('resume').hidden = !paused
  elementById('kill').hidden = paused

  if (pending !== undefined) {
    elementById('pendingCard').hidden = false
    elementById('pendingText').textContent = pending.title || pending.url || 'Unknown tab'
    elementById('pendingOrigin').textContent = pending.origin
    elementById('pendingCard').dataset.origin = pending.origin
  } else {
    elementById('pendingCard').hidden = true
    delete elementById('pendingCard').dataset.origin
  }

  const visible = filterTabs(tabs, query)
  elementById('tabCount').textContent = String(visible.length)
  const tabsEl = elementById('tabs')
  tabsEl.replaceChildren()
  if (visible.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = tabs.length === 0 ? 'No tabs in this window.' : 'No tabs match that filter.'
    tabsEl.append(empty)
  }
  for (const tab of visible) {
    const row = document.createElement('div')
    const internal = !/^https?:/.test(tab.url || '')
    row.className = `row${tab.id === attached ? ' active' : ''}${internal ? ' browser' : ''}`
    const meta = document.createElement('div')
    meta.className = 'meta'
    const title = document.createElement('strong')
    title.className = 'tab-title'
    title.textContent = tab.title || '(untitled)'
    const url = document.createElement('div')
    url.className = 'url'
    url.textContent = tabHost(tab.url || '')
    meta.append(title, url)
    const actions = document.createElement('div')
    actions.className = 'row-actions'
    const attach = document.createElement('button')
    attach.className = 'btn tiny primary'
    attach.type = 'button'
    attach.textContent = tab.id === attached ? 'Live' : 'Attach'
    attach.disabled = tab.id === attached || paused
    attach.addEventListener('click', () => {
      void command('attach', { tabId: tab.id }).then(render)
    })
    const focus = document.createElement('button')
    focus.className = 'btn tiny'
    focus.type = 'button'
    focus.textContent = 'Focus'
    focus.addEventListener('click', () => {
      void command('tab_activate', { tabId: tab.id }).then(refresh)
    })
    const close = document.createElement('button')
    close.className = 'btn tiny ghost'
    close.type = 'button'
    close.textContent = '×'
    close.addEventListener('click', () => {
      if (
        settings.confirmDestructive &&
        window.confirm(`Close tab ${tab.title || tab.url}?`) === false
      ) {
        return
      }
      void command('tab_close', { tabId: tab.id }).then(refresh)
    })
    actions.append(attach, focus, close)
    row.append(meta, actions)
    tabsEl.append(row)
  }

  const originsEl = elementById('origins')
  originsEl.replaceChildren()
  const allowed: string[] = []
  if (Array.isArray(settings.allowedOrigins)) {
    for (const origin of settings.allowedOrigins) {
      if (typeof origin === 'string') {
        allowed.push(origin)
      }
    }
  }
  if (allowed.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'None yet. Attach once, or add https://*.'
    originsEl.append(empty)
  }
  for (const origin of allowed) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.append(origin)
    const drop = document.createElement('button')
    drop.type = 'button'
    drop.textContent = '×'
    drop.addEventListener('click', () => {
      void command('settings', {
        op: 'set',
        patch: { allowedOrigins: allowed.filter((item) => item !== origin) },
      }).then(refresh)
    })
    chip.append(drop)
    originsEl.append(chip)
  }

  const activityEl = elementById('activity')
  activityEl.replaceChildren()
  if (activity.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'No commands yet.'
    activityEl.append(empty)
  }
  for (const entry of [...activity].reverse().slice(0, 24)) {
    const line = document.createElement('div')
    const time = document.createElement('span')
    time.textContent = new Date(entry.t).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const method = document.createElement('span')
    method.textContent = entry.method
    const ok = document.createElement('span')
    ok.className = entry.ok ? 'good' : 'bad'
    ok.textContent = entry.ok ? 'ok' : entry.detail || 'err'
    line.append(time, method, ok)
    activityEl.append(line)
  }
}

async function refresh(): Promise<void> {
  render(await command('status'))
}

elementById('kill').addEventListener('click', () => {
  void command('pause', { paused: true })
    .then(() => command('detach'))
    .then(refresh)
})
elementById('resume').addEventListener('click', () => {
  void command('pause', { paused: false }).then(refresh)
})
elementById('detach').addEventListener('click', () => {
  void command('detach').then(refresh)
})
elementById('options').addEventListener('click', () => {
  chrome.runtime.sendMessage<{ type: 'openOptions' }, unknown>({ type: 'openOptions' }, () => {
    void chrome.runtime.lastError
  })
})
elementById('allow').addEventListener('click', () => {
  void command('allow', { origin: elementById('pendingCard').dataset.origin }).then(refresh)
})
elementById('deny').addEventListener('click', () => {
  void command('deny', { origin: elementById('pendingCard').dataset.origin }).then(refresh)
})
elementById('addOrigin').addEventListener('click', async () => {
  const origin = inputById('originInput').value.trim()
  if (origin === '') {
    return
  }
  await command('allow', { origin })
  inputById('originInput').value = ''
  await refresh()
})
inputById('originInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    elementById('addOrigin').click()
  }
})
elementById('newTab').addEventListener('click', async () => {
  const url = inputById('newTabUrl').value.trim()
  await command('tab_create', url === '' ? {} : { url })
  inputById('newTabUrl').value = ''
  await refresh()
})
inputById('newTabUrl').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    elementById('newTab').click()
  }
})
elementById('tabQuery').addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement === false) {
    return
  }
  query = event.target.value
  if (lastPayload) {
    render(lastPayload)
  }
})

const port = chrome.runtime.connect({ name: 'cockpit' })
port.onMessage.addListener((message: unknown) => {
  if (isRecord(message) && message.type === 'changed') {
    void refresh()
  }
})

void refresh()
setInterval(() => {
  void refresh()
}, 2000)
