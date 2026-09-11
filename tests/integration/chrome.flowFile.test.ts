// Enable with BROWSER_ENGINE_INTEGRATION=1
import type { Browser } from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toPageLikeFromUnknown } from '../../src/browser/adaptPage.js'
import { PuppeteerContextPage } from '../../src/context/ContextPage.js'
import { runFlowFile } from '../../src/intent/runFlowFile.js'
import { clickGoFlow, CLICK_GO_HTML } from '../../src/testing/clickGoFixture.js'
import { startLocalHtmlServer } from '../../src/testing/localHtmlServer.js'
import { executeFlowCli } from '../../src/protocol/flowCli.js'

const enabled = process.env.BROWSER_ENGINE_INTEGRATION === '1'

describe.skipIf(!enabled)('chrome flow file', () => {
  let server: Awaited<ReturnType<typeof startLocalHtmlServer>> | undefined
  let browser: Browser | undefined
  let launchError: string | undefined

  beforeAll(async () => {
    server = await startLocalHtmlServer(CLICK_GO_HTML)
    try {
      const puppeteer = (await import('puppeteer')).default
      browser = await puppeteer.launch({ headless: true, timeout: 15000 })
    } catch (error) {
      launchError = error instanceof Error ? error.message : 'puppeteer.launch failed'
    }
  }, 30000)

  afterAll(async () => {
    if (browser !== undefined) {
      await browser.close()
    }
    if (server !== undefined) {
      await server.close()
    }
  }, 15000)

  it('compiles then runs a saved click flow against local HTML', async (ctx) => {
    if (browser === undefined) {
      ctx.skip(launchError ?? 'puppeteer.launch failed')
      return
    }
    if (server === undefined) {
      ctx.skip('local HTML server did not start')
      return
    }
    const saved = { ok: true as const, file: clickGoFlow(server.url) }
    const compiled: string[] = []
    const compileCode = await executeFlowCli(
      { kind: 'compile', path: 'click-go.json', json: false },
      {
        readFile: () => JSON.stringify(saved.file),
        writeOut: (line) => {
          compiled.push(line)
        },
        writeErr: () => undefined,
      },
    )
    expect(compileCode).toBe(0)
    expect(compiled.join('\n')).toMatch(/ok compile name=click-go steps=2/)

    const page = await browser.newPage()
    const context = new PuppeteerContextPage(toPageLikeFromUnknown(page))
    const result = await runFlowFile(context, saved.file)
    expect(result).toEqual({ ok: true, name: 'click-go', steps: 2 })
    expect(await page.title()).toBe('Done')
  }, 30000)
})
