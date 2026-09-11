/** compile or run, the only commands that emit a flow report. */
export type FlowReportCommand = 'compile' | 'run'

/** A named step miss parsed from `step N action: message`. */
export type StepFailure = {
  step: number
  action: string
  message: string
}

/** Machine-readable result for CI. The caller decides what to do next. */
export type FlowReport = {
  ok: boolean
  command: FlowReportCommand
  path: string
  name?: string
  steps?: number
  error?: string
  failure?: StepFailure
}

/** Pull a numbered step failure out of a human error line. */
export function parseStepFailure(text: string): StepFailure | undefined {
  const match = /^step ([1-9][0-9]*) ([^:\s]+): (.*)/.exec(text)
  if (match === null) {
    return undefined
  }
  return {
    step: Number(match[1]),
    action: String(match[2]),
    message: String(match[3]),
  }
}

/** Build a report, attaching a parsed step failure when the error matches. */
export function buildFlowReport(input: {
  ok: boolean
  command: FlowReportCommand
  path: string
  name?: string
  steps?: number
  error?: string
}): FlowReport {
  const report: FlowReport = {
    ok: input.ok,
    command: input.command,
    path: input.path,
  }
  if (input.name !== undefined) {
    report.name = input.name
  }
  if (input.steps !== undefined) {
    report.steps = input.steps
  }
  if (input.error !== undefined) {
    report.error = input.error
    const failure = parseStepFailure(input.error)
    if (failure !== undefined) {
      report.failure = failure
    }
  }
  return report
}

/** One JSON object plus a trailing newline, for files and logs. */
export function serializeFlowReport(report: FlowReport): string {
  return `${JSON.stringify(report)}\n`
}

/** Human stdout/stderr line when --json is not set. */
export function formatHumanLine(report: FlowReport): string {
  if (report.ok) {
    const name = report.name === undefined ? report.path : report.name
    const steps = report.steps === undefined ? 0 : report.steps
    return `ok ${report.command} name=${name} steps=${String(steps)}`
  }
  if (report.error === undefined) {
    return 'failed'
  }
  return report.error
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** One testcase per flow file. Hosts that already ingest JUnit can upload this. */
export function toJunitXml(report: FlowReport): string {
  const label = report.name === undefined ? report.path : report.name
  const testName = escapeXml(`${report.command} ${label}`)
  const classname = escapeXml(report.path)
  const head = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="browser-engine" tests="1"`
  if (report.ok) {
    return `${head} failures="0">\n  <testcase name="${testName}" classname="${classname}"/>\n</testsuite>\n`
  }
  const message = escapeXml(report.error === undefined ? 'failed' : report.error)
  return `${head} failures="1">\n  <testcase name="${testName}" classname="${classname}">\n    <failure message="${message}">${message}</failure>\n  </testcase>\n</testsuite>\n`
}
