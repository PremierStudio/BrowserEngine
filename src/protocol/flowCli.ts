import { parseFlowFile, type FlowFile } from '../intent/flowFile.js'
import {
  buildFlowReport,
  formatHumanLine,
  serializeFlowReport,
  toJunitXml,
  type FlowReport,
} from './flowReport.js'

/** How this process was invoked. */
export type CliCommand =
  | { readonly kind: 'mcp' }
  | { readonly kind: 'http' }
  | { readonly kind: 'install-native-host'; readonly all: boolean }
  | {
      readonly kind: 'run'
      readonly path: string
      readonly json?: boolean
      readonly report?: string
      readonly junit?: string
    }
  | {
      readonly kind: 'compile'
      readonly path: string
      readonly json?: boolean
      readonly report?: string
      readonly junit?: string
    }
  | { readonly kind: 'usage'; readonly error: string }

/** Commands executed by the flow runner. The installer has its own runner. */
type FlowCliCommand = Exclude<CliCommand, { kind: 'install-native-host' }>

/** Injected IO so compile/run tests never touch the real filesystem. */
export type FlowCliIo = {
  readFile: (path: string) => string
  writeOut: (line: string) => void
  writeErr: (line: string) => void
  writeFile?: (path: string, text: string) => void
  runFile?: (file: FlowFile) => Promise<{ ok: true; steps: number }>
}

/** Printed when the argv is not mcp, http, run, compile, or install-native-host. */
const FLOW_CLI_USAGE =
  'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http'

type FileCommand = Extract<CliCommand, { kind: 'run' } | { kind: 'compile' }>

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function isFlagValue(value: string | undefined): value is string {
  return value !== undefined && value !== '' && !value.startsWith('--')
}

/** Missing argv slots become an empty token so parse stays defined. */
export function cliToken(value: string | undefined): string {
  if (value === undefined) {
    return ''
  }
  return value
}

function parseFileCommand(kind: 'run' | 'compile', rest: readonly string[]): CliCommand {
  let json = false
  let report: string | undefined
  let junit: string | undefined
  let path: string | undefined
  const args = [...rest]
  while (args.length > 0) {
    const arg = cliToken(args.shift())
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--report') {
      const next = args.shift()
      if (!isFlagValue(next)) {
        return { kind: 'usage', error: FLOW_CLI_USAGE }
      }
      report = next
      continue
    }
    if (arg === '--junit') {
      const next = args.shift()
      if (!isFlagValue(next)) {
        return { kind: 'usage', error: FLOW_CLI_USAGE }
      }
      junit = next
      continue
    }
    if (arg.startsWith('--') || path !== undefined || arg === '') {
      return { kind: 'usage', error: FLOW_CLI_USAGE }
    }
    path = arg
  }
  if (path === undefined) {
    return { kind: 'usage', error: FLOW_CLI_USAGE }
  }
  return { kind, path, json, report, junit }
}

function parseInstallCommand(rest: readonly string[]): CliCommand {
  let all = false
  for (const arg of rest) {
    if (arg === '--all') {
      all = true
      continue
    }
    return { kind: 'usage', error: FLOW_CLI_USAGE }
  }
  return { kind: 'install-native-host', all }
}

function withoutEngineFlags(argv: readonly string[]): string[] {
  const kept: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--headed') {
      continue
    }
    if (arg === '--cdp-url') {
      i += 1
      continue
    }
    kept.push(cliToken(arg))
  }
  return kept
}

/** Read process.argv after node and the script path. */
export function parseCliCommand(argv: readonly string[]): CliCommand {
  const args = withoutEngineFlags(argv).slice(2)
  const head = args[0]
  if (head === 'run' || head === 'compile') {
    return parseFileCommand(head, args.slice(1))
  }
  if (head === 'install-native-host') {
    return parseInstallCommand(args.slice(1))
  }
  if (args.includes('--http')) {
    return { kind: 'http' }
  }
  if (args.length === 0) {
    return { kind: 'mcp' }
  }
  return { kind: 'usage', error: FLOW_CLI_USAGE }
}

function writeArtifacts(
  command: FileCommand,
  report: FlowReport,
  io: FlowCliIo,
): string | undefined {
  if (command.report === undefined && command.junit === undefined) {
    return undefined
  }
  if (io.writeFile === undefined) {
    return 'file output requires a writer'
  }
  if (command.report !== undefined) {
    io.writeFile(command.report, serializeFlowReport(report))
  }
  if (command.junit !== undefined) {
    io.writeFile(command.junit, toJunitXml(report))
  }
  return undefined
}

function publish(command: FileCommand, report: FlowReport, io: FlowCliIo): number {
  if (command.json === true) {
    io.writeOut(JSON.stringify(report))
  } else if (report.ok) {
    io.writeOut(formatHumanLine(report))
  } else {
    io.writeErr(formatHumanLine(report))
  }
  const artifactError = writeArtifacts(command, report, io)
  if (artifactError !== undefined) {
    io.writeErr(artifactError)
    return 1
  }
  if (report.ok) {
    return 0
  }
  return 1
}

/** Compile or run a flow file. MCP, HTTP, and the installer have their own paths. */
export async function executeFlowCli(command: FlowCliCommand, io: FlowCliIo): Promise<number> {
  if (command.kind === 'mcp' || command.kind === 'http') {
    io.writeErr(FLOW_CLI_USAGE)
    return 1
  }
  if (command.kind === 'usage') {
    io.writeErr(command.error)
    return 1
  }
  let text: string
  try {
    text = io.readFile(command.path)
  } catch (error) {
    return publish(
      command,
      buildFlowReport({
        ok: false,
        command: command.kind,
        path: command.path,
        error: errorMessage(error),
      }),
      io,
    )
  }
  const parsed = parseFlowFile(text)
  if (!parsed.ok) {
    return publish(
      command,
      buildFlowReport({
        ok: false,
        command: command.kind,
        path: command.path,
        error: parsed.error,
      }),
      io,
    )
  }
  if (command.kind === 'compile') {
    return publish(
      command,
      buildFlowReport({
        ok: true,
        command: 'compile',
        path: command.path,
        name: parsed.file.name,
        steps: parsed.file.steps.length,
      }),
      io,
    )
  }
  const runFile = io.runFile
  if (runFile === undefined) {
    return publish(
      command,
      buildFlowReport({
        ok: false,
        command: 'run',
        path: command.path,
        name: parsed.file.name,
        error: 'run requires a page',
      }),
      io,
    )
  }
  try {
    const result = await runFile(parsed.file)
    return publish(
      command,
      buildFlowReport({
        ok: true,
        command: 'run',
        path: command.path,
        name: parsed.file.name,
        steps: result.steps,
      }),
      io,
    )
  } catch (error) {
    return publish(
      command,
      buildFlowReport({
        ok: false,
        command: 'run',
        path: command.path,
        name: parsed.file.name,
        error: errorMessage(error),
      }),
      io,
    )
  }
}
