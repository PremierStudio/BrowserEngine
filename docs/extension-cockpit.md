# Extension cockpit

Operator view for driving your own Chromium profile (Chrome, Chromium, Brave,
Edge, Vivaldi, Opera): a side panel where the browser exposes
`chrome.sidePanel`, otherwise `panel.html` opens in a normal tab. The popup is
a launcher; options are a full tab.

- Attach defaults to an **origin allow-list** with a prompt on new hosts.
- `Ctrl+Shift+E` toggles the cockpit, `Ctrl+Shift+U` pauses attach/CDP.
- All APIs used (`chrome.debugger`, `tabs`, `storage`, `nativeMessaging`,
  `sidePanel` with fallback, `commands`) are shared across Chromium browsers;
  nothing Brave-specific.

Source of truth: `src/extension/settings.ts` + `src/extension/session.ts`.
The service worker (`src/extension/background.ts`) is a chrome adapter. MCP
`extension_*` tools relay the same session methods.

## Remote-control indicators

While attached, the extension makes control obvious:

- per-tab toolbar badge (`ON` green, `||` amber when paused);
- the controlled tab is grouped under a colored **BrowserEngine** tab group,
  and its title gains a `● ` marker;
- the page gets a viewport frame, a state pill, and the action cursor with
  click ripples and typing hints.

All of it is gated by the **Control HUD** setting (default on) and is removed
on detach, pause, disconnect, or tab close.

## Install

1. `npm run build`
2. `browser-engine install-native-host` — from the repo use
   `node dist/cli.js install-native-host`; add `--all` to write manifests for
   every known browser even if its profile was not detected.
3. Load `extension/` unpacked in `chrome://extensions` (or the equivalent
   page) and start the engine with `BROWSER_ENGINE_BACKEND=extension`.

Details per browser: [`extension/README.md`](../extension/README.md).
