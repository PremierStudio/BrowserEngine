import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../stryker.config.js'

const INCREMENTAL_FILE = 'reports/stryker-incremental.json'
const WORKFLOW = resolve(process.cwd(), '.github/workflows/ci.yml')

describe('stryker speed config (40-minutes-to-40-seconds)', () => {
  it('uses per-test coverage analysis so only covering tests run', () => {
    expect(config.coverageAnalysis).toBe('perTest')
  })

  it('leaves concurrency unset so Stryker uses every CPU core', () => {
    expect(config.concurrency).toBeUndefined()
  })

  it('ignores static mutants that force a full reload and every test', () => {
    expect(config.ignoreStatic).toBe(true)
  })

  it('enables incremental mode and writes the reusable report', () => {
    expect(config.incremental).toBe(true)
    expect(config.incrementalFile).toBe(INCREMENTAL_FILE)
  })

  it('still emits the json report the survivor registry reads', () => {
    expect(config.jsonReporter).toEqual({ fileName: 'reports/mutation.json' })
    expect(config.thresholds).toEqual({ high: 100, low: 100, break: 100 })
  })
})

describe('CI mutation cache', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8')

  it('restores the incremental report before the mutation gate', () => {
    const cacheAt = workflow.indexOf('actions/cache@v4')
    const mutationAt = workflow.indexOf('npm run ci:survivors')
    expect(cacheAt).toBeGreaterThan(-1)
    expect(mutationAt).toBeGreaterThan(cacheAt)
    expect(workflow).toContain(INCREMENTAL_FILE)
  })

  it('keys the cache by commit and falls back to the latest OS report', () => {
    expect(workflow).toContain('stryker-incremental-${{ runner.os }}-${{ github.sha }}')
    expect(workflow).toContain('stryker-incremental-${{ runner.os }}-')
  })

  it('uploads the reports artifact for humans', () => {
    expect(workflow).toContain('actions/upload-artifact@')
  })

  it('runs the local click-go CLI after build', () => {
    expect(workflow).toContain('node dist/testing/clickGoMain.js')
    expect(workflow).toContain("BROWSER_ENGINE_HEADED: '0'")
    expect(workflow).toContain("BROWSER_ENGINE_NO_SANDBOX: '1'")
  })
})
