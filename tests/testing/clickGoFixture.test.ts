import { describe, expect, it } from 'vitest'
import { parseFlowFile } from '../../src/intent/flowFile.js'
import { CLICK_GO_HTML, clickGoFlow, clickGoFlowJson } from '../../src/testing/clickGoFixture.js'

describe('clickGoFixture', () => {
  it('serves a Start page with a Go button that flips to Done', () => {
    expect(CLICK_GO_HTML).toMatch(/<h1>Start<\/h1>/)
    expect(CLICK_GO_HTML).toMatch(/<button type="button" id="go">Go<\/button>/)
    expect(CLICK_GO_HTML).toMatch(/textContent="Done"/)
  })

  it('builds a durable two-step flow against the given origin', () => {
    const origin = 'http://127.0.0.1:4321/'
    const file = clickGoFlow(origin)
    expect(file).toEqual({
      version: 1,
      name: 'click-go',
      origin,
      steps: [
        { action: 'navigate', url: origin, expectText: 'Start' },
        { action: 'click', name: 'Go', expectText: 'Done' },
      ],
    })
    expect(parseFlowFile(clickGoFlowJson(origin))).toEqual({ ok: true, file })
  })
})
