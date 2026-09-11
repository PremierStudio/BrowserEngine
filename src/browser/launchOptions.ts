/** Primary work area used when the OS cannot be probed. */
export const FALLBACK_WORK_AREA: WorkArea = {
  x: 0,
  y: 40,
  width: 1920,
  height: 1040,
}

/** PowerShell that prints primary WorkingArea as x,y,width,height. */
export const WINDOWS_WORK_AREA_COMMAND =
  'Add-Type -AssemblyName System.Windows.Forms; $w = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; Write-Output "$($w.X),$($w.Y),$($w.Width),$($w.Height)"'

export type WorkArea = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Launch decision. `--headed` forces a window even when
 * BROWSER_ENGINE_HEADED=0. Unset defaults to headed so an MCP host that drops
 * the env map still opens a visible Chrome.
 */
export function argvHasHeaded(argv: readonly string[] | undefined): boolean {
  if (argv === undefined) {
    return false
  }
  return argv.includes('--headed')
}

export function headedRequested(
  env: Record<string, string | undefined>,
  argv: readonly string[],
): boolean {
  if (argvHasHeaded(argv)) {
    return true
  }
  return env.BROWSER_ENGINE_HEADED !== '0'
}

/** Left half of the work area: full height, origin unchanged. */
export function leftSnapBounds(work: WorkArea): WorkArea {
  return {
    x: work.x,
    y: work.y,
    width: Math.floor(work.width / 2),
    height: work.height,
  }
}

/** Parse `x,y,width,height`. Rejects empty, malformed, and non-positive sizes. */
export function parseWorkAreaCsv(raw: string | undefined): WorkArea | undefined {
  if (raw === undefined) {
    return undefined
  }
  const parts = raw.split(',')
  if (parts.length > 4) {
    return undefined
  }
  const x = Number(parts[0])
  const y = Number(parts[1])
  const width = Number(parts[2])
  const height = Number(parts[3])
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return undefined
  }
  if (width <= 0 || height <= 0) {
    return undefined
  }
  return { x, y, width, height }
}

/**
 * Env `BROWSER_ENGINE_WORK_AREA` wins, then a host probe (Windows WorkingArea
 * csv), then FALLBACK_WORK_AREA.
 */
export function resolveWorkArea(
  env: Record<string, string | undefined>,
  probed: string | undefined,
): WorkArea {
  return (
    parseWorkAreaCsv(env.BROWSER_ENGINE_WORK_AREA) ?? parseWorkAreaCsv(probed) ?? FALLBACK_WORK_AREA
  )
}

/**
 * Keeps save-password, leak-check, and "weak password" bubbles off the page
 * so headed automation stays visible. Applied on every launch, including MCP.
 */
export const QUIET_CHROME_ARGS: readonly string[] = [
  '--disable-save-password-bubble',
  '--password-store=basic',
  '--disable-features=PasswordLeakDetection,PasswordManagerOnboarding,SafeBrowsingEnhancedProtection',
]

/** Root CI containers cannot use the Chrome sandbox. */
export function sandboxChromeArgs(env: Record<string, string | undefined>): string[] {
  if (env.BROWSER_ENGINE_NO_SANDBOX === '1' || env.CI === 'true') {
    return ['--no-sandbox', '--disable-setuid-sandbox']
  }
  return []
}

function chromeArgs(extra: readonly string[]): string[] {
  const args: string[] = []
  for (const flag of extra) {
    args.push(flag)
  }
  for (const flag of QUIET_CHROME_ARGS) {
    args.push(flag)
  }
  return args
}

export function puppeteerLaunchOptions(
  headed: boolean,
  workArea: WorkArea = FALLBACK_WORK_AREA,
  extraArgs: readonly string[] = [],
): {
  headless: boolean
  defaultViewport: { width: number; height: number } | null
  args: string[]
} {
  if (headed) {
    const snap = leftSnapBounds(workArea)
    return {
      headless: false,
      defaultViewport: null,
      args: chromeArgs([
        `--window-position=${snap.x},${snap.y}`,
        `--window-size=${snap.width},${snap.height}`,
        ...extraArgs,
      ]),
    }
  }
  return {
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: chromeArgs(extraArgs),
  }
}

export type BrowserOpenMode =
  | { readonly kind: 'launch' }
  | { readonly kind: 'attach'; readonly browserURL: string }
  | { readonly kind: 'extension' }

/** Thrown when a CDP URL is present but is not http(s). */
export const INVALID_CDP_URL_MESSAGE = 'cdp url must be an http:// or https:// URL'

function isHttpBrowserUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** Next token after `--cdp-url`, if any. */
function argvCdpUrl(argv: readonly string[]): string | undefined {
  const index = argv.indexOf('--cdp-url')
  if (index < 0) {
    return undefined
  }
  return argv[index + 1]
}

function readCdpUrl(raw: string | undefined, present: boolean): string | undefined {
  if (raw === undefined) {
    if (present) {
      throw new Error(INVALID_CDP_URL_MESSAGE)
    }
    return undefined
  }
  const trimmed = raw.trim()
  if (trimmed === '') {
    return undefined
  }
  if (isHttpBrowserUrl(trimmed) === false) {
    throw new Error(INVALID_CDP_URL_MESSAGE)
  }
  return trimmed
}

/**
 * Launch by default. Attach when `--cdp-url` or BROWSER_ENGINE_CDP_URL is a
 * real http(s) URL. Argv wins. Whitespace-only is unset. Junk throws.
 */
export function resolveBrowserOpenMode(
  env: Record<string, string | undefined>,
  argv: readonly string[],
): BrowserOpenMode {
  const flagPresent = argv.includes('--cdp-url')
  const fromArgv = readCdpUrl(argvCdpUrl(argv), flagPresent)
  if (fromArgv !== undefined) {
    return { kind: 'attach', browserURL: fromArgv }
  }
  const fromEnv = readCdpUrl(env.BROWSER_ENGINE_CDP_URL, false)
  if (fromEnv !== undefined) {
    return { kind: 'attach', browserURL: fromEnv }
  }
  if (argv.includes('--extension') || env.BROWSER_ENGINE_BACKEND === 'extension') {
    return { kind: 'extension' }
  }
  return { kind: 'launch' }
}

export type ConnectedBrowser = {
  close: () => Promise<void>
  disconnect: () => void
}

type BrowserOpenDeps<T extends ConnectedBrowser> = {
  launch: (opts: ReturnType<typeof puppeteerLaunchOptions>) => Promise<T>
  connect: (opts: { browserURL: string }) => Promise<T>
}

/** Launch owns the process so close it. Attach only drops the CDP socket. */
export async function releaseBrowser(
  mode: BrowserOpenMode,
  browser: ConnectedBrowser,
): Promise<void> {
  if (mode.kind === 'attach' || mode.kind === 'extension') {
    if (mode.kind === 'attach') {
      browser.disconnect()
    }
    return
  }
  await browser.close()
}

/** Open via launch or connect. Tests inject both. */
export async function openPuppeteerBrowser<T extends ConnectedBrowser>(
  mode: BrowserOpenMode,
  launchOpts: ReturnType<typeof puppeteerLaunchOptions>,
  deps: BrowserOpenDeps<T>,
): Promise<T> {
  if (mode.kind === 'attach') {
    return deps.connect({ browserURL: mode.browserURL })
  }
  if (mode.kind === 'extension') {
    throw new Error('extension backend does not use puppeteer')
  }
  return deps.launch(launchOpts)
}

/** Reuse the tab launch already opened. Do not call newPage first. */
export async function firstBrowserPage<T>(
  pages: () => Promise<readonly T[]>,
  create: () => Promise<T>,
): Promise<T> {
  const existing = await pages()
  const first = existing[0]
  if (first !== undefined) {
    return first
  }
  return create()
}
