# Extension cockpit (v1 / scope A)

Side-panel operator view + full-tab options. Popup is a launcher.
Attach default is origin allow-list with a prompt on new hosts.
No new Chrome APIs beyond `storage`, `sidePanel`, and `commands`.

Source of truth: `src/extension/settings.ts` + `src/extension/session.ts`.
The service worker is a chrome adapter. MCP `extension_*` tools relay the same session methods.
