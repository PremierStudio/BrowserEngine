/** Leading marker added to the controlled tab's document title. */
export const TITLE_MARK = '● '

/** Prefix the marker onto a non-empty title that is not already marked. */
export function markTitle(title: string): string {
  if (title === '' || title.startsWith(TITLE_MARK)) {
    return title
  }
  return `${TITLE_MARK}${title}`
}

/** Remove exactly one leading marker, leaving the rest of the title intact. */
export function unmarkTitle(title: string): string {
  if (title.startsWith(TITLE_MARK)) {
    return title.slice(TITLE_MARK.length)
  }
  return title
}

/** Runtime.evaluate source that marks the current document title once. */
export function titleMarkExpression(): string {
  return `(function(){var t=document.title;if(t!==""&&t.indexOf(${JSON.stringify(TITLE_MARK)})!==0){document.title=${JSON.stringify(TITLE_MARK)}+t}})()`
}

/** Runtime.evaluate source that strips one leading mark from the document title. */
export function titleUnmarkExpression(): string {
  return `(function(){var t=document.title;if(t.indexOf(${JSON.stringify(TITLE_MARK)})===0){document.title=t.slice(${JSON.stringify(TITLE_MARK)}.length)}})()`
}
