#!/usr/bin/env node
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { clickGoFlowJson, CLICK_GO_HTML } from './clickGoFixture.js'
import { startLocalHtmlServer } from './localHtmlServer.js'

/** Start local HTML, write the flow, and run the built CLI against it. */
export async function runClickGoCli(cliJs: string): Promise<number> {
  const server = await startLocalHtmlServer(CLICK_GO_HTML)
  const dir = mkdtempSync(join(tmpdir(), 'browser-engine-click-go-'))
  const flowPath = join(dir, 'click-go.flow.json')
  writeFileSync(flowPath, clickGoFlowJson(server.url), 'utf8')
  try {
    return await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [cliJs, 'run', flowPath, '--report', join(dir, 'report.json')],
        {
          env: { ...process.env, BROWSER_ENGINE_HEADED: '0' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      child.stdout.on('data', (chunk: Buffer) => {
        process.stdout.write(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        process.stderr.write(chunk)
      })
      child.on('error', () => {
        resolve(1)
      })
      child.on('close', (status) => {
        resolve(status === null ? 1 : status)
      })
    })
  } finally {
    await server.close()
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (entry === undefined || entry === '') {
    return false
  }
  return fileURLToPath(import.meta.url) === resolve(entry)
}

if (isMainModule()) {
  const cliJs = resolve('dist/cli.js')
  const code = await runClickGoCli(cliJs)
  process.exit(code)
}
