/**
 * Injected page overlay for the BrowserEngine remote-control HUD.
 *
 * Compiled flat to `extension/hudOverlay.js` and evaluated into the controlled
 * tab over CDP (`Runtime.evaluate` and `Page.addScriptToEvaluateOnNewDocument`).
 * It must stay a plain script: no top-level `import`, `export`, or `require`.
 * Every top-level identifier is prefixed `__beHud` and only
 * `window.__browserEngineHud` is added to the page.
 *
 * This is status chrome only: a hairline viewport frame plus a state pill that
 * says the tab is under remote control. The action cursor, click ripple, and
 * typing hints are drawn by the page-side action HUD (`src/browser/actionHud.ts`),
 * which the engine executes with every action in both backends.
 *
 * The script runs for the current document and for every new document, so it
 * can be evaluated twice in one realm. Only function declarations sit at the
 * top level (redeclaration-safe); all values live inside them, which keeps the
 * `window.__browserEngineHud` guard idempotent instead of throwing on a
 * duplicate `const`.
 */

type __beHudState = 'active' | 'paused' | 'off'

function __beHudAdoptStyles(shadow: ShadowRoot): void {
  // Positioning lives in the stylesheet (including `:host`), never in a style
  // attribute, so strict-CSP pages keep working.
  const css = `
:host {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
}
.__be-hud-root {
  --be-hud-frame: rgba(237, 237, 237, 0.92);
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
.__be-hud-root[data-state='off'] {
  opacity: 0;
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
@media (prefers-color-scheme: light) {
  .__be-hud-root {
    --be-hud-frame: rgba(10, 10, 10, 0.9);
  }
  .__be-hud-pill {
    border-color: #d4d4d4;
    background: rgba(255, 255, 255, 0.96);
    color: #0a0a0a;
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
  const activeText = 'BrowserEngine is controlling this tab — Ctrl+Shift+U to pause'
  const pausedText = 'BrowserEngine paused — Ctrl+Shift+U to resume'

  // Idempotent: a second evaluation of the script is a no-op.
  if (window.__browserEngineHud !== undefined) {
    return
  }

  const host = document.createElement('div')
  host.id = '__be-hud-host'
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
  pill.textContent = activeText

  root.appendChild(frame)
  root.appendChild(pill)
  shadow.appendChild(root)
  document.documentElement.appendChild(host)

  window.__browserEngineHud = {
    setState(state: __beHudState): void {
      root.dataset.state = state
      if (state === 'paused') {
        pill.textContent = pausedText
        return
      }
      if (state === 'active') {
        pill.textContent = activeText
      }
    },
    destroy(): void {
      host.remove()
      delete window.__browserEngineHud
    },
  }
}

__beHudInstall()
