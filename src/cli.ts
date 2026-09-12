#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import net from 'node:net'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import puppeteer from 'puppeteer'
import { exposeFunctionFromUnknown, toPageLikeFromUnknown } from './browser/adaptPage.js'
import type { BrowserController } from './browser/browserDesk.js'
import { createBrowserDesk } from './browser/browserDesk.js'
import { emptyRegistry, serializeRegistry } from './browser/instanceRegistry.js'
import { createChromeTabHost, createRawTabCache, type RawTabPage } from './browser/chromeTabs.js'
import { createManagedDesk, type ChromeSession } from './browser/managedDesk.js'
import { createDomMutationBridge, installMutationObserver } from './browser/domMutations.js'
import { createResizeBridge, installResizeListener } from './browser/resizeBridge.js'
import {
  WINDOWS_WORK_AREA_COMMAND,
  firstBrowserPage,
  headedRequested,
  openPuppeteerBrowser,
  puppeteerLaunchOptions,
  releaseBrowser,
  resolveBrowserOpenMode,
  sandboxChromeArgs,
  resolveWorkArea,
} from './browser/launchOptions.js'
import { adaptPageEventsFromUnknown, combineEventSources } from './browser/pageEvents.js'
import { isPidAlive } from './browser/pidAlive.js'
import { typeCharMs } from './context/actOnPage.js'
import { PuppeteerContextPage, type ContextPage } from './context/ContextPage.js'
import { createRecoveringPage } from './context/recoverPage.js'
import { memoryMutationSource } from './context/waitAfterAction.js'
import { createDeferredEventSource } from './events/deferredSource.js'
import { runFlowToolOptions } from './intent/runFlow.js'
import { runFlowFile } from './intent/runFlowFile.js'
import { defaultClock, defaultSleep } from './intent/watchUntil.js'
import { buildCliMain, buildHttpHandler, runInstallNativeHost } from './protocol/cli.js'
import { executeFlowCli, parseCliCommand } from './protocol/flowCli.js'
import { writeOutputFile } from './protocol/writeOutputFile.js'
import { isHttpArg, listenHttp } from './protocol/httpListen.js'
import { defaultExtensionSocketPath, listenExtensionSocket } from './extension/listen.js'
import { createExtensionTabHost, openExtensionContextPage } from './extension/openSession.js'
import { buildExtensionTools } from './extension/settingsTools.js'

function probeWorkAreaCsv(): string | undefined {
  if (process.platform !== 'win32') {
    return undefined
  }
  try {
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_WORK_AREA_COMMAND],
      { encoding: 'utf8', timeout: 8000, windowsHide: true },
    ).trim()
  } catch {
    return undefined
  }
}

function registryPath(): string {
  const root = process.env.LOCALAPPDATA ?? process.env.USERPROFILE ?? process.env.HOME
  if (root === undefined || root === '') {
    return 'browser-engine-instances.json'
  }
  return join(root, 'browser-engine', 'instances.json')
}

const registryFile = registryPath()
const desk = createBrowserDesk({
  id: `mcp-${String(process.pid)}`,
  mcpPid: process.pid,
  clock: () => Date.now(),
  isAlive: isPidAlive,
  store: {
    read: () => {
      try {
        const raw = readFileSync(registryFile, 'utf8')
        JSON.parse(raw)
        return raw
      } catch {
        return serializeRegistry(emptyRegistry())
      }
    },
    write: (text) => {
      mkdirSync(dirname(registryFile), { recursive: true })
      writeFileSync(registryFile, text, 'utf8')
    },
  },
})

const deferredEvents = createDeferredEventSource()
const headed = headedRequested(process.env, process.argv)
desk.markOpen(undefined, headed, [])

const live: {
  currentContext: ContextPage | undefined
  recovering: ReturnType<typeof createRecoveringPage> | undefined
  managed: BrowserController | undefined
  ext: ReturnType<typeof listenExtensionSocket> | undefined
} = {
  currentContext: undefined,
  recovering: undefined,
  managed: undefined,
  ext: undefined,
}

async function attachPage(raw: unknown): Promise<ContextPage> {
  const like = toPageLikeFromUnknown(raw)
  const mutations = memoryMutationSource()
  const context = new PuppeteerContextPage(like, {
    mutations,
    sleep: defaultSleep,
    typeCharMs: typeCharMs(process.env, process.argv),
  })
  const bridge = createDomMutationBridge()
  await installMutationObserver(
    (script) => like.evaluate(script),
    (name, fn) => exposeFunctionFromUnknown(raw, name, fn),
    (payload) => {
      bridge.ingest(payload)
      mutations.emit()
    },
  )
  const resize = createResizeBridge()
  await installResizeListener(
    (script) => like.evaluate(script),
    (name, fn) => exposeFunctionFromUnknown(raw, name, fn),
    (payload) => {
      resize.ingest(payload)
      void context.noteResize(payload)
    },
  )
  deferredEvents.attach(
    combineEventSources(adaptPageEventsFromUnknown(raw), bridge.source, resize.source),
  )
  live.currentContext = context
  live.recovering?.adopt(context)
  return context
}

async function openLiveSession(): Promise<ChromeSession> {
  const mode = resolveBrowserOpenMode(process.env, process.argv)
  if (mode.kind === 'extension') {
    const ext = live.ext ?? listenExtensionSocket()
    live.ext = ext
    const context = await openExtensionContextPage(ext.bridge)
    live.currentContext = context
    live.recovering?.adopt(context)
    return {
      pid: undefined,
      host: createExtensionTabHost(ext.bridge),
      close: async () => {
        await ext.bridge.request('detach')
        live.currentContext = undefined
        live.recovering?.reset()
      },
    }
  }
  const browser = await openPuppeteerBrowser(
    mode,
    puppeteerLaunchOptions(
      headed,
      resolveWorkArea(process.env, probeWorkAreaCsv()),
      sandboxChromeArgs(process.env),
    ),
    {
      launch: (opts) => puppeteer.launch(opts),
      connect: (opts) => puppeteer.connect(opts),
    },
  )
  const cache = createRawTabCache()
  const rawByWrapped = new Map<RawTabPage, unknown>()
  function wrap(raw: unknown): RawTabPage {
    const wrapped = cache(raw)
    rawByWrapped.set(wrapped, raw)
    return wrapped
  }
  const raw = await firstBrowserPage(
    () => browser.pages(),
    () => browser.newPage(),
  )
  await attachPage(raw)
  const host = createChromeTabHost({
    pages: async () => {
      const listed: RawTabPage[] = []
      for (const page of await browser.pages()) {
        listed.push(wrap(page))
      }
      return listed
    },
    newPage: async () => wrap(await browser.newPage()),
    onActivate: async (page) => {
      const original = rawByWrapped.get(page)
      if (original !== undefined) {
        await attachPage(original)
      }
    },
  })
  const first = (await host.list())[0]
  if (first !== undefined) {
    host.setCurrentId(first.id)
  }
  const child = browser.process()
  const chromePid =
    mode.kind === 'attach' || child === null || child === undefined ? undefined : child.pid
  return {
    pid: chromePid,
    host,
    close: async () => {
      await releaseBrowser(mode, browser)
      live.currentContext = undefined
      live.recovering?.reset()
    },
  }
}

const recovering = createRecoveringPage(async () => {
  const deskHandle = live.managed
  if (deskHandle === undefined) {
    throw new Error('desk not wired')
  }
  await deskHandle.open()
  if (live.currentContext === undefined) {
    throw new Error('launch produced no page')
  }
  return live.currentContext
})
live.recovering = recovering

const controller = createManagedDesk({
  desk,
  headed,
  launch: openLiveSession,
  kill: (pid) => {
    try {
      process.kill(pid)
    } catch {
      // already gone
    }
  },
})
live.managed = controller

process.on('exit', () => {
  desk.markClosed()
})

async function socketHasListener(sockPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(sockPath)
    const finish = (live: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(live)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    setTimeout(() => finish(false), 300)
  })
}

if (resolveBrowserOpenMode(process.env, process.argv).kind === 'extension') {
  const sockPath = process.env.BROWSER_ENGINE_SOCK ?? defaultExtensionSocketPath()
  if (await socketHasListener(sockPath)) {
    process.stderr.write(
      `browser-engine: another engine already owns ${sockPath}.\n` +
        'Stop the other BrowserEngine process, then start this one again.\n',
    )
    process.exit(1)
  }
  live.ext = listenExtensionSocket(sockPath)
}

const options = {
  page: recovering,
  eventSource: deferredEvents.source,
  controller,
  extraTools: live.ext === undefined ? undefined : buildExtensionTools(live.ext.bridge),
}

const command = parseCliCommand(process.argv)
if (command.kind === 'install-native-host') {
  const result = runInstallNativeHost(
    {
      platform: process.platform,
      home: homedir(),
      env: process.env,
      // A global install keeps `extension/` next to `dist/cli.js`, so the
      // package root is one level up from this compiled module.
      extensionRoot: fileURLToPath(new URL('../extension', import.meta.url)),
      exists: existsSync,
      mkdirSync,
      writeFileSync,
      chmodSync,
      execFileSync,
      log: (line) => {
        process.stderr.write(`${line}\n`)
      },
    },
    command.all,
  )
  for (const line of result.lines) {
    process.stdout.write(`${line}\n`)
  }
  process.exit(result.code)
}
if (command.kind === 'compile' || command.kind === 'run' || command.kind === 'usage') {
  const code = await executeFlowCli(command, {
    readFile: (path) => readFileSync(path, 'utf8'),
    writeOut: (line) => {
      process.stdout.write(`${line}\n`)
    },
    writeErr: (line) => {
      process.stderr.write(`${line}\n`)
    },
    writeFile: writeOutputFile,
    runFile:
      command.kind === 'run'
        ? async (file) =>
            runFlowFile(
              recovering,
              file,
              runFlowToolOptions(process.env, defaultSleep, defaultClock),
            )
        : undefined,
  })
  process.exit(code)
}

// The runnable entry point: stdio by default, Streamable HTTP with --http.
if (isHttpArg(process.argv)) {
  const port = Number(process.env.PORT ?? '3333')
  await listenHttp(buildHttpHandler(options), Number.isFinite(port) ? port : 3333)
} else {
  buildCliMain((factory) => serveStdio(factory), options)()
}
