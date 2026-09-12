# Extension cockpit

Operator view for driving your own Chromium profile (Chrome, Chromium, Brave,
Edge, Vivaldi, Opera): a side panel where the browser exposes
`chrome.sidePanel`, otherwise `panel.html` opens in a normal tab. The popup is
a launcher; options are a full tab.

- Attach defaults to **always** (drive with no prompt); switch to prompt or
  allow-list in the options page for a stricter gate.
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
- the controlled tab is grouped under a colored **BrowserEngine** tab group
  (only when it was not already in a user group) and its title gains a `● `
  marker that survives navigation;
- the page gets a hairline viewport frame and a state pill, and actions draw
  the agent's cursor with click ripples and typing hints.

The `showHud` setting (default on) gates the in-page frame and pill; everything
is removed on detach, pause, disconnect, or tab close.

## Install

1. `npm run build`
2. `browser-engine install-native-host` — from the repo use
   `node dist/cli.js install-native-host`; add `--all` to write manifests for
   every known browser even if its profile was not detected.
3. Load `extension/` unpacked in `chrome://extensions` (or the equivalent
   page) and start the engine with `BROWSER_ENGINE_BACKEND=extension`.

Details per browser: [`extension/README.md`](../extension/README.md).
