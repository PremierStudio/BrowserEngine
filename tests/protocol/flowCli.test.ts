import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { saveFlow, serializeFlowFile } from '../../src/intent/flowFile.js'
import type { FlowFile } from '../../src/intent/flowFile.js'
import { cliToken, executeFlowCli, parseCliCommand } from '../../src/protocol/flowCli.js'

describe('cliToken', () => {
  it('turns a missing argv slot into an empty string and keeps real tokens', () => {
    expect(cliToken(undefined)).toBe('')
    expect(cliToken('')).toBe('')
    expect(cliToken('--cdp-url')).toBe('--cdp-url')
    expect(cliToken('flows/a.json')).toBe('flows/a.json')
  })
})

const saved = saveFlow({
  name: 'login',
  steps: [{ action: 'click', name: 'Login', expectText: 'Home' }],
})

function fileText(): string {
  if (!saved.ok) {
    throw new Error('fixture must save')
  }
  return serializeFlowFile(saved.file)
}

describe('parseCliCommand', () => {
  it('defaults to the MCP stdio server', () => {
    expect(parseCliCommand(['node', 'cli.js'])).toEqual({ kind: 'mcp' })
  })

  it('serves Streamable HTTP when asked', () => {
    expect(parseCliCommand(['node', 'cli.js', '--http'])).toEqual({ kind: 'http' })
  })

  it('ignores --headed so MCP and run still launch', () => {
    expect(parseCliCommand(['node', 'cli.js', '--headed'])).toEqual({ kind: 'mcp' })
    expect(parseCliCommand(['node', 'cli.js', '--http', '--headed'])).toEqual({ kind: 'http' })
    expect(parseCliCommand(['node', 'cli.js', 'run', '--headed', 'flows/a.json'])).toEqual({
      kind: 'run',
      path: 'flows/a.json',
      json: false,
      report: undefined,
      junit: undefined,
    })
  })

  it('ignores --cdp-url and its value so MCP and run still parse', () => {
    expect(parseCliCommand(['node', 'cli.js', '--cdp-url'])).toEqual({ kind: 'mcp' })
    expect(parseCliCommand(['node', 'cli.js', '--http', '--cdp-url'])).toEqual({ kind: 'http' })
    expect(parseCliCommand(['node', 'cli.js', '--cdp-url', 'http://127.0.0.1:9222'])).toEqual({
      kind: 'mcp',
    })
    expect(
      parseCliCommand(['node', 'cli.js', '--http', '--cdp-url', 'http://127.0.0.1:9222']),
    ).toEqual({ kind: 'http' })
    expect(
      parseCliCommand([
        'node',
        'cli.js',
        'run',
        '--cdp-url',
        'http://127.0.0.1:9222',
        'flows/a.json',
      ]),
    ).toEqual({
      kind: 'run',
      path: 'flows/a.json',
      json: false,
      report: undefined,
      junit: undefined,
    })
  })

  it('runs or compiles a flow file', () => {
    expect(parseCliCommand(['node', 'cli.js', 'run', 'flows/a.json'])).toEqual({
      kind: 'run',
      path: 'flows/a.json',
      json: false,
      report: undefined,
      junit: undefined,
    })
    expect(parseCliCommand(['node', 'cli.js', 'compile', 'flows/a.json'])).toEqual({
      kind: 'compile',
      path: 'flows/a.json',
      json: false,
      report: undefined,
      junit: undefined,
    })
  })

  it('accepts --json, --report, and --junit around the file path', () => {
    expect(parseCliCommand(['node', 'cli.js', 'run', '--json', 'flows/a.json'])).toEqual({
      kind: 'run',
      path: 'flows/a.json',
      json: true,
      report: undefined,
      junit: undefined,
    })
    expect(
      parseCliCommand([
        'node',
        'cli.js',
        'compile',
        'flows/a.json',
        '--json',
        '--report',
        'out.json',
      ]),
    ).toEqual({
      kind: 'compile',
      path: 'flows/a.json',
      json: true,
      report: 'out.json',
      junit: undefined,
    })
    expect(
      parseCliCommand(['node', 'cli.js', 'run', '--junit', 'report.xml', 'flows/a.json']),
    ).toEqual({
      kind: 'run',
      path: 'flows/a.json',
      json: false,
      report: undefined,
      junit: 'report.xml',
    })
    expect(
      parseCliCommand([
        'node',
        'cli.js',
        'run',
        '--report',
        'out.json',
        '--junit',
        'out.xml',
        'flows/a.json',
      ]),
    ).toEqual({
      kind: 'run',
      path: 'flows/a.json',
      json: false,
      report: 'out.json',
      junit: 'out.xml',
    })
  })

  it('refuses a flag without its path or an unknown flag', () => {
    expect(parseCliCommand(['node', 'cli.js', 'run', '--report'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
    expect(parseCliCommand(['node', 'cli.js', 'run', '--junit', '--json', 'a.json'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
    expect(parseCliCommand(['node', 'cli.js', 'run', '--pretty', 'a.json'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
    expect(parseCliCommand(['node', 'cli.js', 'run', '--pretty'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
    expect(parseCliCommand(['node', 'cli.js', 'run', '--report', '--json', 'a.json'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
    expect(parseCliCommand(['node', 'cli.js', 'compile', '--report', '', 'flows/a.json'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
    expect(parseCliCommand(['node', 'cli.js', 'run', '--json'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
    expect(parseCliCommand(['node', 'cli.js', 'compile', '--report', ''])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
    const sparse: string[] = ['node', 'cli.js', 'run']
    sparse[4] = 'flows/a.json'
    expect(parseCliCommand(sparse)).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
  })

  it('refuses a missing path or leftover args', () => {
    expect(parseCliCommand(['node', 'cli.js', 'run'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
    expect(parseCliCommand(['node', 'cli.js', 'compile'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
    expect(parseCliCommand(['node', 'cli.js', 'run', 'a.json', 'extra'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
    expect(parseCliCommand(['node', 'cli.js', 'wat'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
    expect(parseCliCommand(['node', 'cli.js', 'run', ''])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
  })

  it('parses install-native-host with or without --all', () => {
    expect(parseCliCommand(['node', 'cli.js', 'install-native-host'])).toEqual({
      kind: 'install-native-host',
      all: false,
    })
    expect(parseCliCommand(['node', 'cli.js', 'install-native-host', '--all'])).toEqual({
      kind: 'install-native-host',
      all: true,
    })
  })

  it('refuses unknown install-native-host arguments', () => {
    expect(parseCliCommand(['node', 'cli.js', 'install-native-host', 'extra'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
    expect(parseCliCommand(['node', 'cli.js', 'install-native-host', '--all', '--http'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
  })

  it('keeps --help on the usage path', () => {
    expect(parseCliCommand(['node', 'cli.js', '--help'])).toEqual({
      kind: 'usage',
      error:
        'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    })
  })
})

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'login.flow.json',
)

describe('executeFlowCli', () => {
  it('compiles the checked-in fixture from disk', async () => {
    const lines: string[] = []
    const code = await executeFlowCli(
      { kind: 'compile', path: fixturePath },
      {
        readFile: (path) => readFileSync(path, 'utf8'),
        writeOut: (line) => {
          lines.push(line)
        },
        writeErr: () => undefined,
      },
    )
    expect(code).toBe(0)
    expect(lines.join('\n')).toBe('ok compile name=login steps=3')
  })

  it('compiles a durable file and prints ok', async () => {
    const lines: string[] = []
    const code = await executeFlowCli(
      { kind: 'compile', path: 'flows/login.json' },
      {
        readFile: (path) => {
          expect(path).toBe('flows/login.json')
          return fileText()
        },
        writeOut: (line) => {
          lines.push(line)
        },
        writeErr: () => undefined,
      },
    )
    expect(code).toBe(0)
    expect(lines.join('\n')).toMatch(/ok compile name=login steps=1/)
  })

  it('returns 1 when the file is not durable', async () => {
    const errors: string[] = []
    const code = await executeFlowCli(
      { kind: 'compile', path: 'bad.json' },
      {
        readFile: () => '{"version":1,"name":"x","steps":[{"action":"click","name":"Login"}]}',
        writeOut: () => undefined,
        writeErr: (line) => {
          errors.push(line)
        },
      },
    )
    expect(code).toBe(1)
    expect(errors.join('\n')).toMatch(/requires expectUrl or expectText/)
  })

  it('runs a durable file through the injected runner', async () => {
    const lines: string[] = []
    let ran: FlowFile | undefined
    const code = await executeFlowCli(
      { kind: 'run', path: 'flows/login.json' },
      {
        readFile: () => fileText(),
        writeOut: (line) => {
          lines.push(line)
        },
        writeErr: () => undefined,
        runFile: async (file) => {
          ran = file
          return { ok: true, steps: file.steps.length }
        },
      },
    )
    expect(code).toBe(0)
    expect(ran?.name).toBe('login')
    expect(lines.join('\n')).toMatch(/ok run name=login steps=1/)
  })

  it('returns 1 when the runner throws, with the error text', async () => {
    const errors: string[] = []
    const code = await executeFlowCli(
      { kind: 'run', path: 'flows/login.json' },
      {
        readFile: () => fileText(),
        writeOut: () => undefined,
        writeErr: (line) => {
          errors.push(line)
        },
        runFile: async () => {
          throw 'step 1 click: no target'
        },
      },
    )
    expect(code).toBe(1)
    expect(errors.join('\n')).toBe('step 1 click: no target')
  })

  it('returns 1 when the runner is missing', async () => {
    const errors: string[] = []
    const code = await executeFlowCli(
      { kind: 'run', path: 'flows/login.json' },
      {
        readFile: () => fileText(),
        writeOut: () => undefined,
        writeErr: (line) => {
          errors.push(line)
        },
      },
    )
    expect(code).toBe(1)
    expect(errors.join('\n')).toMatch(/run requires a page/)
    const jsonLines: string[] = []
    const jsonCode = await executeFlowCli(
      { kind: 'run', path: 'flows/login.json', json: true },
      {
        readFile: () => fileText(),
        writeOut: (line) => {
          jsonLines.push(line)
        },
        writeErr: () => undefined,
      },
    )
    expect(jsonCode).toBe(1)
    expect(JSON.parse(jsonLines.join('\n'))).toMatchObject({
      ok: false,
      command: 'run',
      error: 'run requires a page',
    })
  })

  it('returns 1 when the file cannot be read', async () => {
    const errors: string[] = []
    const code = await executeFlowCli(
      { kind: 'compile', path: 'missing.json' },
      {
        readFile: () => {
          throw new Error('ENOENT')
        },
        writeOut: () => undefined,
        writeErr: (line) => {
          errors.push(line)
        },
      },
    )
    expect(code).toBe(1)
    expect(errors.join('\n')).toBe('ENOENT')
  })

  it('does not run mcp through the file command', async () => {
    const errors: string[] = []
    expect(
      await executeFlowCli(
        { kind: 'mcp' },
        {
          readFile: () => {
            throw new Error('should not read')
          },
          writeOut: () => undefined,
          writeErr: (line) => {
            errors.push(line)
          },
        },
      ),
    ).toBe(1)
    expect(errors).toEqual([
      'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    ])
  })

  it('does not run http through the file command', async () => {
    const errors: string[] = []
    expect(
      await executeFlowCli(
        { kind: 'http' },
        {
          readFile: () => {
            throw new Error('should not read')
          },
          writeOut: () => undefined,
          writeErr: (line) => {
            errors.push(line)
          },
        },
      ),
    ).toBe(1)
    expect(errors).toEqual([
      'usage: browser-engine run <file.json> | compile <file.json> | install-native-host [--all] | --http',
    ])
  })

  it('prints usage and returns 1', async () => {
    const errors: string[] = []
    const code = await executeFlowCli(
      { kind: 'usage', error: 'usage: browser-engine run <file.json>' },
      {
        readFile: () => '',
        writeOut: () => undefined,
        writeErr: (line) => {
          errors.push(line)
        },
      },
    )
    expect(code).toBe(1)
    expect(errors.join('\n')).toMatch(/usage: browser-engine run/)
  })

  it('prints a JSON report on stdout when --json is set', async () => {
    const lines: string[] = []
    const code = await executeFlowCli(
      { kind: 'compile', path: 'flows/login.json', json: true },
      {
        readFile: () => fileText(),
        writeOut: (line) => {
          lines.push(line)
        },
        writeErr: () => undefined,
      },
    )
    expect(code).toBe(0)
    expect(JSON.parse(lines.join('\n'))).toEqual({
      ok: true,
      command: 'compile',
      path: 'flows/login.json',
      name: 'login',
      steps: 1,
    })
  })

  it('puts a run step failure into the JSON report', async () => {
    const lines: string[] = []
    const code = await executeFlowCli(
      { kind: 'run', path: 'flows/login.json', json: true },
      {
        readFile: () => fileText(),
        writeOut: (line) => {
          lines.push(line)
        },
        writeErr: () => undefined,
        runFile: async () => {
          throw new Error('step 1 click: no target')
        },
      },
    )
    expect(code).toBe(1)
    expect(JSON.parse(lines.join('\n'))).toEqual({
      ok: false,
      command: 'run',
      path: 'flows/login.json',
      name: 'login',
      error: 'step 1 click: no target',
      failure: { step: 1, action: 'click', message: 'no target' },
    })
  })

  it('writes only a JSON report file when --junit is omitted', async () => {
    const files = new Map<string, string>()
    const code = await executeFlowCli(
      { kind: 'compile', path: 'flows/login.json', json: false, report: 'out.json' },
      {
        readFile: () => fileText(),
        writeOut: () => undefined,
        writeErr: () => undefined,
        writeFile: (path, text) => {
          files.set(path, text)
        },
      },
    )
    expect(code).toBe(0)
    expect([...files.keys()]).toEqual(['out.json'])
  })

  it('writes only a JUnit file when --report is omitted', async () => {
    const files = new Map<string, string>()
    const code = await executeFlowCli(
      { kind: 'compile', path: 'flows/login.json', json: false, junit: 'out.xml' },
      {
        readFile: () => fileText(),
        writeOut: () => undefined,
        writeErr: () => undefined,
        writeFile: (path, text) => {
          files.set(path, text)
        },
      },
    )
    expect(code).toBe(0)
    expect([...files.keys()]).toEqual(['out.xml'])
    expect(files.get('out.xml')).toContain('failures="0"')
  })

  it('writes --report JSON and --junit XML through the injected writer', async () => {
    const files = new Map<string, string>()
    const code = await executeFlowCli(
      {
        kind: 'run',
        path: 'flows/login.json',
        json: false,
        report: 'out.json',
        junit: 'out.xml',
      },
      {
        readFile: () => fileText(),
        writeOut: () => undefined,
        writeErr: () => undefined,
        writeFile: (path, text) => {
          files.set(path, text)
        },
        runFile: async () => ({ ok: true, steps: 1 }),
      },
    )
    expect(code).toBe(0)
    expect(JSON.parse(files.get('out.json') ?? '')).toMatchObject({
      ok: true,
      command: 'run',
      name: 'login',
    })
    expect(files.get('out.xml')).toContain('failures="0"')
    expect(files.get('out.xml')).toContain('name="run login"')
  })

  it('returns 1 when a report file is requested without a writer', async () => {
    const errors: string[] = []
    const code = await executeFlowCli(
      { kind: 'compile', path: 'flows/login.json', json: false, report: 'out.json' },
      {
        readFile: () => fileText(),
        writeOut: () => undefined,
        writeErr: (line) => {
          errors.push(line)
        },
      },
    )
    expect(code).toBe(1)
    expect(errors.join('\n')).toMatch(/file output requires a writer/)
  })
})
