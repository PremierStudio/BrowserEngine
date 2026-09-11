/**
 * Injected page overlay for the BrowserEngine remote-control HUD.
 *
 * This module is compiled flat to `extension/hudOverlay.js` and evaluated into
 * the controlled tab over CDP (`Runtime.evaluate` and
 * `Page.addScriptToEvaluateOnNewDocument`). It must therefore stay a plain
 * script: no top-level `import`, `export`, or `require`. Every top-level
 * identifier is prefixed `__beHud` so the page's global scope stays
 * collision-free, and `window.__browserEngineHud` is the only global it adds.
 *
 * The script runs both for the current document and for every new document, so
 * it can be evaluated twice in one realm. Only function declarations sit at the
 * top level (redeclaration-safe); all values live inside them, which keeps the
 * `window.__browserEngineHud` guard idempotent instead of throwing on a
 * duplicate `const`.
 */

type __beHudState = 'active' | 'paused' | 'off'

function __beHudIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false
}

function __beHudIsNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// Prefer a constructable stylesheet on the shadow root; fall back to a <style>
// element on engines that lack `adoptedStyleSheets`.
function __beHudAdoptStyles(shadow: ShadowRoot): void {
  // Positioning lives in the stylesheet (including `:host`), never in a style
  // attribute on the host, so strict-CSP pages keep working. Dynamic
  // coordinates are written through the CSSOM (`element.style`), which CSP does
  // not block.
  const css = `
:host {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
}
.__be-hud-root {
  --be-hud-frame: rgba(237, 237, 237, 0.92);
  --be-hud-action: #3291ff;
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  opacity: 1;
  transition: opacity 320ms ease;
}
.__be-hud-root[data-state='paused'] {
  --be-hud-frame: #f5a623;
}
.__be-hud-frame {
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 0 1.5px var(--be-hud-frame);
}
.__be-hud-pill {
  position: absolute;
  top: 10px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100vw - 24px);
  padding: 6px 10px;
  border: 1px solid #2e2e2e;
  border-radius: 8px;
  background: rgba(10, 10, 10, 0.96);
  color: #ededed;
  font-size: 12px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.__be-hud-hint {
  color: #a1a1a1;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
}
.__be-hud-hint:empty {
  display: none;
}
.__be-hud-cursor {
  position: absolute;
  left: 0;
  top: 0;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.8);
  transform: translate3d(0, 0, 0);
  transition: transform 160ms ease-out;
  pointer-events: none;
  will-change: transform;
}
.__be-hud-cursor.__be-hud-pulse {
  animation: __be-hud-pulse 420ms ease-out;
}
.__be-hud-ripple {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  transform: translate3d(0, 0, 0);
  pointer-events: none;
}
.__be-hud-ripple-ring {
  position: absolute;
  left: -5px;
  top: -5px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--be-hud-action);
  opacity: 0;
  pointer-events: none;
}
.__be-hud-ripple-ring.__be-hud-on {
  animation: __be-hud-ripple 480ms ease-out;
}
@keyframes __be-hud-pulse {
  0% {
    box-shadow:
      0 0 0 1.5px rgba(0, 0, 0, 0.8),
      0 0 0 0 rgba(50, 145, 255, 0.55);
  }
  100% {
    box-shadow:
      0 0 0 1.5px rgba(0, 0, 0, 0.8),
      0 0 0 14px rgba(50, 145, 255, 0);
  }
}
@keyframes __be-hud-ripple {
  0% {
    transform: scale(0.4);
    opacity: 0.95;
  }
  100% {
    transform: scale(5);
    opacity: 0;
  }
}
@media (prefers-color-scheme: light) {
  .__be-hud-root {
    --be-hud-frame: rgba(10, 10, 10, 0.9);
  }
  .__be-hud-cursor {
    background: #0a0a0a;
    box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.9);
  }
  .__be-hud-pill {
    border-color: #d4d4d4;
    background: rgba(255, 255, 255, 0.96);
    color: #0a0a0a;
  }
  .__be-hud-hint {
    color: #666666;
  }
}
`
  if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in shadow) {
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(css)
      shadow.adoptedStyleSheets = [sheet]
      return
    } catch {
      // Constructing or adopting the sheet failed: use the <style> fallback.
    }
  }
  const style = document.createElement('style')
  style.textContent = css
  shadow.appendChild(style)
}

function __beHudInstall(): void {
  const hostId = '__be-hud-host'
  const activeText = 'BrowserEngine is controlling this tab — Ctrl+Shift+U to pause'
  const pausedText = 'BrowserEngine paused — Ctrl+Shift+U to resume'

  // Idempotent: a second evaluation of the script is a no-op.
  if (window.__browserEngineHud !== undefined) {
    return
  }

  const host = document.createElement('div')
  host.id = hostId
  host.setAttribute('aria-hidden', 'true')
  const shadow = host.attachShadow({ mode: 'open' })
  __beHudAdoptStyles(shadow)

  const root = document.createElement('div')
  root.className = '__be-hud-root'
  root.dataset.state = 'active'

  const frame = document.createElement('div')
  frame.className = '__be-hud-frame'

  const pill = document.createElement('div')
  pill.className = '__be-hud-pill'
  const pillState = document.createElement('span')
  pillState.className = '__be-hud-state'
  pillState.textContent = activeText
  const pillHint = document.createElement('span')
  pillHint.className = '__be-hud-hint'
  pill.appendChild(pillState)
  pill.appendChild(pillHint)

  const cursor = document.createElement('div')
  cursor.className = '__be-hud-cursor'

  const ripple = document.createElement('div')
  ripple.className = '__be-hud-ripple'
  const rippleRing = document.createElement('div')
  rippleRing.className = '__be-hud-ripple-ring'
  ripple.appendChild(rippleRing)

  root.appendChild(frame)
  root.appendChild(cursor)
  root.appendChild(ripple)
  root.appendChild(pill)
  shadow.appendChild(root)
  document.documentElement.appendChild(host)

  let hintTimer: number | undefined
  let rippleTimer: number | undefined
  let pulseTimer: number | undefined

  const clearHint = (): void => {
    if (hintTimer !== undefined) {
      window.clearTimeout(hintTimer)
      hintTimer = undefined
    }
    pillHint.textContent = ''
  }

  const showHint = (text: string): void => {
    clearHint()
    pillHint.textContent = text
    hintTimer = window.setTimeout(() => {
      hintTimer = undefined
      pillHint.textContent = ''
    }, 900)
  }

  const place = (el: HTMLDivElement, x: number, y: number): void => {
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  const fireRipple = (): void => {
    if (rippleTimer !== undefined) {
      window.clearTimeout(rippleTimer)
    }
    rippleRing.classList.remove('__be-hud-on')
    void rippleRing.offsetWidth
    rippleRing.classList.add('__be-hud-on')
    rippleTimer = window.setTimeout(() => {
      rippleTimer = undefined
      rippleRing.classList.remove('__be-hud-on')
    }, 520)
  }

  const pulseCursor = (): void => {
    if (pulseTimer !== undefined) {
      window.clearTimeout(pulseTimer)
    }
    cursor.classList.remove('__be-hud-pulse')
    void cursor.offsetWidth
    cursor.classList.add('__be-hud-pulse')
    pulseTimer = window.setTimeout(() => {
      pulseTimer = undefined
      cursor.classList.remove('__be-hud-pulse')
    }, 460)
  }

  const truncate = (text: string): string => (text.length > 24 ? `${text.slice(0, 24)}…` : text)

  const handle = (event: unknown): void => {
    if (__beHudIsRecord(event) === false) {
      return
    }
    const kind = event.kind
    if (kind === 'move') {
      if (__beHudIsNumber(event.x) && __beHudIsNumber(event.y)) {
        place(cursor, event.x, event.y)
      }
      return
    }
    if (kind === 'click') {
      if (__beHudIsNumber(event.x) && __beHudIsNumber(event.y)) {
        place(cursor, event.x, event.y)
        place(ripple, event.x, event.y)
        fireRipple()
      }
      return
    }
    if (kind === 'type') {
      if (typeof event.text === 'string') {
        pulseCursor()
        showHint(`typing: ${truncate(event.text)}`)
      }
      return
    }
    if (kind === 'key') {
      if (typeof event.key === 'string') {
        showHint(`key: ${truncate(event.key)}`)
      }
      return
    }
    if (kind === 'scroll') {
      if (__beHudIsNumber(event.x) && __beHudIsNumber(event.y)) {
        place(cursor, event.x, event.y)
        place(ripple, event.x, event.y)
      }
      if (__beHudIsNumber(event.deltaY)) {
        const arrow = event.deltaY > 0 ? '↓' : event.deltaY < 0 ? '↑' : '↕'
        showHint(`${arrow} scroll`)
      }
      return
    }
    if (kind === 'navigate') {
      if (typeof event.url === 'string') {
        clearHint()
        const x = window.innerWidth / 2
        const y = window.innerHeight / 2
        place(cursor, x, y)
        place(ripple, x, y)
      }
      return
    }
  }

  const setState = (state: __beHudState): void => {
    if (state === 'off') {
      root.style.opacity = '0'
      return
    }
    root.dataset.state = state
    pillState.textContent = state === 'paused' ? pausedText : activeText
    root.style.opacity = '1'
  }

  const destroy = (): void => {
    clearHint()
    if (rippleTimer !== undefined) {
      window.clearTimeout(rippleTimer)
      rippleTimer = undefined
    }
    if (pulseTimer !== undefined) {
      window.clearTimeout(pulseTimer)
      pulseTimer = undefined
    }
    host.remove()
    delete window.__browserEngineHud
  }

  window.__browserEngineHud = { handle, setState, destroy }
}

__beHudInstall()
