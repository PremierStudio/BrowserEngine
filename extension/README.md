# BrowserEngine unpacked extension

Load this folder in any Chromium-based browser (Chrome, Chromium, Brave, Edge,
Vivaldi, Opera). It drives **your** profile: no second browser, no
`--remote-debugging-port`, no logged-out session.

## Surfaces

- **Popup** — host / engine / attach, open cockpit, pause/resume
- **Cockpit** — side panel where the browser supports it, otherwise a normal
  tab (live tabs, filter, origin chips, pending allow, activity)
- **Options tab** — every engine knob, import/export JSON

## Install

1. Build the engine and extension from a source checkout:
   `npm install && npm run build`
2. Install the native-messaging host for every browser detected on this
   machine:

   ```bash
   npx @premierstudio/browser-engine install-native-host
   ```

   From the checkout itself: `node dist/cli.js install-native-host`.
   Add `--all` to write manifests for every known browser, even ones whose
   profile was not detected. On Windows the installer writes the registry
   keys under `HKCU` for you.

3. Open the extensions page and load this folder as an **unpacked** extension
   (Developer mode):

   | Browser         | Extensions page        |
   | --------------- | ---------------------- |
   | Chrome/Chromium | `chrome://extensions`  |
   | Brave           | `brave://extensions`   |
   | Edge            | `edge://extensions`    |
   | Vivaldi         | `vivaldi://extensions` |
   | Opera           | `opera://extensions`   |

4. Confirm the ID is `pofhkiebdcchdedejdniobgfgakllkij`. The manifest `key`
   pins it, so it stays the same in every browser and matches the installed
   native host.
5. Open the cockpit (toolbar popup → **Open cockpit**, or `Ctrl+Shift+E`).
   Browsers without the Side Panel API get the cockpit in a tab instead.
6. Start the engine against your browser with
   `BROWSER_ENGINE_BACKEND=extension`.

Attach policy defaults to **origin allow-list**. A new host prompts in the
cockpit; Allow adds it. Kill (`Ctrl+Shift+U`) pauses attach/CDP.

## Under remote control

When the engine attaches, the extension makes it obvious:

- the controlled tab is grouped under a colored **BrowserEngine** tab group,
  its title gains a `● ` marker, and the toolbar shows a per-tab `ON` badge
  (amber `||` when paused);
- the page gets a viewport frame, a "BrowserEngine is controlling this tab"
  pill, and an action cursor with click ripples and typing hints;
- everything is removed on detach, pause, kill switch, or tab close.

Turn the in-page overlay off (the tab group and badge stay) with **Control HUD**
in the options page.

MCP tools: `extension_status`, `extension_get_settings`,
`extension_set_settings`, `extension_allow_origin`, `extension_deny_origin`.
