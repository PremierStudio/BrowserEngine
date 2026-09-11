import { SETTINGS_FIELDS, type EngineSettings, type SettingsField } from './settings.js'

type CommandReply = {
  ok: boolean
  error?: string
  result?: unknown
}

type CommandPayload = {
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

type FormControl =
  | { kind: 'boolean' | 'number' | 'string'; input: HTMLInputElement }
  | { kind: 'enum'; select: HTMLSelectElement }
  | { kind: 'origins'; area: HTMLTextAreaElement }

type FieldGroup = {
  name: string
  fields: SettingsField[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false
}

function isIndexable(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
          resolve({ reply: { ok: false, error: chrome.runtime.lastError.message } })
          return
        }
        resolve(asCommandPayload(raw))
      },
    )
  })
}

function groupedFields(): FieldGroup[] {
  const groups: FieldGroup[] = []
  const index = new Map<string, FieldGroup>()
  for (const field of SETTINGS_FIELDS) {
    let group = index.get(field.group)
    if (group === undefined) {
      group = { name: field.group, fields: [] }
      index.set(field.group, group)
      groups.push(group)
    }
    group.fields.push(field)
  }
  return groups
}

function controlFor(field: SettingsField, value: unknown): FormControl {
  if (field.kind === 'boolean') {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value === true
    return { kind: 'boolean', input }
  }
  if (field.kind === 'enum') {
    const select = document.createElement('select')
    for (const item of field.values ?? []) {
      const option = document.createElement('option')
      option.value = item
      option.textContent = item
      if (item === value) {
        option.selected = true
      }
      select.append(option)
    }
    return { kind: 'enum', select }
  }
  if (field.kind === 'number') {
    const input = document.createElement('input')
    input.type = 'number'
    if (field.min !== undefined) input.min = String(field.min)
    if (field.max !== undefined) input.max = String(field.max)
    input.value = String(value ?? '')
    return { kind: 'number', input }
  }
  if (field.kind === 'origins') {
    const area = document.createElement('textarea')
    area.value = Array.isArray(value) ? value.join('\n') : ''
    area.placeholder = 'one origin per line'
    return { kind: 'origins', area }
  }
  const input = document.createElement('input')
  input.type = 'text'
  input.value = String(value ?? '')
  return { kind: 'string', input }
}

function controlElement(
  control: FormControl,
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  if (control.kind === 'enum') {
    return control.select
  }
  if (control.kind === 'origins') {
    return control.area
  }
  return control.input
}

function readControl(control: FormControl): boolean | number | string | string[] {
  if (control.kind === 'boolean') {
    return control.input.checked
  }
  if (control.kind === 'number') {
    return Number(control.input.value)
  }
  if (control.kind === 'origins') {
    return control.area.value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
  }
  if (control.kind === 'enum') {
    return control.select.value
  }
  return control.input.value
}

function settingsValues(settings: unknown): Record<string, unknown> {
  if (isIndexable(settings)) {
    return settings
  }
  if (settings === null || settings === undefined) {
    throw new TypeError('Cannot read settings')
  }
  return {}
}

const form = elementById('form')
const status = elementById('status')
const controls = new Map<keyof EngineSettings, FormControl>()

function paint(settings: unknown): void {
  form.replaceChildren()
  controls.clear()
  const values = settingsValues(settings)
  for (const group of groupedFields()) {
    const section = document.createElement('section')
    section.className = 'group'
    const heading = document.createElement('h2')
    heading.textContent = group.name
    section.append(heading)
    for (const field of group.fields) {
      const wrap = document.createElement('div')
      wrap.className = 'field'
      const label = document.createElement('label')
      label.textContent = field.label
      const help = document.createElement('div')
      help.className = 'help'
      help.textContent = field.help
      const control = controlFor(field, values[field.key])
      const element = controlElement(control)
      element.dataset.key = field.key
      controls.set(field.key, control)
      wrap.append(label, element, help)
      section.append(wrap)
    }
    form.append(section)
  }
}

function collect(): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const field of SETTINGS_FIELDS) {
    const control = controls.get(field.key)
    if (control !== undefined) {
      patch[field.key] = readControl(control)
    }
  }
  return patch
}

async function load(): Promise<void> {
  const payload = await command('settings', { op: 'get' })
  if (payload.reply.ok !== true) {
    status.textContent = payload.reply.error ?? 'Could not load settings'
    return
  }
  paint(payload.reply.result)
  status.textContent = 'Loaded from this Brave profile.'
}

elementById('save').addEventListener('click', async () => {
  const payload = await command('settings', { op: 'set', patch: collect() })
  status.textContent = payload.reply.ok ? 'Saved.' : (payload.reply.error ?? 'Save failed')
  if (payload.reply.ok) {
    paint(payload.reply.result)
  }
})

elementById('reset').addEventListener('click', async () => {
  const payload = await command('settings', { op: 'reset' })
  status.textContent = payload.reply.ok
    ? 'Defaults restored.'
    : (payload.reply.error ?? 'Reset failed')
  if (payload.reply.ok) {
    paint(payload.reply.result)
  }
})

elementById('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(collect(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'browser-engine-settings.json'
  a.click()
  URL.revokeObjectURL(url)
  status.textContent = 'Exported current form values.'
})

elementById('import').addEventListener('click', () => {
  inputById('importFile').click()
})

inputById('importFile').addEventListener('change', async (event) => {
  if (event.target instanceof HTMLInputElement === false) {
    return
  }
  const file = event.target.files?.[0]
  if (file === undefined) {
    return
  }
  try {
    const parsed: unknown = JSON.parse(await file.text())
    paint(parsed)
    status.textContent = 'Imported. Click Save to persist.'
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Import failed'
  }
})

void load()
