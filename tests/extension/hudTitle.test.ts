import { describe, expect, it } from 'vitest'
import {
  TITLE_MARK,
  markTitle,
  titleMarkExpression,
  titleUnmarkExpression,
  unmarkTitle,
} from '../../src/extension/hudTitle.js'

function runOnTitle(expression: string, title: string): string {
  const page = { title }
  const evaluate = new Function('document', `return ${expression}`)
  evaluate.call(undefined, page)
  return page.title
}

describe('TITLE_MARK', () => {
  it('is a bullet followed by a space', () => {
    expect(TITLE_MARK).toBe('● ')
    expect(TITLE_MARK.length).toBe(2)
  })
})

describe('markTitle', () => {
  it('leaves an empty title empty', () => {
    expect(markTitle('')).toBe('')
  })

  it('leaves an already marked title untouched', () => {
    expect(markTitle('● ')).toBe('● ')
    expect(markTitle('● Docs')).toBe('● Docs')
  })

  it('prefixes the mark onto an unmarked title', () => {
    expect(markTitle('Docs')).toBe('● Docs')
    expect(markTitle('●')).toBe('● ●')
    expect(markTitle('  padded  ')).toBe('●   padded  ')
  })
})

describe('unmarkTitle', () => {
  it('strips exactly one leading mark', () => {
    expect(unmarkTitle('● Docs')).toBe('Docs')
    expect(unmarkTitle('● ● Docs')).toBe('● Docs')
    expect(unmarkTitle('● ')).toBe('')
  })

  it('leaves titles without a leading mark untouched', () => {
    expect(unmarkTitle('Docs')).toBe('Docs')
    expect(unmarkTitle('')).toBe('')
    expect(unmarkTitle('●')).toBe('●')
  })
})

describe('title expressions', () => {
  it('pins the mark expression source', () => {
    expect(titleMarkExpression()).toBe(
      '(function(){var t=document.title;if(t!==""&&t.indexOf("● ")!==0){document.title="● "+t}})()',
    )
  })

  it('pins the unmark expression source', () => {
    expect(titleUnmarkExpression()).toBe(
      '(function(){var t=document.title;if(t.indexOf("● ")===0){document.title=t.slice("● ".length)}})()',
    )
  })

  it('marks only a non-empty, unmarked document title', () => {
    const mark = titleMarkExpression()
    expect(runOnTitle(mark, 'Docs')).toBe('● Docs')
    expect(runOnTitle(mark, '')).toBe('')
    expect(runOnTitle(mark, '● Docs')).toBe('● Docs')
  })

  it('unmarks exactly one leading document title mark', () => {
    const unmark = titleUnmarkExpression()
    expect(runOnTitle(unmark, '● Docs')).toBe('Docs')
    expect(runOnTitle(unmark, 'Docs')).toBe('Docs')
    expect(runOnTitle(unmark, '')).toBe('')
    expect(runOnTitle(unmark, '● ● Docs')).toBe('● Docs')
  })
})
