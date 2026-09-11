/** Attach gate stored in chrome.storage and edited in the options page. */
type AttachPolicy = 'prompt' | 'allowlist' | 'always'

/** How observe snapshots the page. */
type ObserveDetail = 'outline' | 'full'

/** Which engine backend the cockpit expects. */
type EngineBackend = 'extension' | 'launch' | 'attach'

/** Every cockpit / engine knob a user can set in v1. */
export type EngineSettings = {
  attachPolicy: AttachPolicy
  allowedOrigins: string[]
  paused: boolean
  autoAttachActiveTab: boolean
  confirmDestructive: boolean
  observeDetail: ObserveDetail
  requireExpect: boolean
  headed: boolean
  backend: EngineBackend
  workArea: string
  cdpUrl: string
  typeCharMs: number
  paceMs: number
  expectTimeoutMs: number
  reconnectMs: number
  debuggerVersion: string
  logNativeHost: boolean
  showBadge: boolean
  showHud: boolean
  defaultViewportWidth: number
  defaultViewportHeight: number
}

export const DEFAULT_SETTINGS: EngineSettings = {
  attachPolicy: 'allowlist',
  allowedOrigins: [],
  paused: false,
  autoAttachActiveTab: true,
  confirmDestructive: true,
  observeDetail: 'outline',
  requireExpect: true,
  headed: true,
  backend: 'extension',
  workArea: '',
  cdpUrl: '',
  typeCharMs: 28,
  paceMs: 700,
  expectTimeoutMs: 5000,
  reconnectMs: 1500,
  debuggerVersion: '1.3',
  logNativeHost: true,
  showBadge: true,
  showHud: true,
  defaultViewportWidth: 1280,
  defaultViewportHeight: 800,
}

type FieldKind = 'enum' | 'boolean' | 'number' | 'string' | 'origins'

/** One control on the options page. */
export type SettingsField = {
  key: keyof EngineSettings
  group: string
  label: string
  help: string
  kind: FieldKind
  values?: readonly string[]
  min?: number
  max?: number
}

export const SETTINGS_FIELDS: readonly SettingsField[] = [
  {
    key: 'attachPolicy',
    group: 'Safety',
    label: 'Attach policy',
    help: 'prompt every attach, allow-list known origins, or always attach.',
    kind: 'enum',
    values: ['prompt', 'allowlist', 'always'],
  },
  {
    key: 'allowedOrigins',
    group: 'Safety',
    label: 'Allowed origins',
    help: 'Exact origins, https://*, or https://*.host. Example: https://teams.cloud.microsoft',
    kind: 'origins',
  },
  {
    key: 'paused',
    group: 'Safety',
    label: 'Paused',
    help: 'Kill switch. Refuses attach and CDP until resumed.',
    kind: 'boolean',
  },
  {
    key: 'confirmDestructive',
    group: 'Safety',
    label: 'Confirm destructive',
    help: 'Ask before close-tab / navigate-away style actions in the cockpit.',
    kind: 'boolean',
  },
  {
    key: 'autoAttachActiveTab',
    group: 'Session',
    label: 'Auto-attach active tab',
    help: 'When attach has no tabId, use the active tab in the current window.',
    kind: 'boolean',
  },
  {
    key: 'backend',
    group: 'Session',
    label: 'Backend',
    help: 'What this profile expects the MCP process to use.',
    kind: 'enum',
    values: ['extension', 'launch', 'attach'],
  },
  {
    key: 'headed',
    group: 'Session',
    label: 'Headed',
    help: 'Prefer a visible window when the engine launches Chrome itself.',
    kind: 'boolean',
  },
  {
    key: 'showHud',
    group: 'Session',
    label: 'Control HUD',
    help: 'Outline the controlled tab and draw the action cursor in the page.',
    kind: 'boolean',
  },
  {
    key: 'debuggerVersion',
    group: 'Session',
    label: 'Debugger protocol',
    help: 'chrome.debugger version string. Leave 1.3 unless you know you need another.',
    kind: 'string',
  },
  {
    key: 'reconnectMs',
    group: 'Session',
    label: 'Native reconnect (ms)',
    help: 'How long the service worker waits before reconnecting the native host.',
    kind: 'number',
    min: 200,
    max: 30_000,
  },
  {
    key: 'observeDetail',
    group: 'Observe & flow',
    label: 'Observe detail',
    help: 'outline is labels only. full includes a screenshot.',
    kind: 'enum',
    values: ['outline', 'full'],
  },
  {
    key: 'requireExpect',
    group: 'Observe & flow',
    label: 'Require expect on click/navigate',
    help: 'compile_flow requireExpect default.',
    kind: 'boolean',
  },
  {
    key: 'paceMs',
    group: 'Observe & flow',
    label: 'Flow pace (ms)',
    help: 'Pause between run_flow steps in a headed session. 0 is instant.',
    kind: 'number',
    min: 0,
    max: 10_000,
  },
  {
    key: 'expectTimeoutMs',
    group: 'Observe & flow',
    label: 'Expect timeout (ms)',
    help: 'How long run_flow waits for expectUrl / expectText.',
    kind: 'number',
    min: 0,
    max: 60_000,
  },
  {
    key: 'typeCharMs',
    group: 'Observe & flow',
    label: 'Type per character (ms)',
    help: 'Human-pace typing. 0 dumps the string at once.',
    kind: 'number',
    min: 0,
    max: 500,
  },
  {
    key: 'workArea',
    group: 'Window',
    label: 'Work area',
    help: 'x,y,width,height for a headed Chrome window. Empty uses the engine default.',
    kind: 'string',
  },
  {
    key: 'defaultViewportWidth',
    group: 'Window',
    label: 'Viewport width',
    help: 'Default page viewport width when the engine launches Chrome.',
    kind: 'number',
    min: 320,
    max: 7680,
  },
  {
    key: 'defaultViewportHeight',
    group: 'Window',
    label: 'Viewport height',
    help: 'Default page viewport height when the engine launches Chrome.',
    kind: 'number',
    min: 240,
    max: 4320,
  },
  {
    key: 'cdpUrl',
    group: 'Window',
    label: 'CDP URL',
    help: 'Optional http(s) CDP endpoint if backend is attach. Unused for extension.',
    kind: 'string',
  },
  {
    key: 'logNativeHost',
    group: 'Host',
    label: 'Log native host',
    help: 'Write native-host.log under ~/.local/share/browser-engine.',
    kind: 'boolean',
  },
  {
    key: 'showBadge',
    group: 'Host',
    label: 'Toolbar badge',
    help: 'Show on / … / ! on the toolbar icon.',
    kind: 'boolean',
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  for (const item of allowed) {
    if (item === value) {
      return item
    }
  }
  return fallback
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number') {
    return fallback
  }
  if (Number.isNaN(value) || value < min || value > max) {
    return fallback
  }
  return value
}

const ORIGIN_STAR = /^[a-z][a-z0-9+.-]*:\/\/\*(\/.*)?$/i
const ORIGIN_WILDCARD_HOST = /^[a-z][a-z0-9+.-]*:\/\/\*\.[^/\s]+$/i
const ORIGIN_EXACT = /^[a-z][a-z0-9+.-]*:\/\/[^*/\s]+$/i

function isOriginPattern(value: string): boolean {
  if (value === '*') {
    return true
  }
  return ORIGIN_STAR.test(value) || ORIGIN_WILDCARD_HOST.test(value) || ORIGIN_EXACT.test(value)
}

function asOrigins(value: unknown): string[] {
  if (Array.isArray(value) === false) {
    return []
  }
  const origins: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && isOriginPattern(item) && origins.includes(item) === false) {
      origins.push(item)
    }
  }
  return origins
}

/** Parse stored JSON into a full settings object. */
export function parseSettings(raw: unknown): EngineSettings {
  if (isRecord(raw) === false) {
    return { ...DEFAULT_SETTINGS, allowedOrigins: [] }
  }
  return {
    attachPolicy: asEnum(
      raw.attachPolicy,
      ['prompt', 'allowlist', 'always'],
      DEFAULT_SETTINGS.attachPolicy,
    ),
    allowedOrigins: asOrigins(raw.allowedOrigins),
    paused: asBoolean(raw.paused, DEFAULT_SETTINGS.paused),
    autoAttachActiveTab: asBoolean(raw.autoAttachActiveTab, DEFAULT_SETTINGS.autoAttachActiveTab),
    confirmDestructive: asBoolean(raw.confirmDestructive, DEFAULT_SETTINGS.confirmDestructive),
    observeDetail: asEnum(raw.observeDetail, ['outline', 'full'], DEFAULT_SETTINGS.observeDetail),
    requireExpect: asBoolean(raw.requireExpect, DEFAULT_SETTINGS.requireExpect),
    headed: asBoolean(raw.headed, DEFAULT_SETTINGS.headed),
    backend: asEnum(raw.backend, ['extension', 'launch', 'attach'], DEFAULT_SETTINGS.backend),
    workArea: asString(raw.workArea, DEFAULT_SETTINGS.workArea),
    cdpUrl: asString(raw.cdpUrl, DEFAULT_SETTINGS.cdpUrl),
    typeCharMs: asNumber(raw.typeCharMs, DEFAULT_SETTINGS.typeCharMs, 0, 500),
    paceMs: asNumber(raw.paceMs, DEFAULT_SETTINGS.paceMs, 0, 10_000),
    expectTimeoutMs: asNumber(raw.expectTimeoutMs, DEFAULT_SETTINGS.expectTimeoutMs, 0, 60_000),
    reconnectMs: asNumber(raw.reconnectMs, DEFAULT_SETTINGS.reconnectMs, 200, 30_000),
    debuggerVersion: asString(raw.debuggerVersion, DEFAULT_SETTINGS.debuggerVersion),
    logNativeHost: asBoolean(raw.logNativeHost, DEFAULT_SETTINGS.logNativeHost),
    showBadge: asBoolean(raw.showBadge, DEFAULT_SETTINGS.showBadge),
    showHud: asBoolean(raw.showHud, DEFAULT_SETTINGS.showHud),
    defaultViewportWidth: asNumber(
      raw.defaultViewportWidth,
      DEFAULT_SETTINGS.defaultViewportWidth,
      320,
      7680,
    ),
    defaultViewportHeight: asNumber(
      raw.defaultViewportHeight,
      DEFAULT_SETTINGS.defaultViewportHeight,
      240,
      4320,
    ),
  }
}

/** Apply a partial patch. Unknown keys are ignored. */
export function patchSettings(current: EngineSettings, patch: unknown): EngineSettings {
  if (isRecord(patch) === false) {
    return parseSettings(current)
  }
  return parseSettings({ ...current, ...patch })
}

/** Origin of an http(s) URL, otherwise undefined. */
export function originFromUrl(url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined
  }
  return parsed.origin
}

function patternMatches(origin: string, pattern: string): boolean {
  if (pattern === '*' || pattern === '*://*') {
    return true
  }
  if (ORIGIN_STAR.test(pattern)) {
    const scheme = pattern.slice(0, pattern.indexOf('://'))
    return origin.startsWith(`${scheme}://`)
  }
  if (ORIGIN_WILDCARD_HOST.test(pattern)) {
    const schemeEnd = pattern.indexOf('://')
    const scheme = pattern.slice(0, schemeEnd)
    const suffix = pattern.slice(schemeEnd + 3).slice(1)
    try {
      const parsed = new URL(origin)
      return (
        parsed.protocol === `${scheme}:` &&
        parsed.hostname.endsWith(suffix) &&
        parsed.hostname.length > suffix.length
      )
    } catch {
      return false
    }
  }
  return origin === pattern
}

/** True when origin is covered by an allow-list entry. */
export function originAllowed(origin: string, allowedOrigins: readonly string[]): boolean {
  for (const pattern of allowedOrigins) {
    if (patternMatches(origin, pattern)) {
      return true
    }
  }
  return false
}
