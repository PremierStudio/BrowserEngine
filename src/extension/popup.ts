import { cockpitHeadline } from './cockpit.js'

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

async function refresh(): Promise<void> {
  const payload = await command('status')
  const result = isRecord(payload.reply.result) ? payload.reply.result : {}
  const settings = isRecord(result.settings) ? result.settings : {}
  const paused = settings.paused === true
  const attached = result.attachedTabId
  elementById('line').textContent = cockpitHeadline({
    hostConnected: payload.hostConnected,
    engineConnected: payload.engineConnected,
    paused,
    pending: Boolean(result.pending),
    attachedTabId: typeof attached === 'number' ? attached : undefined,
  })
  elementById('host').textContent = payload.hostConnected ? 'up' : 'down'
  elementById('engine').textContent = payload.engineConnected ? 'live' : 'waiting'
  elementById('attach').textContent = paused
    ? 'paused'
    : attached === undefined
      ? 'none'
      : `tab ${attached}`
  elementById('resume').hidden = !paused
  elementById('kill').hidden = paused
}

elementById('open').addEventListener('click', () => {
  chrome.runtime.sendMessage<OpenPanelMessage, unknown>({ type: 'openPanel' }, () => {
    void chrome.runtime.lastError
    window.close()
  })
})
elementById('options').addEventListener('click', () => {
  chrome.runtime.sendMessage<OpenOptionsMessage, unknown>({ type: 'openOptions' }, () => {
    void chrome.runtime.lastError
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

void refresh()
