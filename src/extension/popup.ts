import { cockpitHeadline, type CockpitFlags } from './cockpit.js'

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

type OpenPanelMessage = {
  type: 'openPanel'
}

type OpenOptionsMessage = {
  type: 'openOptions'
}

type DotTone = 'on' | 'warn' | 'off' | 'idle'

type PillTone = 'ok' | 'warn' | 'danger'

type StateSummary = {
  label: string
  tone: PillTone
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

function setDotTone(id: string, tone: DotTone): void {
  const dot = elementById(id)
  dot.classList.toggle('on', tone === 'on')
  dot.classList.toggle('warn', tone === 'warn')
  dot.classList.toggle('off', tone === 'off')
  dot.classList.toggle('idle', tone === 'idle')
}

function setPillTone(id: string, tone: PillTone): void {
  const pill = elementById(id)
  pill.classList.toggle('ok', tone === 'ok')
  pill.classList.toggle('warn', tone === 'warn')
  pill.classList.toggle('danger', tone === 'danger')
}

function dotFor(tone: PillTone): DotTone {
  if (tone === 'ok') {
    return 'on'
  }
  if (tone === 'warn') {
    return 'warn'
  }
  return 'off'
}

function summarize(flags: CockpitFlags): StateSummary {
  if (flags.hostConnected === false) {
    return { label: 'Offline', tone: 'danger' }
  }
  if (flags.paused) {
    return { label: 'Paused', tone: 'warn' }
  }
  if (flags.pending) {
    return { label: 'Waiting for allow', tone: 'warn' }
  }
  if (flags.attachedTabId !== undefined) {
    return { label: 'Controlling', tone: 'ok' }
  }
  return { label: 'Ready', tone: 'ok' }
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

let attached = false

async function refresh(): Promise<void> {
  const payload = await command('status')
  const result = isRecord(payload.reply.result) ? payload.reply.result : {}
  const settings = isRecord(result.settings) ? result.settings : {}
  const paused = settings.paused === true
  const attachedTabId = typeof result.attachedTabId === 'number' ? result.attachedTabId : undefined
  const flags: CockpitFlags = {
    hostConnected: payload.hostConnected,
    engineConnected: payload.engineConnected,
    paused,
    pending: Boolean(result.pending),
    attachedTabId,
  }

  attached = attachedTabId !== undefined
  elementById('line').textContent = cockpitHeadline(flags)
  elementById('host').textContent = flags.hostConnected ? 'up' : 'down'
  elementById('engine').textContent = flags.engineConnected ? 'live' : 'waiting'
  elementById('attach').textContent = paused
    ? 'paused'
    : attachedTabId === undefined
      ? 'none'
      : `tab ${attachedTabId}`
  setDotTone('hostDot', flags.hostConnected ? 'on' : 'off')
  setDotTone('engineDot', flags.engineConnected ? 'on' : 'warn')
  setDotTone('attachDot', paused ? 'warn' : attachedTabId === undefined ? 'idle' : 'on')

  const summary = summarize(flags)
  elementById('stateText').textContent = summary.label
  setPillTone('statePill', summary.tone)
  setDotTone('stateDot', dotFor(summary.tone))

  elementById('open').textContent = attached ? 'Open cockpit' : 'Control this tab'
  elementById('resume').hidden = !paused
  elementById('kill').hidden = paused
  elementById('kill').setAttribute('aria-pressed', String(paused))
  elementById('resume').setAttribute('aria-pressed', String(paused))
}

function openCockpit(): void {
  chrome.runtime.sendMessage<OpenPanelMessage, unknown>({ type: 'openPanel' }, () => {
    void chrome.runtime.lastError
    window.close()
  })
}

elementById('open').addEventListener('click', () => {
  if (attached) {
    openCockpit()
    return
  }
  void command('attach').then((payload) => {
    if (payload.reply.ok) {
      openCockpit()
      return
    }
    elementById('line').textContent = payload.reply.error ?? 'Attach failed'
  })
})
elementById('kill').addEventListener('click', () => {
  void command('pause', { paused: true })
    .then(() => command('detach'))
    .then(refresh)
})
elementById('resume').addEventListener('click', () => {
  void command('pause', { paused: false }).then(refresh)
})
elementById('options').addEventListener('click', () => {
  chrome.runtime.sendMessage<OpenOptionsMessage, unknown>({ type: 'openOptions' }, () => {
    void chrome.runtime.lastError
  })
})

void refresh()
