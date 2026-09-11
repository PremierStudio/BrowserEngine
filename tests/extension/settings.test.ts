import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTINGS_FIELDS,
  originAllowed,
  originFromUrl,
  parseSettings,
  patchSettings,
} from '../../src/extension/settings.js'

describe('parseSettings', () => {
  it('fills defaults for empty input', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps a valid full object and drops unknown keys', () => {
    const parsed = parseSettings({
      ...DEFAULT_SETTINGS,
      attachPolicy: 'always',
      junk: true,
    })
    expect(parsed.attachPolicy).toBe('always')
    expect(parsed).not.toHaveProperty('junk')
  })

  it('rejects invalid enums, negatives, and empty origins', () => {
    const parsed = parseSettings({
      attachPolicy: 'sometimes',
      observeDetail: 'huge',
      backend: 'chrome',
      typeCharMs: -4,
      paceMs: -1,
      expectTimeoutMs: -9,
      reconnectMs: 0,
      defaultViewportWidth: 50,
      defaultViewportHeight: 10,
      allowedOrigins: ['https://teams.cloud.microsoft', 'not-a-origin', '', 3],
    })
    expect(parsed.attachPolicy).toBe(DEFAULT_SETTINGS.attachPolicy)
    expect(parsed.observeDetail).toBe(DEFAULT_SETTINGS.observeDetail)
    expect(parsed.backend).toBe(DEFAULT_SETTINGS.backend)
    expect(parsed.typeCharMs).toBe(DEFAULT_SETTINGS.typeCharMs)
    expect(parsed.paceMs).toBe(DEFAULT_SETTINGS.paceMs)
    expect(parsed.expectTimeoutMs).toBe(DEFAULT_SETTINGS.expectTimeoutMs)
    expect(parsed.reconnectMs).toBe(DEFAULT_SETTINGS.reconnectMs)
    expect(parsed.defaultViewportWidth).toBe(DEFAULT_SETTINGS.defaultViewportWidth)
    expect(parsed.defaultViewportHeight).toBe(DEFAULT_SETTINGS.defaultViewportHeight)
    expect(parsed.allowedOrigins).toEqual(['https://teams.cloud.microsoft'])
  })

  it('keeps booleans and rejects every non-boolean value', () => {
    const kept = parseSettings({
      paused: true,
      autoAttachActiveTab: false,
      confirmDestructive: false,
      requireExpect: false,
      headed: false,
      logNativeHost: false,
      showBadge: false,
      showHud: false,
    })
    expect(kept.paused).toBe(true)
    expect(kept.autoAttachActiveTab).toBe(false)
    expect(kept.confirmDestructive).toBe(false)
    expect(kept.requireExpect).toBe(false)
    expect(kept.headed).toBe(false)
    expect(kept.logNativeHost).toBe(false)
    expect(kept.showBadge).toBe(false)
    expect(kept.showHud).toBe(false)
    expect(DEFAULT_SETTINGS.showHud).toBe(true)

    const rejected = parseSettings({
      paused: 'true',
      autoAttachActiveTab: 0,
      confirmDestructive: null,
      requireExpect: undefined,
      headed: [],
      logNativeHost: 'yes',
      showBadge: 1,
      showHud: 'on',
    })
    expect(rejected.paused).toBe(DEFAULT_SETTINGS.paused)
    expect(rejected.autoAttachActiveTab).toBe(DEFAULT_SETTINGS.autoAttachActiveTab)
    expect(rejected.confirmDestructive).toBe(DEFAULT_SETTINGS.confirmDestructive)
    expect(rejected.requireExpect).toBe(DEFAULT_SETTINGS.requireExpect)
    expect(rejected.headed).toBe(DEFAULT_SETTINGS.headed)
    expect(rejected.logNativeHost).toBe(DEFAULT_SETTINGS.logNativeHost)
    expect(rejected.showBadge).toBe(DEFAULT_SETTINGS.showBadge)
    expect(rejected.showHud).toBe(DEFAULT_SETTINGS.showHud)
  })

  it('keeps strings and rejects every non-string value', () => {
    const kept = parseSettings({
      workArea: '0,0,1024,768',
      cdpUrl: 'http://127.0.0.1:9222',
      debuggerVersion: '1.2',
    })
    expect(kept.workArea).toBe('0,0,1024,768')
    expect(kept.cdpUrl).toBe('http://127.0.0.1:9222')
    expect(kept.debuggerVersion).toBe('1.2')

    const rejected = parseSettings({ workArea: 1, cdpUrl: null, debuggerVersion: ['1.3'] })
    expect(rejected.workArea).toBe(DEFAULT_SETTINGS.workArea)
    expect(rejected.cdpUrl).toBe(DEFAULT_SETTINGS.cdpUrl)
    expect(rejected.debuggerVersion).toBe(DEFAULT_SETTINGS.debuggerVersion)
  })

  it('keeps in-range numbers and accepts both exact boundaries', () => {
    const kept = parseSettings({
      typeCharMs: 10,
      paceMs: 25,
      expectTimeoutMs: 100,
      reconnectMs: 1000,
      defaultViewportWidth: 1920,
      defaultViewportHeight: 1080,
    })
    expect(kept.typeCharMs).toBe(10)
    expect(kept.paceMs).toBe(25)
    expect(kept.expectTimeoutMs).toBe(100)
    expect(kept.reconnectMs).toBe(1000)
    expect(kept.defaultViewportWidth).toBe(1920)
    expect(kept.defaultViewportHeight).toBe(1080)

    const minima = parseSettings({
      typeCharMs: 0,
      paceMs: 0,
      expectTimeoutMs: 0,
      reconnectMs: 200,
      defaultViewportWidth: 320,
      defaultViewportHeight: 240,
    })
    expect(minima.typeCharMs).toBe(0)
    expect(minima.paceMs).toBe(0)
    expect(minima.expectTimeoutMs).toBe(0)
    expect(minima.reconnectMs).toBe(200)
    expect(minima.defaultViewportWidth).toBe(320)
    expect(minima.defaultViewportHeight).toBe(240)

    const maxima = parseSettings({
      typeCharMs: 500,
      paceMs: 10_000,
      expectTimeoutMs: 60_000,
      reconnectMs: 30_000,
      defaultViewportWidth: 7680,
      defaultViewportHeight: 4320,
    })
    expect(maxima.typeCharMs).toBe(500)
    expect(maxima.paceMs).toBe(10_000)
    expect(maxima.expectTimeoutMs).toBe(60_000)
    expect(maxima.reconnectMs).toBe(30_000)
    expect(maxima.defaultViewportWidth).toBe(7680)
    expect(maxima.defaultViewportHeight).toBe(4320)
  })

  it('rejects out-of-range, non-finite, and wrong-type numbers', () => {
    const outOfRange = parseSettings({
      typeCharMs: -1,
      paceMs: 10_001,
      expectTimeoutMs: 60_001,
      reconnectMs: 199,
      defaultViewportWidth: 319,
      defaultViewportHeight: 4321,
    })
    expect(outOfRange.typeCharMs).toBe(DEFAULT_SETTINGS.typeCharMs)
    expect(outOfRange.paceMs).toBe(DEFAULT_SETTINGS.paceMs)
    expect(outOfRange.expectTimeoutMs).toBe(DEFAULT_SETTINGS.expectTimeoutMs)
    expect(outOfRange.reconnectMs).toBe(DEFAULT_SETTINGS.reconnectMs)
    expect(outOfRange.defaultViewportWidth).toBe(DEFAULT_SETTINGS.defaultViewportWidth)
    expect(outOfRange.defaultViewportHeight).toBe(DEFAULT_SETTINGS.defaultViewportHeight)

    const nonFinite = parseSettings({
      typeCharMs: Number.NaN,
      paceMs: Number.POSITIVE_INFINITY,
      expectTimeoutMs: Number.NEGATIVE_INFINITY,
      reconnectMs: Number.NaN,
    })
    expect(nonFinite.typeCharMs).toBe(DEFAULT_SETTINGS.typeCharMs)
    expect(nonFinite.paceMs).toBe(DEFAULT_SETTINGS.paceMs)
    expect(nonFinite.expectTimeoutMs).toBe(DEFAULT_SETTINGS.expectTimeoutMs)
    expect(nonFinite.reconnectMs).toBe(DEFAULT_SETTINGS.reconnectMs)

    const wrongType = parseSettings({
      defaultViewportWidth: '1920',
      defaultViewportHeight: null,
      paceMs: {},
      reconnectMs: [],
    })
    expect(wrongType.defaultViewportWidth).toBe(DEFAULT_SETTINGS.defaultViewportWidth)
    expect(wrongType.defaultViewportHeight).toBe(DEFAULT_SETTINGS.defaultViewportHeight)
    expect(wrongType.paceMs).toBe(DEFAULT_SETTINGS.paceMs)
    expect(wrongType.reconnectMs).toBe(DEFAULT_SETTINGS.reconnectMs)
  })

  it('accepts every documented enum member and falls back on unknown values', () => {
    expect(parseSettings({ attachPolicy: 'prompt' }).attachPolicy).toBe('prompt')
    expect(parseSettings({ attachPolicy: 'allowlist' }).attachPolicy).toBe('allowlist')
    expect(parseSettings({ attachPolicy: 'always' }).attachPolicy).toBe('always')
    expect(parseSettings({ observeDetail: 'outline' }).observeDetail).toBe('outline')
    expect(parseSettings({ observeDetail: 'full' }).observeDetail).toBe('full')
    expect(parseSettings({ backend: 'extension' }).backend).toBe('extension')
    expect(parseSettings({ backend: 'launch' }).backend).toBe('launch')
    expect(parseSettings({ backend: 'attach' }).backend).toBe('attach')

    const unknown = parseSettings({
      attachPolicy: 'nope',
      observeDetail: 'nope',
      backend: 'nope',
    })
    expect(unknown.attachPolicy).toBe(DEFAULT_SETTINGS.attachPolicy)
    expect(unknown.observeDetail).toBe(DEFAULT_SETTINGS.observeDetail)
    expect(unknown.backend).toBe(DEFAULT_SETTINGS.backend)

    const nonString = parseSettings({ attachPolicy: null, observeDetail: 3, backend: {} })
    expect(nonString.attachPolicy).toBe(DEFAULT_SETTINGS.attachPolicy)
    expect(nonString.observeDetail).toBe(DEFAULT_SETTINGS.observeDetail)
    expect(nonString.backend).toBe(DEFAULT_SETTINGS.backend)
  })

  it('matches non-default enum literals even when the built-in default changes', () => {
    const originalAttachPolicy = DEFAULT_SETTINGS.attachPolicy
    const originalObserveDetail = DEFAULT_SETTINGS.observeDetail
    const originalBackend = DEFAULT_SETTINGS.backend
    try {
      DEFAULT_SETTINGS.attachPolicy = 'prompt'
      DEFAULT_SETTINGS.observeDetail = 'full'
      DEFAULT_SETTINGS.backend = 'attach'
      const parsed = parseSettings({
        attachPolicy: 'allowlist',
        observeDetail: 'outline',
        backend: 'extension',
      })
      expect(parsed.attachPolicy).toBe('allowlist')
      expect(parsed.observeDetail).toBe('outline')
      expect(parsed.backend).toBe('extension')
    } finally {
      DEFAULT_SETTINGS.attachPolicy = originalAttachPolicy
      DEFAULT_SETTINGS.observeDetail = originalObserveDetail
      DEFAULT_SETTINGS.backend = originalBackend
    }
  })

  it('treats arrays as invalid input even when they carry named properties', () => {
    const raw: unknown = Object.assign(['https://teams.cloud.microsoft'], { paused: true })
    expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps every valid origin pattern form', () => {
    const parsed = parseSettings({
      allowedOrigins: [
        'https://teams.cloud.microsoft',
        'https://*',
        'https://*.cloud.microsoft',
        '*',
      ],
    })
    expect(parsed.allowedOrigins).toEqual([
      'https://teams.cloud.microsoft',
      'https://*',
      'https://*.cloud.microsoft',
      '*',
    ])
  })

  it('drops duplicate and malformed origin entries', () => {
    const parsed = parseSettings({
      allowedOrigins: [
        'https://teams.cloud.microsoft',
        'https://teams.cloud.microsoft',
        'not-a-origin',
        '',
        3,
        null,
        { origin: 'https://x.example' },
        [['https://nested.example']],
      ],
    })
    expect(parsed.allowedOrigins).toEqual(['https://teams.cloud.microsoft'])
  })

  it('returns no origins for non-array or non-iterable origin lists', () => {
    expect(parseSettings({ allowedOrigins: 3 }).allowedOrigins).toEqual([])
    expect(parseSettings({ allowedOrigins: null }).allowedOrigins).toEqual([])
    expect(parseSettings({ allowedOrigins: { 0: 'https://x.example' } }).allowedOrigins).toEqual([])
    expect(parseSettings({ allowedOrigins: undefined }).allowedOrigins).toEqual([])
  })
})

describe('patchSettings', () => {
  it('applies a partial patch on top of current settings', () => {
    const next = patchSettings(DEFAULT_SETTINGS, {
      paused: true,
      allowedOrigins: ['https://nymbl.example'],
    })
    expect(next.paused).toBe(true)
    expect(next.allowedOrigins).toEqual(['https://nymbl.example'])
    expect(next.attachPolicy).toBe('allowlist')
  })

  it('keeps in-range numbers and ignores a non-object patch', () => {
    const parsed = parseSettings({
      typeCharMs: 10,
      reconnectMs: 400,
      allowedOrigins: 'nope',
    })
    expect(parsed.typeCharMs).toBe(10)
    expect(parsed.reconnectMs).toBe(400)
    expect(parsed.allowedOrigins).toEqual([])
    expect(patchSettings(DEFAULT_SETTINGS, 3)).toEqual(DEFAULT_SETTINGS)
  })

  it('ignores array patches even when they carry named properties', () => {
    const current = { ...DEFAULT_SETTINGS, paused: true }
    const patch: unknown = Object.assign([], { paused: false })
    expect(patchSettings(current, patch)).toEqual(current)
  })
})

describe('originFromUrl / originAllowed', () => {
  it('parses http(s) origins and ignores chrome pages', () => {
    expect(originFromUrl('https://teams.cloud.microsoft/v2/')).toBe('https://teams.cloud.microsoft')
    expect(originFromUrl('http://127.0.0.1:3000/x')).toBe('http://127.0.0.1:3000')
    expect(originFromUrl('chrome://extensions')).toBeUndefined()
    expect(originFromUrl('about:blank')).toBeUndefined()
    expect(originFromUrl('not a url')).toBeUndefined()
  })

  it('matches exact origins, star, and a single subdomain wildcard', () => {
    expect(originAllowed('https://teams.cloud.microsoft', ['https://teams.cloud.microsoft'])).toBe(
      true,
    )
    expect(originAllowed('https://a.example', ['https://b.example'])).toBe(false)
    expect(parseSettings({ allowedOrigins: ['*'] }).allowedOrigins).toEqual(['*'])
    expect(originAllowed('https://a.example', ['*'])).toBe(true)
    expect(originAllowed('https://a.example', ['https://*'])).toBe(true)
    expect(originAllowed('http://a.example', ['https://*'])).toBe(false)
    expect(originAllowed('https://app.cloud.microsoft', ['https://*.cloud.microsoft'])).toBe(true)
    expect(originAllowed('https://cloud.microsoft', ['https://*.cloud.microsoft'])).toBe(false)
    expect(originAllowed('https://a.example', ['*://*'])).toBe(true)
    expect(originAllowed('not-a-url', ['https://*.example'])).toBe(false)
  })

  it('matches wildcard hosts only for the same scheme and a subdomain', () => {
    expect(originAllowed('https://app.cloud.microsoft', ['https://*.cloud.microsoft'])).toBe(true)
    expect(originAllowed('http://app.cloud.microsoft', ['https://*.cloud.microsoft'])).toBe(false)
    expect(originAllowed('https://cloud.microsoft', ['https://*.cloud.microsoft'])).toBe(false)
    expect(originAllowed('https://xcloud.microsoft', ['https://*.cloud.microsoft'])).toBe(false)
    expect(originAllowed('https://evil.example', ['https://*.cloud.microsoft'])).toBe(false)
    expect(originAllowed('https://.cloud.microsoft', ['https://*.cloud.microsoft'])).toBe(false)
  })

  it('rejects unparseable origins even when they equal a wildcard pattern', () => {
    expect(originAllowed('not-a-url', ['https://*.example'])).toBe(false)
    expect(originAllowed('https://*.example:99999', ['https://*.example:99999'])).toBe(false)
  })
})

describe('SETTINGS_FIELDS', () => {
  it('covers every settings key exactly once, grouped for the options page', () => {
    const keys = SETTINGS_FIELDS.map((field) => field.key).sort()
    expect(keys).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
    expect(new Set(SETTINGS_FIELDS.map((field) => field.group)).size).toBeGreaterThan(3)
    for (const field of SETTINGS_FIELDS) {
      expect(field.label.length).toBeGreaterThan(0)
      expect(field.help.length).toBeGreaterThan(0)
    }
  })
})
