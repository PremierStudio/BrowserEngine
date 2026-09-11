/**
 * Cross-browser native-messaging host installer for Chromium browsers.
 *
 * Pure decision logic plus dependency-injected filesystem/registry calls, so
 * the whole install matrix is deterministic under test. `src/cli.ts` wires
 * the real `node:*` functions; `src/protocol/cli.ts` formats the summary.
 */

import { posix, win32 } from 'node:path'

/** Chrome extension id pinned by extension/manifest.json's "key". */
export const EXTENSION_ID = 'pofhkiebdcchdedejdniobgfgakllkij'

/** Native-messaging host name shared by every browser manifest. */
export const HOST_NAME = 'ai.premierstudio.browser_engine'

/** One place a native-messaging manifest can be installed. */
export type BrowserTarget =
  | {
      readonly id: string
      readonly label: string
      readonly kind: 'dir'
      readonly dir: string
    }
  | {
      readonly id: string
      readonly label: string
      readonly kind: 'registry'
      readonly key: string
    }

type Env = Record<string, string | undefined>

type DirSpec = {
  readonly id: string
  readonly label: string
  readonly dir: string
}

type RegistrySpec = {
  readonly id: string
  readonly label: string
  readonly key: string
  readonly appDir: string
}

const LINUX_BROWSERS: readonly DirSpec[] = [
  { id: 'google-chrome', label: 'Google Chrome', dir: '.config/google-chrome' },
  { id: 'google-chrome-beta', label: 'Google Chrome Beta', dir: '.config/google-chrome-beta' },
  {
    id: 'google-chrome-unstable',
    label: 'Google Chrome Unstable',
    dir: '.config/google-chrome-unstable',
  },
  { id: 'chromium', label: 'Chromium', dir: '.config/chromium' },
  { id: 'brave', label: 'Brave', dir: '.config/BraveSoftware/Brave-Browser' },
  { id: 'microsoft-edge', label: 'Microsoft Edge', dir: '.config/microsoft-edge' },
  {
    id: 'microsoft-edge-beta',
    label: 'Microsoft Edge Beta',
    dir: '.config/microsoft-edge-beta',
  },
  { id: 'vivaldi', label: 'Vivaldi', dir: '.config/vivaldi' },
  { id: 'opera', label: 'Opera', dir: '.config/opera' },
]

const MACOS_BROWSERS: readonly DirSpec[] = [
  {
    id: 'google-chrome',
    label: 'Google Chrome',
    dir: 'Library/Application Support/Google/Chrome',
  },
  { id: 'chromium', label: 'Chromium', dir: 'Library/Application Support/Chromium' },
  {
    id: 'brave',
    label: 'Brave',
    dir: 'Library/Application Support/BraveSoftware/Brave-Browser',
  },
  {
    id: 'microsoft-edge',
    label: 'Microsoft Edge',
    dir: 'Library/Application Support/Microsoft Edge',
  },
  { id: 'vivaldi', label: 'Vivaldi', dir: 'Library/Application Support/Vivaldi' },
  {
    id: 'opera',
    label: 'Opera',
    dir: 'Library/Application Support/com.operasoftware.Opera',
  },
]

const WINDOWS_BROWSERS: readonly RegistrySpec[] = [
  {
    id: 'google-chrome',
    label: 'Google Chrome',
    key: 'Software\\Google\\Chrome',
    appDir: 'Google\\Chrome',
  },
  { id: 'chromium', label: 'Chromium', key: 'Software\\Chromium', appDir: 'Chromium' },
  {
    id: 'brave',
    label: 'Brave',
    key: 'Software\\BraveSoftware\\Brave-Browser',
    appDir: 'BraveSoftware\\Brave-Browser',
  },
  {
    id: 'microsoft-edge',
    label: 'Microsoft Edge',
    key: 'Software\\Microsoft\\Edge',
    appDir: 'Microsoft\\Edge',
  },
  { id: 'vivaldi', label: 'Vivaldi', key: 'Software\\Vivaldi', appDir: 'Vivaldi' },
  {
    id: 'opera',
    label: 'Opera',
    key: 'Software\\Opera Software\\Opera Stable',
    appDir: 'Opera Software\\Opera Stable',
  },
]

/** Installer switches. `all` writes every known target, detected or not. */
export type InstallOptions = { readonly all?: boolean }

/** What the installer did, by target label. */
export type InstallSummary = {
  readonly installed: string[]
  readonly skipped: string[]
  readonly failed: string[]
  readonly hostPath: string
  readonly manifestPath?: string
}

/** Everything process-shaped the installer touches. Tests inject fakes. */
export type InstallDeps = {
  readonly platform: NodeJS.Platform
  readonly home: string
  readonly env: Env
  readonly extensionRoot: string
  readonly exists: (path: string) => boolean
  readonly mkdirSync: (path: string, options: { recursive: boolean }) => void
  readonly writeFileSync: (path: string, data: string) => void
  readonly chmodSync: (path: string, mode: number) => void
  readonly execFileSync: (file: string, args: string[]) => void
  readonly log: (line: string) => void
}

/** The per-browser launcher: a shell script on POSIX, a batch file on Windows. */
export function resolveHostPath(extensionRoot: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return win32.join(extensionRoot, 'native', 'host.cmd')
  }
  return posix.join(extensionRoot, 'native', 'host.sh')
}

/** Pretty-printed Chrome native-messaging manifest for one host path. */
export function nativeHostManifest(hostPath: string): string {
  return JSON.stringify(
    {
      name: HOST_NAME,
      description: 'BrowserEngine native host',
      path: hostPath,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    },
    null,
    2,
  )
}

/**
 * Every place this machine's browsers read native-messaging manifests from.
 * `exists` probes the browser profile dir; undetected browsers are omitted.
 */
export function browserTargets(
  platform: NodeJS.Platform,
  home: string,
  env: Env,
  exists: (path: string) => boolean,
): BrowserTarget[] {
  if (platform === 'win32') {
    return windowsRegistryTargets(env, exists)
  }
  const specs = platform === 'darwin' ? MACOS_BROWSERS : LINUX_BROWSERS
  const targets: BrowserTarget[] = []
  for (const spec of specs) {
    const base = posix.join(home, spec.dir)
    if (!exists(base)) {
      continue
    }
    targets.push({
      id: spec.id,
      label: spec.label,
      kind: 'dir',
      dir: posix.join(base, 'NativeMessagingHosts'),
    })
  }
  return targets
}

/** Install the host for every detected browser, or every known one with `all`. */
export function installNativeHost(deps: InstallDeps, options: InstallOptions = {}): InstallSummary {
  const hostPath = resolveHostPath(deps.extensionRoot, deps.platform)
  const manifest = nativeHostManifest(hostPath)
  const everyTarget = browserTargets(deps.platform, deps.home, deps.env, () => true)
  const selected =
    options.all === true
      ? everyTarget
      : browserTargets(deps.platform, deps.home, deps.env, deps.exists)
  const selectedIds = new Set<string>()
  for (const target of selected) {
    selectedIds.add(target.id)
  }
  const installed: string[] = []
  const skipped: string[] = []
  const failed: string[] = []
  let manifestPath: string | undefined
  let manifestWritten = false
  for (const target of everyTarget) {
    if (!selectedIds.has(target.id)) {
      skipped.push(target.label)
      continue
    }
    if (target.kind === 'dir') {
      try {
        deps.mkdirSync(target.dir, { recursive: true })
        deps.writeFileSync(posix.join(target.dir, `${HOST_NAME}.json`), manifest)
        // Dir targets only exist on POSIX platforms.
        deps.chmodSync(hostPath, 0o755)
        installed.push(target.label)
        deps.log(`installed ${target.label} -> ${target.dir}`)
      } catch (error) {
        failed.push(target.label)
        deps.log(`failed ${target.label}: ${errorText(error)}`)
      }
      continue
    }
    try {
      const path = registryManifestPath(deps.extensionRoot)
      if (!manifestWritten) {
        deps.writeFileSync(path, manifest)
        manifestWritten = true
      }
      manifestPath = path
      deps.execFileSync('reg', ['add', target.key, '/ve', '/t', 'REG_SZ', '/d', path, '/f'])
      installed.push(target.label)
      deps.log(`installed ${target.label} -> ${target.key}`)
    } catch (error) {
      failed.push(target.label)
      deps.log(`failed ${target.label}: ${errorText(error)}`)
    }
  }
  return { installed, skipped, failed, hostPath, manifestPath }
}

/** Human lines the CLI prints after a run. */
export function formatInstallSummary(summary: InstallSummary): string[] {
  return [
    `installed: ${labelsOrNone(summary.installed)}`,
    `skipped: ${labelsOrNone(summary.skipped)}`,
    `failed: ${labelsOrNone(summary.failed)}`,
    `native host: ${summary.hostPath}`,
    `extension id: ${EXTENSION_ID}`,
    'Load unpacked in chrome://extensions (Developer mode)',
  ]
}

function labelsOrNone(labels: readonly string[]): string {
  if (labels.length === 0) {
    return 'none'
  }
  return labels.join(', ')
}

function appDataRoots(env: Env): string[] {
  const roots: string[] = []
  const local = env.LOCALAPPDATA
  if (local !== undefined) {
    roots.push(local)
  }
  const roaming = env.APPDATA
  if (roaming !== undefined) {
    roots.push(roaming)
  }
  return roots
}

function detectedInRoots(
  roots: readonly string[],
  appDir: string,
  exists: (path: string) => boolean,
): boolean {
  for (const root of roots) {
    if (exists(win32.join(root, appDir))) {
      return true
    }
  }
  return false
}

function windowsRegistryTargets(env: Env, exists: (path: string) => boolean): BrowserTarget[] {
  const roots = appDataRoots(env)
  const targets: BrowserTarget[] = []
  for (const spec of WINDOWS_BROWSERS) {
    if (!detectedInRoots(roots, spec.appDir, exists)) {
      continue
    }
    targets.push({
      id: spec.id,
      label: spec.label,
      kind: 'registry',
      key: win32.join(spec.key, 'NativeMessagingHosts', HOST_NAME),
    })
  }
  return targets
}

function registryManifestPath(extensionRoot: string): string {
  return win32.join(extensionRoot, 'native', `${HOST_NAME}.json`)
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
