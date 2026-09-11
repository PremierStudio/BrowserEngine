# BrowserEngine unpacked extension

Load this folder in Brave. It drives **your** profile (no second Chrome, no `--remote-debugging-port`).

## Surfaces

- **Popup** — host / engine / attach, open cockpit, pause/resume
- **Side panel** — live tabs (filter, open, focus, close), origin chips, pending allow, activity
- **Options tab** — every engine knob, import/export JSON

## Install

1. From the repo: `npm run build:extension` (or `npm run build`) — compiles the extension TypeScript, including `extension/nativeHost.js`, into `extension/`
2. `./extension/install-native-host.sh`
3. `brave://extensions` → Developer mode → **Load unpacked** → this folder
4. Confirm the ID is `pofhkiebdcchdedejdniobgfgakllkij`
5. Open the side panel (toolbar popup → **Open cockpit**, or `Ctrl+Shift+E`)
6. In Grok, `browser-engine` with `BROWSER_ENGINE_BACKEND=extension`, then `/mcps r`

Attach policy defaults to **origin allow-list**. A new host pops the panel; Allow adds it. Kill (`Ctrl+Shift+U`) pauses attach/CDP.

MCP tools: `extension_status`, `extension_get_settings`, `extension_set_settings`, `extension_allow_origin`, `extension_deny_origin`.
