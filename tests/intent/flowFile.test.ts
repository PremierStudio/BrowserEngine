import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BANKING_STEPS } from '../../src/intent/bankingFlow.js'
import {
  FLOW_FILE_VERSION,
  parseFlowFile,
  saveFlow,
  serializeFlowFile,
} from '../../src/intent/flowFile.js'
import { formatStepError } from '../../src/intent/runFlow.js'
import { SHOWCASE_STEPS } from '../../src/intent/showcaseFlow.js'

const valid = {
  name: 'cura-book-hongkong',
  origin: 'https://katalon-demo-cura.herokuapp.com',
  steps: [
    {
      action: 'navigate',
      url: 'https://katalon-demo-cura.herokuapp.com/',
      expectText: 'Make Appointment',
    },
    { action: 'click', name: 'Make Appointment', expectText: 'Username' },
    { action: 'type', name: 'Username', near: 'ThisIsNotAPassword', text: 'John Doe' },
    { action: 'click', name: 'Login', role: 'button', expectUrl: '#appointment' },
    { action: 'check', expectText: 'Facility' },
  ],
}

describe('FLOW_FILE_VERSION', () => {
  it('is 1 so saved files stay on one schema', () => {
    expect(FLOW_FILE_VERSION).toBe(1)
  })
})

describe('saveFlow', () => {
  it('keeps name, origin, and named steps and stamps version 1', () => {
    const result = saveFlow(valid)
    expect(result).toEqual({
      ok: true,
      file: { version: 1, name: valid.name, origin: valid.origin, steps: valid.steps },
    })
  })

  it('does not copy missing optional fields onto a saved step', () => {
    const result = saveFlow({
      name: 'login',
      steps: [{ action: 'click', name: 'Login', expectText: 'Home' }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Object.keys(result.file.steps[0] ?? {}).sort()).toEqual([
        'action',
        'expectText',
        'name',
      ])
      for (const value of Object.values(result.file.steps[0] ?? {})) {
        expect(value).not.toBe(undefined)
      }
    }
  })

  it('strips uids so a saved file cannot depend on a live node id', () => {
    const result = saveFlow({
      name: 'login',
      steps: [{ action: 'click', name: 'Login', uid: 'go', expectText: 'Home' }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.file.steps).toEqual([{ action: 'click', name: 'Login', expectText: 'Home' }])
    }
  })

  it('omits a missing origin', () => {
    const result = saveFlow({ name: 'anon', steps: [] })
    expect(result).toEqual({ ok: true, file: { version: 1, name: 'anon', steps: [] } })
    if (result.ok) {
      expect(result.file).not.toHaveProperty('origin')
    }
  })

  it('keeps internal spaces in the name', () => {
    const result = saveFlow({ name: 'cura  book', steps: [] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.file.name).toBe('cura  book')
    }
  })

  it('trims name and origin', () => {
    const result = saveFlow({ name: '  login  ', origin: '  https://example.com  ', steps: [] })
    expect(result).toEqual({
      ok: true,
      file: { version: 1, name: 'login', origin: 'https://example.com', steps: [] },
    })
  })

  it('omits a blank origin', () => {
    const result = saveFlow({ name: 'anon', origin: '   ', steps: [] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.file.origin).toBeUndefined()
    }
  })

  it('refuses a blank name', () => {
    expect(saveFlow({ name: '', steps: [] })).toEqual({
      ok: false,
      error: 'flow name is required',
    })
    expect(saveFlow({ name: '   ', steps: [] })).toEqual({
      ok: false,
      error: 'flow name is required',
    })
  })

  it('refuses type, hover, scroll, and select without a name', () => {
    expect(saveFlow({ name: 'bad', steps: [{ action: 'type', name: '', text: 'x' }] })).toEqual({
      ok: false,
      error: 'action type requires name',
    })
    expect(saveFlow({ name: 'bad', steps: [{ action: 'type', text: 'x' }] })).toEqual({
      ok: false,
      error: 'action type requires name',
    })
    expect(saveFlow({ name: 'bad', steps: [{ action: 'hover' }] })).toEqual({
      ok: false,
      error: 'action hover requires name',
    })
    expect(saveFlow({ name: 'bad', steps: [{ action: 'scroll', dy: 1 }] })).toEqual({
      ok: false,
      error: 'action scroll requires name',
    })
    expect(saveFlow({ name: 'bad', steps: [{ action: 'select', value: 'a' }] })).toEqual({
      ok: false,
      error: 'action select requires name',
    })
  })

  it('refuses a uid-only click because that cannot replay on a new page', () => {
    const result = saveFlow({
      name: 'bad',
      steps: [{ action: 'click', uid: 'go', expectText: 'Home' }],
    })
    expect(result).toEqual({ ok: false, error: 'action click requires name' })
  })

  it('refuses click and navigate without an expect', () => {
    expect(saveFlow({ name: 'bad', steps: [{ action: 'click', name: 'Login' }] })).toEqual({
      ok: false,
      error: 'action click requires expectUrl or expectText',
    })
    expect(
      saveFlow({
        name: 'bad',
        steps: [{ action: 'navigate', url: 'https://example.com' }],
      }),
    ).toEqual({ ok: false, error: 'action navigate requires expectUrl or expectText' })
  })

  it('allows a check with only expectUrl or only expectText', () => {
    expect(saveFlow({ name: 'ok', steps: [{ action: 'check', expectUrl: '/home' }] }).ok).toBe(true)
    expect(saveFlow({ name: 'ok', steps: [{ action: 'check', expectText: 'Home' }] }).ok).toBe(true)
  })

  it('allows type, hover, scroll, select, and press without an expect', () => {
    const result = saveFlow({
      name: 'ok',
      steps: [
        { action: 'type', name: 'Username', text: 'a' },
        { action: 'hover', name: 'Tip' },
        { action: 'scroll', name: 'List', dy: 40 },
        { action: 'select', name: 'Facility', value: 'Hongkong' },
        { action: 'press', key: 'Enter' },
      ],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      for (const step of result.file.steps) {
        for (const value of Object.values(step)) {
          expect(value).not.toBe(undefined)
        }
      }
    }
  })

  it('refuses press without key, navigate without url, and check without expect', () => {
    expect(saveFlow({ name: 'bad', steps: [{ action: 'press' }] })).toEqual({
      ok: false,
      error: 'action press requires key',
    })
    expect(saveFlow({ name: 'bad', steps: [{ action: 'navigate' }] })).toEqual({
      ok: false,
      error: 'action navigate requires url',
    })
    expect(saveFlow({ name: 'bad', steps: [{ action: 'check' }] })).toEqual({
      ok: false,
      error: 'action check requires expectUrl or expectText',
    })
  })

  it('refuses an unknown action', () => {
    expect(saveFlow({ name: 'bad', steps: [{ action: 'explode' }] })).toEqual({
      ok: false,
      error: 'unknown action: explode',
    })
  })

  it('saves the banking deposit steps', () => {
    const result = saveFlow({ name: 'xyz-deposit', steps: [...BANKING_STEPS] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.file.steps).toHaveLength(BANKING_STEPS.length)
    }
  })

  it('refuses the showcase script because later clicks have no expect', () => {
    const result = saveFlow({ name: 'showcase', steps: [...SHOWCASE_STEPS] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/requires expectUrl or expectText/)
    }
  })
})

describe('parseFlowFile', () => {
  it('round-trips a saved file', () => {
    const saved = saveFlow(valid)
    expect(saved.ok).toBe(true)
    if (!saved.ok) {
      return
    }
    const text = serializeFlowFile(saved.file)
    expect(text).toContain('"version": 1')
    expect(text).not.toContain('"uid"')
    expect(parseFlowFile(text)).toEqual(saved)
    const dir = mkdtempSync(join(tmpdir(), 'ba-flow-'))
    const path = join(dir, 'cura.json')
    writeFileSync(path, text, 'utf8')
    expect(parseFlowFile(readFileSync(path, 'utf8'))).toEqual(saved)
  })

  it('rejects junk JSON and the wrong shape', () => {
    expect(parseFlowFile('nope')).toEqual({ ok: false, error: 'flow file is not valid JSON' })
    expect(parseFlowFile('null')).toEqual({ ok: false, error: 'flow file must be an object' })
    expect(parseFlowFile('[]')).toEqual({ ok: false, error: 'flow file must be an object' })
    expect(parseFlowFile('true')).toEqual({ ok: false, error: 'flow file must be an object' })
    expect(parseFlowFile('5')).toEqual({ ok: false, error: 'flow file must be an object' })
    expect(parseFlowFile('{"version":2,"name":"x","steps":[]}')).toEqual({
      ok: false,
      error: 'unsupported flow version: 2',
    })
    expect(parseFlowFile('{"version":1,"steps":[]}')).toEqual({
      ok: false,
      error: 'flow name is required',
    })
    expect(parseFlowFile('{"version":1,"name":"x"}')).toEqual({
      ok: false,
      error: 'flow steps must be an array',
    })
  })

  it('keeps optional fields and an origin on parse', () => {
    const result = parseFlowFile(
      JSON.stringify({
        version: 1,
        name: 'scroll',
        origin: 'https://example.com',
        steps: [
          {
            action: 'scroll',
            name: 'List',
            role: 'generic',
            near: 'Home',
            text: 'x',
            dx: 1,
            dy: 2,
            value: 'Hongkong',
            key: 'Enter',
            url: 'https://example.com',
            expectUrl: '/x',
            expectText: 'Y',
          },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.file.origin).toBe('https://example.com')
      expect(Object.keys(result.file.steps[0] ?? {}).sort()).toEqual([
        'action',
        'dx',
        'dy',
        'expectText',
        'expectUrl',
        'key',
        'name',
        'near',
        'role',
        'text',
        'url',
        'value',
      ])
      expect(result.file.steps[0]).toEqual({
        action: 'scroll',
        name: 'List',
        role: 'generic',
        near: 'Home',
        text: 'x',
        dx: 1,
        dy: 2,
        value: 'Hongkong',
        key: 'Enter',
        url: 'https://example.com',
        expectUrl: '/x',
        expectText: 'Y',
      })
    }
  })

  it('drops non-string labels and non-finite numbers on parse', () => {
    const result = parseFlowFile(
      JSON.stringify({
        version: 1,
        name: 'x',
        steps: [
          {
            action: 'scroll',
            name: 'List',
            role: 1,
            near: false,
            text: 2,
            dx: '1',
            dy: Number.NaN,
            value: 3,
            key: true,
            url: 4,
            expectUrl: 5,
            expectText: 6,
          },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Object.keys(result.file.steps[0] ?? {}).sort()).toEqual(['action', 'name'])
    }
  })

  it('does not keep a uid on a named parsed step', () => {
    const result = parseFlowFile(
      JSON.stringify({
        version: 1,
        name: 'x',
        steps: [{ action: 'click', name: 'Login', uid: 'go', expectText: 'Home' }],
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.file.steps[0]).not.toHaveProperty('uid')
    }
  })

  it('rejects a step that is not a durable action object', () => {
    expect(parseFlowFile('{"version":1,"name":"x","steps":[null]}')).toEqual({
      ok: false,
      error: 'flow step must be an object',
    })
    expect(parseFlowFile('{"version":1,"name":"x","steps":[{}]}')).toEqual({
      ok: false,
      error: 'flow step requires action',
    })
    expect(parseFlowFile('{"version":1,"name":"x","steps":[{"action":""}]}')).toEqual({
      ok: false,
      error: 'flow step requires action',
    })
    expect(
      parseFlowFile('{"version":1,"name":"x","steps":[{"action":"click","uid":"go"}]}'),
    ).toEqual({ ok: false, error: 'action click requires name' })
  })
})

describe('formatStepError', () => {
  it('numbers steps from 1 and keeps the action', () => {
    expect(formatStepError(0, { action: 'click' }, 'no target')).toBe('step 1 click: no target')
    expect(formatStepError(2, { action: 'navigate' }, 'expectUrl failed')).toBe(
      'step 3 navigate: expectUrl failed',
    )
  })
})
