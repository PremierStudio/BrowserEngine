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
  | { kind: 'segmented'; root: HTMLElement; value: string }
  | { kind: 'origins'; area: HTMLTextAreaElement }

type FieldGroup = {
  name: string
  fields: SettingsField[]
}

type StatusTone = 'ok' | 'warn' | 'danger'

/** Short product copy per settings group, keyed by the group name from SETTINGS_FIELDS. */
const GROUP_BLURBS = new Map<string, string>([
  ['Safety', 'Attach policy, the origin allow-list, and the global kill switch.'],
  ['Session', 'How the engine attaches to tabs and talks to the native host.'],
  ['Observe & flow', 'What an observe snapshot includes, and how scripted flows are paced.'],
  ['Window', 'Headed window geometry, viewport defaults, and the CDP endpoint.'],
  ['Host', 'Native host logging and the toolbar badge.'],
])

/** Groups with a first-class sidebar link. Everything else lives under Advanced. */
const PRIMARY_GROUPS: readonly string[] = ['Safety', 'Session']

/** Sidebar label that fronts every non-primary group. */
const ADVANCED_NAV = 'Advanced'

/** Small enums read better as a segmented control than a select. */
const SEGMENTED_KEYS: ReadonlySet<string> = new Set(['attachPolicy', 'observeDetail'])

const NARROW_VIEWPORT = window.matchMedia('(max-width: 760px)')

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

/** A segmented enum: one button per value, exactly one active at a time. */
function segmentedControl(values: readonly string[], value: unknown): FormControl {
  const root = document.createElement('div')
  const control: FormControl = {
    kind: 'segmented',
    root,
    value: typeof value === 'string' && values.includes(value) ? value : (values[0] ?? ''),
  }
  const buttons: HTMLButtonElement[] = []
  for (const item of values) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = item
    const active = item === control.value
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
    button.addEventListener('click', () => {
      if (control.kind === 'segmented') {
        control.value = item
      }
      for (const other of buttons) {
        const on = other === button
        other.classList.toggle('active', on)
        other.setAttribute('aria-pressed', String(on))
      }
    })
    buttons.push(button)
    root.append(button)
  }
  return control
}

function controlFor(field: SettingsField, value: unknown): FormControl {
  if (field.kind === 'boolean') {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value === true
    return { kind: 'boolean', input }
  }
  if (field.kind === 'enum') {
    const values = field.values ?? []
    if (SEGMENTED_KEYS.has(field.key)) {
      return segmentedControl(values, value)
    }
    const select = document.createElement('select')
    for (const item of values) {
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

function controlElement(control: FormControl): HTMLElement {
  if (control.kind === 'enum') {
    return control.select
  }
  if (control.kind === 'segmented') {
    return control.root
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
  if (control.kind === 'segmented') {
    return control.value
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
const nav = elementById('nav')
const controls = new Map<keyof EngineSettings, FormControl>()
const sections = new Map<string, HTMLElement>()
/** DOM-ordered scroll anchors: primary cards, the disclosure, then its cards. */
const boundaries: Array<[string, HTMLElement]> = []
const navItems: HTMLButtonElement[] = []
let advancedDetails: HTMLDetailsElement | undefined
let advancedOpen = false

function setStatus(message: string, tone: StatusTone): void {
  status.textContent = message
  status.classList.remove('ok', 'warn', 'danger')
  status.classList.add(tone)
}

function activeOffset(): number {
  return NARROW_VIEWPORT.matches ? 150 : 120
}

/** Group whose section top has most recently passed the sticky header stack. */
function sectionAtViewportTop(): string | undefined {
  let active: string | undefined
  for (const [name, element] of boundaries) {
    if (element.getClientRects().length === 0) {
      continue
    }
    if (element.getBoundingClientRect().top <= activeOffset()) {
      active = name
    }
  }
  return active
}

/** Sidebar item that fronts a group: primaries stand alone, the rest fold into Advanced. */
function navKey(name: string | undefined): string | undefined {
  if (name === undefined) {
    return undefined
  }
  return PRIMARY_GROUPS.includes(name) ? name : ADVANCED_NAV
}

function setActiveGroup(name: string | undefined): void {
  const key = navKey(name)
  for (const item of navItems) {
    item.classList.toggle('active', item.dataset.group === key)
  }
}

window.addEventListener(
  'scroll',
  () => {
    setActiveGroup(sectionAtViewportTop())
  },
  { passive: true },
)

function scrollToGroup(name: string): void {
  setActiveGroup(name)
  const section = sections.get(name)
  if (section !== undefined) {
    section.scrollIntoView({ block: 'start' })
  }
}

function openAdvanced(): void {
  setActiveGroup(ADVANCED_NAV)
  const details = advancedDetails
  if (details === undefined) {
    return
  }
  advancedOpen = true
  details.open = true
  details.scrollIntoView({ block: 'start' })
}

function navButton(label: string, onClick: () => void): HTMLButtonElement {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'tab options-nav-item'
  item.dataset.group = label
  item.textContent = label
  item.addEventListener('click', onClick)
  navItems.push(item)
  return item
}

function paintNav(primary: readonly FieldGroup[], advanced: readonly FieldGroup[]): void {
  nav.replaceChildren()
  navItems.length = 0
  const title = document.createElement('p')
  title.className = 'options-nav-title'
  title.textContent = 'On this page'
  nav.append(title)
  for (const group of primary) {
    nav.append(navButton(group.name, () => scrollToGroup(group.name)))
  }
  if (advanced.length > 0) {
    nav.append(navButton(ADVANCED_NAV, openAdvanced))
  }
}

/** Give each control its ui.css surface plus a stable id/data-key. */
function styleControl(field: SettingsField, control: FormControl): HTMLElement {
  const element = controlElement(control)
  element.id = `field-${field.key}`
  element.dataset.key = field.key
  if (control.kind === 'enum') {
    element.className = 'select'
  } else if (control.kind === 'segmented') {
    element.className = 'segmented'
    element.setAttribute('role', 'group')
    element.setAttribute('aria-label', field.label)
  } else if (control.kind === 'origins') {
    element.className = 'textarea'
  } else if (control.kind !== 'boolean') {
    element.className = 'input'
  }
  return element
}

/** One field row: switches use .switch markup, everything else a label + control. */
function fieldNode(
  field: SettingsField,
  value: unknown,
): { node: HTMLElement; control: FormControl } {
  const control = controlFor(field, value)
  const element = styleControl(field, control)
  const wrap = document.createElement('div')
  wrap.className = 'field options-field'
  if (field.kind === 'origins') {
    wrap.classList.add('options-field-wide')
  }
  const hint = document.createElement('code')
  hint.className = 'options-key'
  hint.textContent = field.key
  hint.title = field.key
  if (control.kind === 'boolean') {
    const row = document.createElement('div')
    row.className = 'options-switch-row'
    const label = document.createElement('label')
    label.className = 'switch'
    const track = document.createElement('span')
    track.className = 'track'
    const caption = document.createElement('span')
    caption.className = 'switch-label'
    caption.textContent = field.label
    label.append(element, track, caption)
    row.append(label, hint)
    wrap.append(row)
  } else {
    const head = document.createElement('div')
    head.className = 'options-field-head'
    const label = document.createElement(control.kind === 'segmented' ? 'span' : 'label')
    label.className = 'field-label'
    if (label instanceof HTMLLabelElement) {
      label.htmlFor = element.id
    }
    label.textContent = field.label
    head.append(label, hint)
    wrap.append(head, element)
  }
  const help = document.createElement('p')
  help.className = 'help'
  help.textContent = field.help
  wrap.append(help)
  return { node: wrap, control }
}

function sectionId(name: string): string {
  return `options-group-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

/** One card: head with group name + field count, blurb, then the field grid. */
function buildSection(group: FieldGroup, values: Record<string, unknown>): HTMLElement {
  const section = document.createElement('section')
  section.className = 'card options-group'
  section.id = sectionId(group.name)
  const head = document.createElement('div')
  head.className = 'card-head'
  const title = document.createElement('h3')
  title.textContent = group.name
  const count = document.createElement('span')
  count.className = 'count'
  count.textContent = `${String(group.fields.length)} fields`
  head.append(title, count)
  const body = document.createElement('div')
  body.className = 'card-body'
  const blurb = GROUP_BLURBS.get(group.name)
  if (blurb !== undefined) {
    const description = document.createElement('p')
    description.className = 'options-group-desc'
    description.textContent = blurb
    body.append(description)
  }
  const grid = document.createElement('div')
  grid.className = 'options-fields'
  for (const field of group.fields) {
    const { node, control } = fieldNode(field, values[field.key])
    controls.set(field.key, control)
    grid.append(node)
  }
  body.append(grid)
  section.append(head, body)
  sections.set(group.name, section)
  boundaries.push([group.name, section])
  return section
}

function paint(settings: unknown): void {
  const previous = sectionAtViewportTop()
  form.replaceChildren()
  controls.clear()
  sections.clear()
  boundaries.length = 0
  const values = settingsValues(settings)
  const groups = groupedFields()
  const primary = groups.filter((group) => PRIMARY_GROUPS.includes(group.name))
  const advanced = groups.filter((group) => PRIMARY_GROUPS.includes(group.name) === false)
  for (const group of primary) {
    form.append(buildSection(group, values))
  }
  advancedDetails = undefined
  if (advanced.length > 0) {
    const details = document.createElement('details')
    details.className = 'options-advanced'
    details.open = advancedOpen
    const summary = document.createElement('summary')
    summary.textContent = 'Advanced engine settings'
    const body = document.createElement('div')
    body.className = 'options-advanced-body'
    boundaries.push([ADVANCED_NAV, details])
    for (const group of advanced) {
      body.append(buildSection(group, values))
    }
    details.append(summary, body)
    details.addEventListener('toggle', () => {
      advancedOpen = details.open
    })
    advancedDetails = details
    form.append(details)
  }
  paintNav(primary, advanced)
  const first = groups[0]
  const restored =
    previous !== undefined && (sections.has(previous) || previous === ADVANCED_NAV)
      ? previous
      : first?.name
  setActiveGroup(restored)
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
    setStatus(payload.reply.error ?? 'Could not load settings', 'danger')
    return
  }
  paint(payload.reply.result)
  setStatus('Loaded from this browser profile.', 'ok')
}

elementById('save').addEventListener('click', async () => {
  const payload = await command('settings', { op: 'set', patch: collect() })
  if (payload.reply.ok) {
    paint(payload.reply.result)
    setStatus('Saved.', 'ok')
  } else {
    setStatus(payload.reply.error ?? 'Save failed', 'danger')
  }
})

elementById('reset').addEventListener('click', async () => {
  const payload = await command('settings', { op: 'reset' })
  if (payload.reply.ok) {
    paint(payload.reply.result)
    setStatus('Defaults restored.', 'ok')
  } else {
    setStatus(payload.reply.error ?? 'Reset failed', 'danger')
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
  setStatus('Exported current form values.', 'ok')
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
    setStatus('Imported. Click Save to persist.', 'warn')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Import failed', 'danger')
  }
})

void load()
