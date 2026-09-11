/** One user-visible action derived from CDP traffic. */
export type HudEvent =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'click'; x: number; y: number }
  | { kind: 'type'; text: string }
  | { kind: 'key'; key: string }
  | { kind: 'scroll'; x: number; y: number; deltaY: number }
  | { kind: 'navigate'; url: string }

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function mouseSignal(type: unknown, x: unknown, y: unknown, deltaY: unknown): HudEvent | undefined {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return undefined
  }
  if (type === 'mouseMoved') {
    return { kind: 'move', x, y }
  }
  if (type === 'mousePressed') {
    return { kind: 'click', x, y }
  }
  if (type === 'mouseWheel') {
    return { kind: 'scroll', x, y, deltaY: isFiniteNumber(deltaY) ? deltaY : 0 }
  }
  return undefined
}

function keySignal(type: unknown, key: unknown, text: unknown): HudEvent | undefined {
  if (type !== 'keyDown' && type !== 'rawKeyDown' && type !== 'char') {
    return undefined
  }
  const pressed = nonEmptyString(key)
  if (pressed !== undefined) {
    return { kind: 'key', key: pressed }
  }
  const typed = nonEmptyString(text)
  if (typed !== undefined) {
    return { kind: 'key', key: typed }
  }
  return undefined
}

function textSignal(text: unknown): HudEvent | undefined {
  return typeof text === 'string' ? { kind: 'type', text } : undefined
}

function navigateSignal(url: unknown): HudEvent | undefined {
  return typeof url === 'string' ? { kind: 'navigate', url } : undefined
}

/** Translate one relayed CDP call into a HUD event, or undefined when malformed. */
export function signalFromCdp(
  method: string,
  params: Record<string, unknown> | undefined,
): HudEvent | undefined {
  const type = params?.type
  const x = params?.x
  const y = params?.y
  const deltaY = params?.deltaY
  const text = params?.text
  const key = params?.key
  const url = params?.url
  if (method === 'Input.dispatchMouseEvent') {
    return mouseSignal(type, x, y, deltaY)
  }
  if (method === 'Input.insertText') {
    return textSignal(text)
  }
  if (method === 'Input.dispatchKeyEvent') {
    return keySignal(type, key, text)
  }
  if (method === 'Page.navigate') {
    return navigateSignal(url)
  }
  return undefined
}
