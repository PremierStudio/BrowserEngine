import { describe, expect, it } from 'vitest'
import {
  FALLBACK_WORK_AREA,
  INVALID_CDP_URL_MESSAGE,
  QUIET_CHROME_ARGS,
  WINDOWS_WORK_AREA_COMMAND,
  firstBrowserPage,
  argvHasHeaded,
  headedRequested,
  leftSnapBounds,
  openPuppeteerBrowser,
  parseWorkAreaCsv,
  puppeteerLaunchOptions,
  releaseBrowser,
  resolveBrowserOpenMode,
  sandboxChromeArgs,
  resolveWorkArea,
} from '../../src/browser/launchOptions.js'

describe('argvHasHeaded', () => {
  it('is false when argv is omitted or has no --headed flag', () => {
    expect(argvHasHeaded(undefined)).toBe(false)
    expect(argvHasHeaded([])).toBe(false)
    expect(argvHasHeaded(['--http'])).toBe(false)
  })

  it('is true only for an exact --headed token', () => {
    expect(argvHasHeaded(['--headed'])).toBe(true)
    expect(argvHasHeaded(['node', 'cli.js', '--headed', 'run'])).toBe(true)
  })
})

describe('headedRequested', () => {
  it('is headed unless BROWSER_ENGINE_HEADED is 0', () => {
    expect(headedRequested({ BROWSER_ENGINE_HEADED: '1' }, [])).toBe(true)
    expect(headedRequested({ BROWSER_ENGINE_HEADED: '0' }, [])).toBe(false)
    expect(headedRequested({ BROWSER_ENGINE_HEADED: '0' }, ['--headed'])).toBe(true)
    expect(headedRequested({}, ['node', 'cli.js', '--headed'])).toBe(true)
    expect(headedRequested({}, ['node', 'cli.js'])).toBe(true)
  })
})

describe('leftSnapBounds', () => {
  it('takes the left half of the primary work area', () => {
    expect(leftSnapBounds({ x: 0, y: 40, width: 2560, height: 1366 })).toEqual({
      x: 0,
      y: 40,
      width: 1280,
      height: 1366,
    })
  })

  it('floors an odd work width and keeps a non-zero origin', () => {
    expect(leftSnapBounds({ x: -1920, y: 0, width: 1921, height: 1080 })).toEqual({
      x: -1920,
      y: 0,
      width: 960,
      height: 1080,
    })
  })
})

describe('parseWorkAreaCsv', () => {
  it('reads x,y,width,height and allows spaces around numbers', () => {
    expect(parseWorkAreaCsv('0, 40, 2560, 1366')).toEqual({
      x: 0,
      y: 40,
      width: 2560,
      height: 1366,
    })
    expect(parseWorkAreaCsv('0,0,1,1')).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('rejects missing, empty, malformed, and non-positive sizes', () => {
    expect(parseWorkAreaCsv(undefined)).toBeUndefined()
    expect(parseWorkAreaCsv('')).toBeUndefined()
    expect(parseWorkAreaCsv('0,40,2560')).toBeUndefined()
    expect(parseWorkAreaCsv('0,40,2560,1366,1')).toBeUndefined()
    expect(parseWorkAreaCsv('a,b,c,d')).toBeUndefined()
    expect(parseWorkAreaCsv('nan,40,2560,1366')).toBeUndefined()
    expect(parseWorkAreaCsv('0,nan,2560,1366')).toBeUndefined()
    expect(parseWorkAreaCsv('0,40,nan,1366')).toBeUndefined()
    expect(parseWorkAreaCsv('0,40,2560,nan')).toBeUndefined()
    expect(parseWorkAreaCsv('0,40,0,1366')).toBeUndefined()
    expect(parseWorkAreaCsv('0,40,2560,0')).toBeUndefined()
    expect(parseWorkAreaCsv('0,40,-1,1366')).toBeUndefined()
    expect(parseWorkAreaCsv('0,40,2560,-2')).toBeUndefined()
  })
})

describe('resolveWorkArea', () => {
  it('prefers BROWSER_ENGINE_WORK_AREA over a probe', () => {
    expect(
      resolveWorkArea({ BROWSER_ENGINE_WORK_AREA: '10,20,2000,1000' }, '0,40,2560,1366'),
    ).toEqual({ x: 10, y: 20, width: 2000, height: 1000 })
  })

  it('uses the probe when the env override is missing or invalid', () => {
    expect(resolveWorkArea({}, '0,40,2560,1366')).toEqual({
      x: 0,
      y: 40,
      width: 2560,
      height: 1366,
    })
    expect(resolveWorkArea({ BROWSER_ENGINE_WORK_AREA: 'nope' }, '0,40,2560,1366')).toEqual({
      x: 0,
      y: 40,
      width: 2560,
      height: 1366,
    })
  })

  it('falls back when neither env nor probe is usable', () => {
    expect(resolveWorkArea({}, undefined)).toEqual(FALLBACK_WORK_AREA)
    expect(resolveWorkArea({ BROWSER_ENGINE_WORK_AREA: '' }, 'bad')).toEqual(FALLBACK_WORK_AREA)
  })
})

describe('WINDOWS_WORK_AREA_COMMAND', () => {
  it('prints the primary WorkingArea as x,y,width,height', () => {
    expect(WINDOWS_WORK_AREA_COMMAND).toContain('System.Windows.Forms')
    expect(WINDOWS_WORK_AREA_COMMAND).toContain('WorkingArea')
    expect(WINDOWS_WORK_AREA_COMMAND).toContain('$w.X),$($w.Y),$($w.Width),$($w.Height)')
  })
})

describe('sandboxChromeArgs', () => {
  it('is empty unless CI or BROWSER_ENGINE_NO_SANDBOX asks', () => {
    expect(sandboxChromeArgs({})).toEqual([])
    expect(sandboxChromeArgs({})).not.toEqual(['Stryker was here'])
    expect(sandboxChromeArgs({ CI: '1' })).toEqual([])
    expect(sandboxChromeArgs({ BROWSER_ENGINE_NO_SANDBOX: '0' })).toEqual([])
  })

  it('adds no-sandbox when CI is true or the env flag is 1', () => {
    expect(sandboxChromeArgs({ CI: 'true' })).toEqual(['--no-sandbox', '--disable-setuid-sandbox'])
    expect(sandboxChromeArgs({ BROWSER_ENGINE_NO_SANDBOX: '1' })).toEqual([
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ])
  })
})

describe('puppeteerLaunchOptions', () => {
  it('locks a 1280x800 viewport in headless and still quiets password UI', () => {
    const launched = puppeteerLaunchOptions(false)
    expect(launched.headless).toBe(true)
    expect(launched.defaultViewport).toEqual({ width: 1280, height: 800 })
    expect(launched.args).toEqual(QUIET_CHROME_ARGS)
    expect(puppeteerLaunchOptions(false, FALLBACK_WORK_AREA, ['--no-sandbox']).args).toEqual([
      '--no-sandbox',
      ...QUIET_CHROME_ARGS,
    ])
  })

  it('snaps the headed window to the left half of the work area', () => {
    expect(puppeteerLaunchOptions(true, { x: 0, y: 40, width: 2560, height: 1366 })).toEqual({
      headless: false,
      defaultViewport: null,
      args: ['--window-position=0,40', '--window-size=1280,1366', ...QUIET_CHROME_ARGS],
    })
  })

  it('uses the fallback work area when none is supplied', () => {
    const snap = leftSnapBounds(FALLBACK_WORK_AREA)
    expect(puppeteerLaunchOptions(true)).toEqual({
      headless: false,
      defaultViewport: null,
      args: [
        `--window-position=${snap.x},${snap.y}`,
        `--window-size=${snap.width},${snap.height}`,
        ...QUIET_CHROME_ARGS,
      ],
    })
  })

  it('pins the quiet flags that keep password and leak bubbles off the page', () => {
    expect(QUIET_CHROME_ARGS).toEqual([
      '--disable-save-password-bubble',
      '--password-store=basic',
      '--disable-features=PasswordLeakDetection,PasswordManagerOnboarding,SafeBrowsingEnhancedProtection',
    ])
    const headed = puppeteerLaunchOptions(true).args
    for (const flag of QUIET_CHROME_ARGS) {
      expect(headed).toContain(flag)
    }
  })
})

describe('firstBrowserPage', () => {
  it('reuses the page launch already opened', async () => {
    const existing = { id: 'first' }
    const created: unknown[] = []
    const page = await firstBrowserPage(
      async () => [existing],
      async () => {
        const next = { id: 'second' }
        created.push(next)
        return next
      },
    )
    expect(page).toBe(existing)
    expect(created).toEqual([])
  })

  it('creates a page only when launch left none', async () => {
    const created = { id: 'created' }
    const page = await firstBrowserPage(
      async () => [],
      async () => created,
    )
    expect(page).toBe(created)
  })
})

describe('resolveBrowserOpenMode', () => {
  it('launches when env and argv omit a CDP URL', () => {
    expect(resolveBrowserOpenMode({}, [])).toEqual({ kind: 'launch' })
    expect(resolveBrowserOpenMode({ BROWSER_ENGINE_BACKEND: 'extension' }, [])).toEqual({
      kind: 'extension',
    })
    expect(resolveBrowserOpenMode({}, ['--extension'])).toEqual({ kind: 'extension' })
    expect(resolveBrowserOpenMode({ BROWSER_ENGINE_CDP_URL: undefined }, [])).toEqual({
      kind: 'launch',
    })
    expect(resolveBrowserOpenMode({}, ['node', 'cli.js', '--http'])).toEqual({ kind: 'launch' })
  })

  it('attaches when BROWSER_ENGINE_CDP_URL is an http URL', () => {
    expect(resolveBrowserOpenMode({ BROWSER_ENGINE_CDP_URL: 'http://127.0.0.1:9222' }, [])).toEqual(
      { kind: 'attach', browserURL: 'http://127.0.0.1:9222' },
    )
  })

  it('attaches over https and trims surrounding space', () => {
    expect(
      resolveBrowserOpenMode({ BROWSER_ENGINE_CDP_URL: '  https://127.0.0.1:9222/  ' }, []),
    ).toEqual({ kind: 'attach', browserURL: 'https://127.0.0.1:9222/' })
  })

  it('lets --cdp-url win over a different env URL', () => {
    expect(resolveBrowserOpenMode({}, ['--cdp-url', 'http://127.0.0.1:9222'])).toEqual({
      kind: 'attach',
      browserURL: 'http://127.0.0.1:9222',
    })
    expect(
      resolveBrowserOpenMode({ BROWSER_ENGINE_CDP_URL: 'http://127.0.0.1:9333' }, [
        'node',
        'cli.js',
        '--cdp-url',
        'http://127.0.0.1:9222',
      ]),
    ).toEqual({ kind: 'attach', browserURL: 'http://127.0.0.1:9222' })
  })

  it('treats whitespace-only env as unset and launches', () => {
    expect(resolveBrowserOpenMode({ BROWSER_ENGINE_CDP_URL: '' }, [])).toEqual({ kind: 'launch' })
    expect(resolveBrowserOpenMode({ BROWSER_ENGINE_CDP_URL: '   ' }, [])).toEqual({
      kind: 'launch',
    })
    expect(
      resolveBrowserOpenMode({ BROWSER_ENGINE_CDP_URL: 'http://127.0.0.1:9333' }, [
        '--cdp-url',
        '  ',
      ]),
    ).toEqual({ kind: 'attach', browserURL: 'http://127.0.0.1:9333' })
  })

  it('throws when a present value is not an http(s) URL', () => {
    expect(() => resolveBrowserOpenMode({ BROWSER_ENGINE_CDP_URL: 'not-a-url' }, [])).toThrow(
      INVALID_CDP_URL_MESSAGE,
    )
    expect(() => resolveBrowserOpenMode({ BROWSER_ENGINE_CDP_URL: 'ftp://x' }, [])).toThrow(
      INVALID_CDP_URL_MESSAGE,
    )
    expect(() => resolveBrowserOpenMode({}, ['--cdp-url', 'chrome://inspect'])).toThrow(
      INVALID_CDP_URL_MESSAGE,
    )
    expect(() => resolveBrowserOpenMode({}, ['--cdp-url'])).toThrow(INVALID_CDP_URL_MESSAGE)
  })
})

function recordingBrowser() {
  const calls: string[] = []
  return {
    calls,
    close: async () => {
      calls.push('close')
    },
    disconnect: () => {
      calls.push('disconnect')
    },
  }
}

describe('releaseBrowser', () => {
  it('closes a launched Chrome and never disconnects', async () => {
    const browser = recordingBrowser()
    await releaseBrowser({ kind: 'launch' }, browser)
    expect(browser.calls).toEqual(['close'])
  })

  it('disconnects an attached browser and never closes it', async () => {
    const browser = recordingBrowser()
    await releaseBrowser({ kind: 'attach', browserURL: 'http://127.0.0.1:9222' }, browser)
    expect(browser.calls).toEqual(['disconnect'])
  })

  it('does not close or disconnect when the backend is the extension', async () => {
    const browser = recordingBrowser()
    await releaseBrowser({ kind: 'extension' }, browser)
    expect(browser.calls).toEqual([])
  })
})

describe('openPuppeteerBrowser', () => {
  const launchOpts = puppeteerLaunchOptions(false)
  const fake = recordingBrowser()

  it('connects when the mode is attach and does not launch', async () => {
    const launched: unknown[] = []
    const connected: unknown[] = []
    const opened = await openPuppeteerBrowser(
      { kind: 'attach', browserURL: 'http://127.0.0.1:9222' },
      launchOpts,
      {
        launch: async (opts) => {
          launched.push(opts)
          return fake
        },
        connect: async (opts) => {
          connected.push(opts)
          return fake
        },
      },
    )
    expect(opened).toBe(fake)
    expect(connected).toEqual([{ browserURL: 'http://127.0.0.1:9222' }])
    expect(launched).toEqual([])
  })

  it('launches when the mode is launch and does not connect', async () => {
    const launched: unknown[] = []
    const connected: unknown[] = []
    const opened = await openPuppeteerBrowser({ kind: 'launch' }, launchOpts, {
      launch: async (opts) => {
        launched.push(opts)
        return fake
      },
      connect: async (opts) => {
        connected.push(opts)
        return fake
      },
    })
    expect(opened).toBe(fake)
    expect(launched).toEqual([launchOpts])
    expect(connected).toEqual([])
  })

  it('refuses to open puppeteer when the mode is extension', async () => {
    await expect(
      openPuppeteerBrowser({ kind: 'extension' }, launchOpts, {
        launch: async () => fake,
        connect: async () => fake,
      }),
    ).rejects.toThrow(/does not use puppeteer/)
  })
})
