// Mutation survivor registry checker.
//
// Enforces decision #23 of docs/decisions.md: every mutation that survives
// Stryker MUST be a pre-approved, named entry in `mutation-survivors.json`,
// or the gate fails. The registry is the ONLY escape from the 100% mutation
// gate (mvp.md lines 92-96). An allowlist that is never empty and never
// silently updated is what keeps the gate honest.
//
// Exit codes: 0 = all survivors are pre-approved; 1 = gate violation.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_PATH = resolve(PROJECT_ROOT, 'reports', 'mutation.json')
const REGISTRY_PATH = resolve(PROJECT_ROOT, 'mutation-survivors.json')

function fail(message: string) {
  console.error(`[survivors] ${message}`)
  process.exitCode = 1
}

export interface SurvivorLocation {
  start: { line: number; column: number }
  end: { line: number; column: number }
}

export interface Survivor {
  id: string
  mutatorName: string | null | undefined
  status: string
  location?: SurvivorLocation | null
}

export interface Violation {
  file: string
  id: string | null
  mutator: string | null
  location: string | null
  reason: string
}

export interface EvaluateResult {
  ok: boolean
  violations: Violation[]
  fileCount: number
  mutantCount: number
}

export function locationKey(location: SurvivorLocation): string {
  return `${location.start.line}:${location.start.column}-${location.end.line}:${location.end.column}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isApproved(approvedId: string, survivor: Survivor): boolean {
  if (survivor.mutatorName == null || survivor.mutatorName === '') {
    return false
  }
  if (approvedId === survivor.id) {
    return true
  }
  if (survivor.location == null) {
    return false
  }
  return approvedId === `${survivor.id}@${locationKey(survivor.location)}`
}

export function approvedIdsFor(registry: Record<string, unknown>, fileName: string): string[] {
  const wrapped = registry.files
  const fromFiles = isRecord(wrapped) ? wrapped[fileName] : undefined
  const raw = fromFiles !== undefined ? fromFiles : registry[fileName]
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter((entry): entry is string => typeof entry === 'string')
}

function approveMutant(mutant: Survivor, approvedIds: readonly string[]): boolean {
  for (const approvedId of approvedIds) {
    if (isApproved(approvedId, mutant)) {
      return true
    }
  }
  return false
}

export function evaluateSurvivors(
  report: { files?: Record<string, { mutants?: Survivor[] }> },
  registry: Record<string, unknown>,
): EvaluateResult {
  const violations: Violation[] = []
  let mutantCount = 0
  const files = report.files ?? {}
  for (const [fileName, fileEntry] of Object.entries(files)) {
    const mutants = fileEntry.mutants ?? []
    mutantCount += mutants.length
    const approvedIds = approvedIdsFor(registry, fileName)
    for (const mutant of mutants) {
      if (mutant.status !== 'Survived') {
        continue
      }
      if (approveMutant(mutant, approvedIds)) {
        continue
      }
      violations.push({
        file: fileName,
        id: mutant.id ?? null,
        mutator: mutant.mutatorName ?? null,
        location: mutant.location ? locationKey(mutant.location) : null,
        reason: 'surviving mutant not in the pre-approved survivor registry',
      })
    }
  }
  return {
    ok: violations.length === 0,
    violations,
    fileCount: Object.keys(files).length,
    mutantCount,
  }
}

function main() {
  let report: { files?: Record<string, { mutants?: Survivor[] }> }
  try {
    report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'))
  } catch (error) {
    fail(`cannot read ${REPORT_PATH} (run 'npm run mutation' first): ${String(error)}`)
    return
  }

  let registry: unknown
  try {
    registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
  } catch (error) {
    fail(`cannot read ${REGISTRY_PATH}: ${String(error)}`)
    return
  }
  if (!isRecord(registry)) {
    fail(`${REGISTRY_PATH} must be a JSON object of the form { "files": { "<file>": [<ids>] } }`)
    return
  }

  const result = evaluateSurvivors(report, registry)
  if (!result.ok) {
    fail(`${result.violations.length} surviving mutant(s) not approved in ${REGISTRY_PATH}:`)
    for (const violation of result.violations) {
      console.error(
        `  - ${violation.file} [#${violation.id} ${violation.mutator ?? '?'} @ ${violation.location ?? '?'}] ${violation.reason}`,
      )
    }
    return
  }
  console.log(
    `[survivors] OK — ${result.fileCount} file(s), ${result.mutantCount} mutant(s), 0 survivors unapproved.`,
  )
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (entry === undefined || entry === '') {
    return false
  }
  return fileURLToPath(import.meta.url) === resolve(entry)
}

if (isMainModule()) {
  main()
}
