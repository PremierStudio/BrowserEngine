import { describe, expect, it } from 'vitest'
import {
  buildFlowReport,
  formatHumanLine,
  parseStepFailure,
  serializeFlowReport,
  toJunitXml,
} from '../../src/protocol/flowReport.js'

describe('parseStepFailure', () => {
  it('reads a numbered step, action, and remainder', () => {
    expect(parseStepFailure('step 2 click: no target Login')).toEqual({
      step: 2,
      action: 'click',
      message: 'no target Login',
    })
    expect(parseStepFailure('step 12 type: miss')).toEqual({
      step: 12,
      action: 'type',
      message: 'miss',
    })
    expect(parseStepFailure('step 2 click: no target for click name=Login candidates=')).toEqual({
      step: 2,
      action: 'click',
      message: 'no target for click name=Login candidates=',
    })
    expect(
      parseStepFailure(
        'step 2 click: ambiguous target for click name=Login candidates=button:Login;button:Login',
      ),
    ).toEqual({
      step: 2,
      action: 'click',
      message: 'ambiguous target for click name=Login candidates=button:Login;button:Login',
    })
  })

  it('returns undefined when the line is not a step failure', () => {
    expect(parseStepFailure('ENOENT')).toBeUndefined()
    expect(parseStepFailure('click failed')).toBeUndefined()
    expect(parseStepFailure('step click: missing number')).toBeUndefined()
    expect(parseStepFailure('step 0 click: zero is not a step')).toBeUndefined()
    expect(parseStepFailure('note step 2 click: no target')).toBeUndefined()
  })

  it('keeps an empty remainder after the colon', () => {
    expect(parseStepFailure('step 1 navigate: ')).toEqual({
      step: 1,
      action: 'navigate',
      message: '',
    })
  })
})

describe('buildFlowReport', () => {
  it('keeps compile success fields and omits error', () => {
    expect(
      buildFlowReport({
        ok: true,
        command: 'compile',
        path: 'flows/login.json',
        name: 'login',
        steps: 3,
      }),
    ).toEqual({
      ok: true,
      command: 'compile',
      path: 'flows/login.json',
      name: 'login',
      steps: 3,
    })
    const omitted = buildFlowReport({
      ok: true,
      command: 'compile',
      path: 'flows/login.json',
    })
    expect('name' in omitted).toBe(false)
    expect('steps' in omitted).toBe(false)
    expect('error' in omitted).toBe(false)
    expect('failure' in omitted).toBe(false)
  })

  it('attaches a parsed step failure on a run error', () => {
    expect(
      buildFlowReport({
        ok: false,
        command: 'run',
        path: 'flows/login.json',
        name: 'login',
        error: 'step 2 click: no target',
      }),
    ).toEqual({
      ok: false,
      command: 'run',
      path: 'flows/login.json',
      name: 'login',
      error: 'step 2 click: no target',
      failure: { step: 2, action: 'click', message: 'no target' },
    })
  })

  it('leaves failure off when the error is not a step line', () => {
    const report = buildFlowReport({
      ok: false,
      command: 'compile',
      path: 'bad.json',
      error: 'flow name is required',
    })
    expect(report.failure).toBeUndefined()
    expect('failure' in report).toBe(false)
  })
})

describe('formatHumanLine', () => {
  it('prints ok with the flow name and step count', () => {
    expect(
      formatHumanLine({
        ok: true,
        command: 'compile',
        path: 'flows/login.json',
        name: 'login',
        steps: 3,
      }),
    ).toBe('ok compile name=login steps=3')
  })

  it('falls back to the path and zero steps when those fields are missing', () => {
    expect(formatHumanLine({ ok: true, command: 'run', path: 'anon.json' })).toBe(
      'ok run name=anon.json steps=0',
    )
  })

  it('prints the error, or failed when none is present', () => {
    expect(
      formatHumanLine({
        ok: false,
        command: 'run',
        path: 'a.json',
        error: 'step 1 click: no target',
      }),
    ).toBe('step 1 click: no target')
    expect(formatHumanLine({ ok: false, command: 'run', path: 'a.json' })).toBe('failed')
  })
})

describe('serializeFlowReport', () => {
  it('prints one JSON object and a trailing newline', () => {
    const text = serializeFlowReport({
      ok: true,
      command: 'compile',
      path: 'a.json',
      name: 'a',
      steps: 1,
    })
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual({
      ok: true,
      command: 'compile',
      path: 'a.json',
      name: 'a',
      steps: 1,
    })
  })
})

describe('toJunitXml', () => {
  it('writes a passing testcase named after the command and flow', () => {
    const xml = toJunitXml({
      ok: true,
      command: 'compile',
      path: 'flows/login.json',
      name: 'login',
      steps: 3,
    })
    expect(xml).toContain('tests="1"')
    expect(xml).toContain('failures="0"')
    expect(xml).toContain('name="compile login"')
    expect(xml).toContain('classname="flows/login.json"')
    expect(xml).not.toContain('<failure')
  })

  it('uses the path as the test name when the flow has no name', () => {
    const xml = toJunitXml({
      ok: true,
      command: 'run',
      path: 'flows/anon.json',
    })
    expect(xml).toContain('name="run flows/anon.json"')
  })

  it('writes a failure element and escapes XML markup', () => {
    const xml = toJunitXml({
      ok: false,
      command: 'run',
      path: 'flows/a&b.json',
      name: 'a<b>',
      error: 'step 1 click: want "Login" & got <none>\'s',
    })
    expect(xml).toContain('failures="1"')
    expect(xml).toContain('name="run a&lt;b&gt;"')
    expect(xml).toContain('classname="flows/a&amp;b.json"')
    expect(xml).toContain(
      'message="step 1 click: want &quot;Login&quot; &amp; got &lt;none&gt;&apos;s"',
    )
    expect(xml).toContain('want &quot;Login&quot; &amp; got &lt;none&gt;&apos;s')
  })

  it('uses a generic failed message when error is missing', () => {
    const xml = toJunitXml({
      ok: false,
      command: 'run',
      path: 'x.json',
    })
    expect(xml).toContain('message="failed"')
    expect(xml).toContain('>failed</failure>')
  })
})
