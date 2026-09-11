# Usage

## Attach an agent (MCP)

`npm start` serves MCP over stdio. Chrome opens on `browser_open` or the first page tool, not at process start. Point a client at `node dist/cli.js`. The server exposes `tools/list`, `tools/call`, and `server/discover`.

CI replay is the same binary without MCP: `node dist/cli.js compile file.json` then `node dist/cli.js run file.json --report reports/flow.json --junit reports/flow.xml`. `--json` prints that report on stdout. Host snippets live in [ci.md](ci.md).

```bash
npm start
node dist/cli.js --headed
BROWSER_ENGINE_HEADED=0 npm start
npm start -- --http
BROWSER_ENGINE_CDP_URL=http://127.0.0.1:9222 npm start
```

Streamable HTTP binds `127.0.0.1` on port 3333, or `PORT`. Tunnel if the agent is not on this machine. Prefer **one `run_flow`** with `name` / `role` / `near` instead of observe-per-page. When binds are unique, write the JSON (no uids) and switch to `compile` / `run`. CLI `compile` only checks the file schema. MCP `compile_flow` binds names on the live page. There is no `save_flow` MCP tool. That would blow the 8KiB `tools/list` line budget.

If you move or resize the window, the server notices (`resize` events plus `pageState.layout` / `pageState.resized` on observe), drops a locked viewport, and keeps the new size. It does not snap the window back.

## Chrome desk

These tools do not need a page tool first. `browser_status` lists this engine's Chrome, peers, orphans, and closed instances. It does not launch Chrome.

| Tool                 | Job                                                   |
| -------------------- | ----------------------------------------------------- |
| `browser_status`     | List this instance, peers, orphans, closed            |
| `browser_open`       | Open this Chrome. Safe when already open              |
| `browser_close`      | Close this Chrome, or disconnect if attached over CDP |
| `browser_reap`       | Kill leftover Chrome whose agent process is gone      |
| `browser_new_tab`    | Open a tab. Optional `url`                            |
| `browser_switch_tab` | Switch to a tab id from `browser_status`              |
| `browser_close_tab`  | Close a tab. Refuses to close the last tab            |

## Page tools

`observe`, `click`, `type`, `hover`, `scroll`, `select`, `press`, `navigate`

`observe` with `detail=outline` is the compact label list used to plan a flow. `detail=full` includes a screenshot.

## Intent tools

`watch_until`, `compile_flow`, `run_flow`, `verify`, `explain`

The engine re-observes after click or navigate. A name must bind uniquely or the flow stops with candidates, before any hover or click. Use `near` when labels repeat (demo credentials vs the real Username field). Put `expectUrl` / `expectText` on steps that change the page. Headed mode polls until they match. `action: check` only asserts.

`compile_flow` is read-only. It binds the current-page prefix and leaves later pages as names. It does not act.

## Other MCP surface

**Tasks fallback** (decision #2, hosts without `ext-tasks`): `get_task`, `list_tasks`, `cancel_task`, `wait_task`

**HITL:** `confirm_action` returns an `InputRequiredResult` (MRTR / elicitation)

**Resources:** `browser://events` (JSON snapshot of the event buffer; `notifications/resources/updated` after a tool call when the buffer grew) and `ui://browser-engine/replay` (MCP App HTML replay)

**Trace:** `list_calls` lists recent tool calls with `durationMs` and `resultBytes`

## Environment

| Variable / flag            | Role                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| `BROWSER_ENGINE_HEADED=0`  | Headless and instant                                                    |
| `BROWSER_ENGINE_PACE_MS`   | Pause between `run_flow` steps (`0` is instant)                         |
| `BROWSER_ENGINE_TYPE_MS`   | Pause between typed characters (`0` is instant)                         |
| `BROWSER_ENGINE_EXPECT_MS` | How long headed mode waits for `expect*`                                |
| `BROWSER_ENGINE_WORK_AREA` | `x,y,width,height` if the default snap is wrong                         |
| `BROWSER_ENGINE_CDP_URL`   | When set to `http://host:port`, connect over CDP. Do not launch Chrome. |
| `--cdp-url <url>`          | Same as `BROWSER_ENGINE_CDP_URL`. Wins over env.                        |

Unset or whitespace-only CDP URL keeps today's launch path. A present but invalid value (not `http://` or `https://`) is an error so a typo does not spawn Chrome.

A Chromium browser (Brave, Chrome, Edge, Vivaldi, …) must already be listening. Example:

```powershell
& "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe" --remote-debugging-port=9222
```

Then `BROWSER_ENGINE_CDP_URL=http://127.0.0.1:9222` or `--cdp-url http://127.0.0.1:9222`. `browser_close` in attach mode disconnects the engine only. It does not quit the browser.

Headed defaults: about 28ms per typed character, about 700ms between `run_flow` steps, live cursor HUD.

## Demos

These stay on public, well-labeled pages. No CAPTCHA, no account signup. They resolve every control by `name` / `near`.

**Showcase** (`SHOWCASE_STEPS`): httpbin pizza form, the-internet login, Add/Remove, forgot password, Sauce Demo cart checkout, Playwright TodoMVC.

```powershell
$env:BROWSER_ENGINE_SHOWCASE='1'
npx vitest run tests/integration/chrome.showcase.test.ts
```

**Banking** (`BANKING_STEPS`): XYZ Bank customer login, Harry Potter, deposit 150, stop on Deposit Successful.

```powershell
$env:BROWSER_ENGINE_SHOWCASE='1'
npx vitest run tests/integration/chrome.banking.test.ts
```

A saved-flow Chrome proof lives in `tests/integration/chrome.flowFile.test.ts` (local HTML, no public network).
