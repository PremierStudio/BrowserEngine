import { describe, expect, it } from 'vitest'
import {
  EXTENSION_ID,
  HOST_NAME,
  browserTargets,
  formatInstallSummary,
  installNativeHost,
  nativeHostManifest,
  resolveHostPath,
  type InstallDeps,
} from '../../src/nativeHost/install.js'

const LINUX_LABELS = [
  'Google Chrome',
  'Google Chrome Beta',
  'Google Chrome Unstable',
  'Chromium',
  'Brave',
  'Microsoft Edge',
  'Microsoft Edge Beta',
  'Vivaldi',
  'Opera',
]

const MACOS_LABELS = ['Google Chrome', 'Chromium', 'Brave', 'Microsoft Edge', 'Vivaldi', 'Opera']

const EXTENSION_ROOT = '/opt/browser-engine/extension'
const HOST_PATH = `${EXTENSION_ROOT}/native/host.sh`
const HOST_FILE = `${HOST_NAME}.json`

const MANIFEST = [
  '{',
  `  "name": "${HOST_NAME}",`,
  '  "description": "BrowserEngine native host",',
  `  "path": "${HOST_PATH}",`,
  '  "type": "stdio",',
  '  "allowed_origins": [',
  `    "chrome-extension://${EXTENSION_ID}/"`,
  '  ]',
  '}',
].join('\n')

type Recorded = {
  mkdirs: Array<{ path: string; options: { recursive: boolean } }>
  writes: Array<{ path: string; data: string }>
  chmods: Array<{ path: string; mode: number }>
  execs: Array<{ file: string; args: string[] }>
  logs: string[]
}

function recordingDeps(overrides: Partial<InstallDeps> = {}): {
  deps: InstallDeps
  recorded: Recorded
} {
  const recorded: Recorded = { mkdirs: [], writes: [], chmods: [], execs: [], logs: [] }
  const deps: InstallDeps = {
    platform: 'linux',
    home: '/home/tester',
    env: {},
    extensionRoot: EXTENSION_ROOT,
    exists: () => false,
    mkdirSync: (path, options) => {
      recorded.mkdirs.push({ path, options })
    },
    writeFileSync: (path, data) => {
      recorded.writes.push({ path, data })
    },
    chmodSync: (path, mode) => {
      recorded.chmods.push({ path, mode })
    },
    execFileSync: (file, args) => {
      recorded.execs.push({ file, args })
    },
    log: (line) => {
      recorded.logs.push(line)
    },
    ...overrides,
  }
  return { deps, recorded }
}

describe('resolveHostPath', () => {
  it('uses host.sh on Linux and macOS', () => {
    expect(resolveHostPath('/opt/browser-engine/extension', 'linux')).toBe(HOST_PATH)
    expect(resolveHostPath('/opt/browser-engine/extension', 'darwin')).toBe(HOST_PATH)
  })

  it('uses host.cmd on Windows', () => {
    expect(resolveHostPath('C:\\opt\\browser-engine\\extension', 'win32')).toBe(
      'C:\\opt\\browser-engine\\extension\\native\\host.cmd',
    )
  })
})

describe('nativeHostManifest', () => {
  it('pretty-prints the native messaging manifest', () => {
    expect(nativeHostManifest(HOST_PATH)).toBe(MANIFEST)
  })

  it('keeps Windows host paths intact as JSON escapes', () => {
    const hostPath = 'C:\\opt\\browser-engine\\extension\\native\\host.cmd'
    expect(JSON.parse(nativeHostManifest(hostPath))).toEqual({
      name: HOST_NAME,
      description: 'BrowserEngine native host',
      path: hostPath,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    })
  })
})

describe('browserTargets', () => {
  it('lists every Linux browser dir with NativeMessagingHosts appended', () => {
    expect(browserTargets('linux', '/home/tester', {}, () => true)).toEqual([
      {
        id: 'google-chrome',
        label: 'Google Chrome',
        kind: 'dir',
        dir: '/home/tester/.config/google-chrome/NativeMessagingHosts',
      },
      {
        id: 'google-chrome-beta',
        label: 'Google Chrome Beta',
        kind: 'dir',
        dir: '/home/tester/.config/google-chrome-beta/NativeMessagingHosts',
      },
      {
        id: 'google-chrome-unstable',
        label: 'Google Chrome Unstable',
        kind: 'dir',
        dir: '/home/tester/.config/google-chrome-unstable/NativeMessagingHosts',
      },
      {
        id: 'chromium',
        label: 'Chromium',
        kind: 'dir',
        dir: '/home/tester/.config/chromium/NativeMessagingHosts',
      },
      {
        id: 'brave',
        label: 'Brave',
        kind: 'dir',
        dir: '/home/tester/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts',
      },
      {
        id: 'microsoft-edge',
        label: 'Microsoft Edge',
        kind: 'dir',
        dir: '/home/tester/.config/microsoft-edge/NativeMessagingHosts',
      },
      {
        id: 'microsoft-edge-beta',
        label: 'Microsoft Edge Beta',
        kind: 'dir',
        dir: '/home/tester/.config/microsoft-edge-beta/NativeMessagingHosts',
      },
      {
        id: 'vivaldi',
        label: 'Vivaldi',
        kind: 'dir',
        dir: '/home/tester/.config/vivaldi/NativeMessagingHosts',
      },
      {
        id: 'opera',
        label: 'Opera',
        kind: 'dir',
        dir: '/home/tester/.config/opera/NativeMessagingHosts',
      },
    ])
  })

  it('detects Linux browsers by their profile dir, not the manifest dir', () => {
    const probed: string[] = []
    const targets = browserTargets('linux', '/home/tester', {}, (path) => {
      probed.push(path)
      return path === '/home/tester/.config/chromium'
    })
    expect(targets).toEqual([
      {
        id: 'chromium',
        label: 'Chromium',
        kind: 'dir',
        dir: '/home/tester/.config/chromium/NativeMessagingHosts',
      },
    ])
    expect(probed).toEqual([
      '/home/tester/.config/google-chrome',
      '/home/tester/.config/google-chrome-beta',
      '/home/tester/.config/google-chrome-unstable',
      '/home/tester/.config/chromium',
      '/home/tester/.config/BraveSoftware/Brave-Browser',
      '/home/tester/.config/microsoft-edge',
      '/home/tester/.config/microsoft-edge-beta',
      '/home/tester/.config/vivaldi',
      '/home/tester/.config/opera',
    ])
  })

  it('lists every macOS browser dir', () => {
    expect(browserTargets('darwin', '/Users/tester', {}, () => true)).toEqual([
      {
        id: 'google-chrome',
        label: 'Google Chrome',
        kind: 'dir',
        dir: '/Users/tester/Library/Application Support/Google/Chrome/NativeMessagingHosts',
      },
      {
        id: 'chromium',
        label: 'Chromium',
        kind: 'dir',
        dir: '/Users/tester/Library/Application Support/Chromium/NativeMessagingHosts',
      },
      {
        id: 'brave',
        label: 'Brave',
        kind: 'dir',
        dir: '/Users/tester/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts',
      },
      {
        id: 'microsoft-edge',
        label: 'Microsoft Edge',
        kind: 'dir',
        dir: '/Users/tester/Library/Application Support/Microsoft Edge/NativeMessagingHosts',
      },
      {
        id: 'vivaldi',
        label: 'Vivaldi',
        kind: 'dir',
        dir: '/Users/tester/Library/Application Support/Vivaldi/NativeMessagingHosts',
      },
      {
        id: 'opera',
        label: 'Opera',
        kind: 'dir',
        dir: '/Users/tester/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts',
      },
    ])
  })

  it('treats other POSIX platforms like Linux', () => {
    const targets = browserTargets('freebsd', '/home/tester', {}, () => true)
    expect(targets.length).toBe(LINUX_LABELS.length)
    expect(targets[0]).toEqual({
      id: 'google-chrome',
      label: 'Google Chrome',
      kind: 'dir',
      dir: '/home/tester/.config/google-chrome/NativeMessagingHosts',
    })
  })

  it('maps detected Windows app dirs under LOCALAPPDATA to HKCU registry keys', () => {
    const local = 'C:\\Users\\tester\\AppData\\Local'
    const targets = browserTargets(
      'win32',
      'C:\\Users\\tester',
      { LOCALAPPDATA: local },
      (path) =>
        path === `${local}\\Google\\Chrome` ||
        path === `${local}\\Chromium` ||
        path === `${local}\\Vivaldi`,
    )
    expect(targets).toEqual([
      {
        id: 'google-chrome',
        label: 'Google Chrome',
        kind: 'registry',
        key: `Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      },
      {
        id: 'chromium',
        label: 'Chromium',
        kind: 'registry',
        key: `Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
      },
      {
        id: 'vivaldi',
        label: 'Vivaldi',
        kind: 'registry',
        key: `Software\\Vivaldi\\NativeMessagingHosts\\${HOST_NAME}`,
      },
    ])
  })

  it('falls back to APPDATA when LOCALAPPDATA is missing', () => {
    const roaming = 'C:\\Users\\tester\\AppData\\Roaming'
    const targets = browserTargets(
      'win32',
      'C:\\Users\\tester',
      { APPDATA: roaming },
      (path) => path === `${roaming}\\Opera Software\\Opera Stable`,
    )
    expect(targets).toEqual([
      {
        id: 'opera',
        label: 'Opera',
        kind: 'registry',
        key: `Software\\Opera Software\\Opera Stable\\NativeMessagingHosts\\${HOST_NAME}`,
      },
    ])
  })

  it('checks both AppData roots when both are present', () => {
    const local = 'C:\\Users\\tester\\AppData\\Local'
    const roaming = 'C:\\Users\\tester\\AppData\\Roaming'
    const targets = browserTargets(
      'win32',
      'C:\\Users\\tester',
      { LOCALAPPDATA: local, APPDATA: roaming },
      (path) =>
        path === `${local}\\Google\\Chrome` || path === `${roaming}\\Opera Software\\Opera Stable`,
    )
    expect(targets).toEqual([
      {
        id: 'google-chrome',
        label: 'Google Chrome',
        kind: 'registry',
        key: `Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      },
      {
        id: 'opera',
        label: 'Opera',
        kind: 'registry',
        key: `Software\\Opera Software\\Opera Stable\\NativeMessagingHosts\\${HOST_NAME}`,
      },
    ])
  })

  it('returns no Windows targets without an AppData root', () => {
    expect(browserTargets('win32', 'C:\\Users\\tester', {}, () => true)).toEqual([])
  })

  it('lists every Windows browser with its HKCU registry key', () => {
    const local = 'C:\\Users\\tester\\AppData\\Local'
    expect(
      browserTargets('win32', 'C:\\Users\\tester', { LOCALAPPDATA: local }, () => true),
    ).toEqual([
      {
        id: 'google-chrome',
        label: 'Google Chrome',
        kind: 'registry',
        key: `Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      },
      {
        id: 'chromium',
        label: 'Chromium',
        kind: 'registry',
        key: `Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
      },
      {
        id: 'brave',
        label: 'Brave',
        kind: 'registry',
        key: `Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`,
      },
      {
        id: 'microsoft-edge',
        label: 'Microsoft Edge',
        kind: 'registry',
        key: `Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
      },
      {
        id: 'vivaldi',
        label: 'Vivaldi',
        kind: 'registry',
        key: `Software\\Vivaldi\\NativeMessagingHosts\\${HOST_NAME}`,
      },
      {
        id: 'opera',
        label: 'Opera',
        kind: 'registry',
        key: `Software\\Opera Software\\Opera Stable\\NativeMessagingHosts\\${HOST_NAME}`,
      },
    ])
  })
})

describe('installNativeHost', () => {
  it('installs manifests for detected Linux browsers and skips the rest', () => {
    const { deps, recorded } = recordingDeps({
      exists: (path) =>
        path === '/home/tester/.config/google-chrome' ||
        path === '/home/tester/.config/BraveSoftware/Brave-Browser',
    })
    const summary = installNativeHost(deps)
    expect(summary).toEqual({
      installed: ['Google Chrome', 'Brave'],
      skipped: [
        'Google Chrome Beta',
        'Google Chrome Unstable',
        'Chromium',
        'Microsoft Edge',
        'Microsoft Edge Beta',
        'Vivaldi',
        'Opera',
      ],
      failed: [],
      hostPath: HOST_PATH,
      manifestPath: undefined,
    })
    expect(recorded.mkdirs).toEqual([
      {
        path: '/home/tester/.config/google-chrome/NativeMessagingHosts',
        options: { recursive: true },
      },
      {
        path: '/home/tester/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts',
        options: { recursive: true },
      },
    ])
    expect(recorded.writes).toEqual([
      {
        path: `/home/tester/.config/google-chrome/NativeMessagingHosts/${HOST_FILE}`,
        data: MANIFEST,
      },
      {
        path: `/home/tester/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/${HOST_FILE}`,
        data: MANIFEST,
      },
    ])
    expect(recorded.chmods).toEqual([
      { path: HOST_PATH, mode: 0o755 },
      { path: HOST_PATH, mode: 0o755 },
    ])
    expect(recorded.execs).toEqual([])
    expect(recorded.logs).toEqual([
      'installed Google Chrome -> /home/tester/.config/google-chrome/NativeMessagingHosts',
      'installed Brave -> /home/tester/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts',
    ])
  })

  it('writes every known Linux target with --all even when nothing is detected', () => {
    const { deps, recorded } = recordingDeps()
    const summary = installNativeHost(deps, { all: true })
    expect(summary.installed).toEqual(LINUX_LABELS)
    expect(summary.skipped).toEqual([])
    expect(summary.failed).toEqual([])
    expect(summary.hostPath).toBe(HOST_PATH)
    expect(summary.manifestPath).toBeUndefined()
    expect(recorded.mkdirs.length).toBe(LINUX_LABELS.length)
    expect(recorded.writes.length).toBe(LINUX_LABELS.length)
    expect(recorded.chmods).toEqual([
      { path: HOST_PATH, mode: 0o755 },
      { path: HOST_PATH, mode: 0o755 },
      { path: HOST_PATH, mode: 0o755 },
      { path: HOST_PATH, mode: 0o755 },
      { path: HOST_PATH, mode: 0o755 },
      { path: HOST_PATH, mode: 0o755 },
      { path: HOST_PATH, mode: 0o755 },
      { path: HOST_PATH, mode: 0o755 },
      { path: HOST_PATH, mode: 0o755 },
    ])
    expect(recorded.logs[recorded.logs.length - 1]).toBe(
      'installed Opera -> /home/tester/.config/opera/NativeMessagingHosts',
    )
  })

  it('installs macOS dirs and chmods the POSIX host script', () => {
    const { deps, recorded } = recordingDeps({
      platform: 'darwin',
      home: '/Users/tester',
      exists: (path) => path === '/Users/tester/Library/Application Support/Google/Chrome',
    })
    const summary = installNativeHost(deps)
    expect(summary.installed).toEqual(['Google Chrome'])
    expect(summary.skipped).toEqual(MACOS_LABELS.slice(1))
    expect(summary.failed).toEqual([])
    expect(summary.hostPath).toBe(HOST_PATH)
    expect(recorded.mkdirs).toEqual([
      {
        path: '/Users/tester/Library/Application Support/Google/Chrome/NativeMessagingHosts',
        options: { recursive: true },
      },
    ])
    expect(recorded.writes).toEqual([
      {
        path: `/Users/tester/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_FILE}`,
        data: MANIFEST,
      },
    ])
    expect(recorded.chmods).toEqual([{ path: HOST_PATH, mode: 0o755 }])
  })

  it('writes one shared manifest and HKCU registry values on Windows', () => {
    const local = 'C:\\Users\\tester\\AppData\\Local'
    const extensionRoot = 'C:\\opt\\browser-engine\\extension'
    const manifestPath = `${extensionRoot}\\native\\${HOST_FILE}`
    const { deps, recorded } = recordingDeps({
      platform: 'win32',
      home: 'C:\\Users\\tester',
      env: { LOCALAPPDATA: local },
      extensionRoot,
      exists: (path) => path === `${local}\\Google\\Chrome` || path === `${local}\\Microsoft\\Edge`,
    })
    const summary = installNativeHost(deps)
    expect(summary).toEqual({
      installed: ['Google Chrome', 'Microsoft Edge'],
      skipped: ['Chromium', 'Brave', 'Vivaldi', 'Opera'],
      failed: [],
      hostPath: `${extensionRoot}\\native\\host.cmd`,
      manifestPath,
    })
    expect(recorded.mkdirs).toEqual([])
    expect(recorded.writes).toEqual([
      {
        path: manifestPath,
        data: nativeHostManifest(`${extensionRoot}\\native\\host.cmd`),
      },
    ])
    expect(recorded.chmods).toEqual([])
    expect(recorded.execs).toEqual([
      {
        file: 'reg',
        args: [
          'add',
          `Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
          '/ve',
          '/t',
          'REG_SZ',
          '/d',
          manifestPath,
          '/f',
        ],
      },
      {
        file: 'reg',
        args: [
          'add',
          `Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
          '/ve',
          '/t',
          'REG_SZ',
          '/d',
          manifestPath,
          '/f',
        ],
      },
    ])
    expect(recorded.logs).toEqual([
      `installed Google Chrome -> Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      `installed Microsoft Edge -> Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
    ])
  })

  it('keeps installing after one dir target fails and reports it', () => {
    const attempted: string[] = []
    const { deps, recorded } = recordingDeps({
      exists: (path) =>
        path === '/home/tester/.config/chromium' || path === '/home/tester/.config/vivaldi',
      mkdirSync: (path) => {
        attempted.push(path)
        if (path === '/home/tester/.config/chromium/NativeMessagingHosts') {
          throw new Error('permission denied')
        }
      },
    })
    const summary = installNativeHost(deps)
    expect(summary.installed).toEqual(['Vivaldi'])
    expect(summary.failed).toEqual(['Chromium'])
    expect(attempted).toEqual([
      '/home/tester/.config/chromium/NativeMessagingHosts',
      '/home/tester/.config/vivaldi/NativeMessagingHosts',
    ])
    expect(recorded.writes).toEqual([
      {
        path: `/home/tester/.config/vivaldi/NativeMessagingHosts/${HOST_FILE}`,
        data: MANIFEST,
      },
    ])
    expect(recorded.logs).toEqual([
      'failed Chromium: permission denied',
      'installed Vivaldi -> /home/tester/.config/vivaldi/NativeMessagingHosts',
    ])
  })

  it('reports a failed dir target when the manifest write throws', () => {
    const { deps, recorded } = recordingDeps({
      exists: (path) => path === '/home/tester/.config/chromium',
      writeFileSync: () => {
        throw new Error('disk full')
      },
    })
    const summary = installNativeHost(deps)
    expect(summary.installed).toEqual([])
    expect(summary.failed).toEqual(['Chromium'])
    expect(recorded.logs).toEqual(['failed Chromium: disk full'])
  })

  it('reports a failed dir target when chmod throws', () => {
    const { deps, recorded } = recordingDeps({
      exists: (path) => path === '/home/tester/.config/chromium',
      chmodSync: () => {
        throw new Error('read-only')
      },
    })
    const summary = installNativeHost(deps)
    expect(summary.installed).toEqual([])
    expect(summary.failed).toEqual(['Chromium'])
    expect(recorded.writes.length).toBe(1)
    expect(recorded.logs).toEqual(['failed Chromium: read-only'])
  })

  it('stringifies a non-Error failure', () => {
    const { deps, recorded } = recordingDeps({
      exists: (path) => path === '/home/tester/.config/chromium',
      writeFileSync: () => {
        throw 'disk full'
      },
    })
    const summary = installNativeHost(deps)
    expect(summary.failed).toEqual(['Chromium'])
    expect(recorded.logs).toEqual(['failed Chromium: disk full'])
  })

  it('retries the shared manifest write for the next registry target', () => {
    const local = 'C:\\Users\\tester\\AppData\\Local'
    const extensionRoot = 'C:\\opt\\browser-engine\\extension'
    const manifestPath = `${extensionRoot}\\native\\${HOST_FILE}`
    let writes = 0
    const { deps, recorded } = recordingDeps({
      platform: 'win32',
      home: 'C:\\Users\\tester',
      env: { LOCALAPPDATA: local },
      extensionRoot,
      exists: (path) =>
        path === `${local}\\Google\\Chrome` || path === `${local}\\BraveSoftware\\Brave-Browser`,
      writeFileSync: () => {
        writes += 1
        if (writes === 1) {
          throw new Error('access denied')
        }
      },
    })
    const summary = installNativeHost(deps)
    expect(writes).toBe(2)
    expect(summary.installed).toEqual(['Brave'])
    expect(summary.failed).toEqual(['Google Chrome'])
    expect(summary.manifestPath).toBe(manifestPath)
    expect(recorded.execs).toEqual([
      {
        file: 'reg',
        args: [
          'add',
          `Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`,
          '/ve',
          '/t',
          'REG_SZ',
          '/d',
          manifestPath,
          '/f',
        ],
      },
    ])
  })

  it('reports a failed registry target when reg add throws', () => {
    const local = 'C:\\Users\\tester\\AppData\\Local'
    const extensionRoot = 'C:\\opt\\browser-engine\\extension'
    const manifestPath = `${extensionRoot}\\native\\${HOST_FILE}`
    const { deps, recorded } = recordingDeps({
      platform: 'win32',
      home: 'C:\\Users\\tester',
      env: { LOCALAPPDATA: local },
      extensionRoot,
      exists: (path) => path === `${local}\\Google\\Chrome`,
      execFileSync: () => {
        throw new Error('reg is not available')
      },
    })
    const summary = installNativeHost(deps)
    expect(summary.installed).toEqual([])
    expect(summary.failed).toEqual(['Google Chrome'])
    expect(summary.manifestPath).toBe(manifestPath)
    expect(recorded.writes).toEqual([
      {
        path: manifestPath,
        data: nativeHostManifest(`${extensionRoot}\\native\\host.cmd`),
      },
    ])
    expect(recorded.logs).toEqual(['failed Google Chrome: reg is not available'])
  })
})

describe('formatInstallSummary', () => {
  it('prints installed, skipped, failed, host, and extension lines', () => {
    expect(
      formatInstallSummary({
        installed: ['Google Chrome', 'Brave'],
        skipped: ['Vivaldi'],
        failed: ['Microsoft Edge'],
        hostPath: HOST_PATH,
      }),
    ).toEqual([
      'installed: Google Chrome, Brave',
      'skipped: Vivaldi',
      'failed: Microsoft Edge',
      `native host: ${HOST_PATH}`,
      `extension id: ${EXTENSION_ID}`,
      'Load unpacked in chrome://extensions (Developer mode)',
    ])
  })

  it('prints none for empty lists', () => {
    expect(
      formatInstallSummary({
        installed: [],
        skipped: [],
        failed: [],
        hostPath: HOST_PATH,
      }),
    ).toEqual([
      'installed: none',
      'skipped: none',
      'failed: none',
      `native host: ${HOST_PATH}`,
      `extension id: ${EXTENSION_ID}`,
      'Load unpacked in chrome://extensions (Developer mode)',
    ])
  })
})
