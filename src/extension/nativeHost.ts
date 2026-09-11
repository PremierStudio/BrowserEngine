#!/usr/bin/env node
/**
 * Chrome native-messaging host entry. Kept alive by Chrome while the browser
 * holds stdin; relays stdio frames to the engine Unix socket. All relay logic
 * lives in nativeBridge.ts — this file only wires Node primitives.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import net from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createNativeBridge } from './nativeBridge.js'

const sockPath =
  process.env.BROWSER_ENGINE_SOCK ?? join(homedir(), '.local/share/browser-engine/native.sock')
const logFile = join(homedir(), '.local/share/browser-engine/native-host.log')

function log(line: string): void {
  try {
    mkdirSync(dirname(logFile), { recursive: true })
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // Logging must never take the host down.
  }
}

const bridge = createNativeBridge({
  stdin: process.stdin,
  stdout: process.stdout,
  connect: (path) => net.connect(path),
  sockPath,
  log,
  schedule: (fn, delayMs) => setTimeout(fn, delayMs),
})

process.stdin.on('end', () => {
  bridge.stop()
  process.exit(0)
})
