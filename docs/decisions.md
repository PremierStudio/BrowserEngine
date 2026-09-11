# Decisions & amendments (supersede `mvp.md` where they conflict)

Reviewed 2026-08-11 by three parallel `plan` subagents (architecture, MCP spec
currency, M0 tooling feasibility — verified against live sources: npm registry,
modelcontextprotocol.io 2026-07-28 spec pages, ext-tasks, ext-apps). These
amendments take precedence over the corresponding lines of `mvp.md`.

## Protocol layer (verified against the 2026-07-28 spec)

1. **SDK choice**: use the v2 packages `@modelcontextprotocol/server` and
   `@modelcontextprotocol/client` (the 2026-07-28 line). Do **not** use the
   legacy `@modelcontextprotocol/sdk`. We still own Tasks + MCP Apps ourselves
   (they live in separate `ext-tasks` / `ext-apps` packages).
2. **Tasks extension is EXPERIMENTAL, not ratified core** (ext-tasks, SEP-2663).
   Method names are correct (`tasks/get`, `tasks/update` with `inputResponses`,
   `tasks/cancel`; statuses `working|input_required|completed|failed|cancelled`).
   Build it as a design target with a **hard fallback path** (blocking call /
   long-poll with progress) since hosts may not support it.
3. **`subscriptions/listen` is ratified core**; `domChanged`, `navigated`,
   `consoleError`, `networkFailed`, `dialogOpened` are **NOT standard MCP
   notification types** and are not in the ratified `SubscriptionFilter`.
   Deliver browser events as a **custom extension** (like Tasks does, behind our
   own extension declaration) or via ratified `notifications/resources/updated`
   on subscribed resources.
4. **MRTR**: `InputRequiredResult` (`resultType: "input_required"`,
   `inputRequests` map + integrity-protected opaque `requestState`) is ratified
   but only allowed on `tools/call`, `prompts/get`, `resources/read`. HITL
   gates use `elicitation/create` (form mode) inside `inputRequests`.
5. **MCP Apps**: stable official extension `io.modelcontextprotocol/ui`,
   `ui://` resource URIs, MIME `text/html;profile=mcp-app`, tool linkage via
   nested `_meta.ui.resourceUri` (the legacy flat key is deprecated).
6. **Tool Annotations**: `readOnlyHint` / `destructiveHint` confirmed (plus
   `idempotentHint`, `openWorldHint`). Treat as untrusted hints.
7. **`server/discover`**: MUST implement; response requires `ttlMs`/`cacheScope`
   on complete results (also `tools/list`, `prompts/list`, `resources/list`,
   `resources/read`). Deterministic tool order is a SHOULD.
8. **Deprecated set confirmed**: Roots, Sampling, Logging, HTTP+SSE — avoid.

## Architecture amendments (from review)

9. **The 100% mutation gate vs. black-box testing tension**: black-box tests
   through `ContextPage` cannot kill every internal mutant. Resolution: unit
   tests through public interfaces (as the plan says) PLUS focused mutation
   tests for internal paths where the public API cannot reach them. The gate is
   one module at a time, so internal-path tests are written per module and
   committed with it — not after the fact.
10. **Tool framework is a missing milestone**: `defineTool`/`definePageTool`/
    `ToolHandler`/mutex/`Response` have no home. It is now **M1-part-0** —
    before `observe` at the top of M1.
11. **Swap M3 and M4**: implement event collection (console/network/DOM/
    navigation) BEFORE action primitives, because `act-then-wait` depends on
    DOM-stability/navigation events. `subscriptions/listen` integration itself
    moves to M5 (needs the protocol transport).
12. **Uid stability across navigation**: `loaderId` changes on every
    navigation, killing cross-turn uids. The diff engine gets
    fingerprint-based uid re-resolution/rebinding — added to M2.
13. **Action log / replay seed**: the semantic action log begins in M3 (now
    after event collection) — unchanged, but its schema should be written so a
    navigation-triggered uid rebind doesn't orphan it.
14. **observe atomicity**: a11y tree, screenshot, overlay come from separate
    CDP calls; page mutation between them makes boxes disagree with the image.
    M1 keeps the screenshot but documents the frame-sync decision
    (single-dom-snapshot + separate screenshot is acceptable for M1; revisit in
    M8).
15. **Diff engine is single-consumer state**: concurrent read-only observes
    must not race the diff; M2 defines the consumption semantics (owner-token,
    last-observe-wins) explicitly.

## M0 tooling decisions (verified against npm registry 2026-08-11)

16. **TypeScript: pin `^6.0.3`** — NOT 7.x. TS 7 is the Go port; typescript-eslint
    8.67.0, knip 6.32.2, vitest 4.1.10 are NOT TS-7-ready. Re-evaluate when
    ts-eslint supports `>=6.1.0`.
17. **Versions**: eslint `^10.8.1` (flat-only, `.eslintrc` removed),
    @typescript-eslint/* `^8.67.0`, prettier `^3.9.6`, vitest + @vitest/coverage-v8
    `^4.1.10`, @stryker-mutator/core + vitest-runner `^9.6.1`, knip `^6.32.2`.
18. **TypeScript-ESLint ban matrix**:
    - `@typescript-eslint/consistent-type-assertions` with
      `{ assertionStyle: "never" }` (bans `as`; `as const` is exempt by design).
    - `@typescript-eslint/no-non-null-assertion: "error"` (bans `!`).
    - `@typescript-eslint/no-explicit-any: "error"` (bans `any`).
    - `@typescript-eslint/ban-ts-comment: "error"` with
      `{ 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': true,
'ts-check': true }`.
    - No canonical rule bans `.forEach`; a tiny custom ESLint rule in
      `eslint.config.ts` walks `CallExpression.callee.property === 'forEach'`.
19. **Coverage gate**: `@vitest/coverage-v8`, thresholds 100 across
    lines/functions/branches/statements on `src/`, fail below threshold.
20. **Mutation gate**: stryker `thresholds: { high: 100, low: 100, break: 100 }`
    (exit 1 below `break`). Vitest runner, `mutate: ['src/**/*.ts', '!src/cli.ts']`
    (`src/cli.ts` is the process entry; it only wires live Puppeteer and is
    covered by `tests/protocol/cli.test.ts`, not by mutant-killing unit tests). Speed
    follows https://stryker-mutator.io/blog/stryker4s-40-minutes-to-40-seconds/ :
    in-process Vitest runner, `coverageAnalysis: 'perTest'`, no concurrency
    cap (all cores), `ignoreStatic: true` (static mutants force a full reload
    plus every test), and `incremental: true` writing
    `reports/stryker-incremental.json`. CI restores/saves that file via
    `actions/cache@v4` keyed by OS + SHA with an OS-wide restore-key.
    Windows: forward-slash globs only, gitignore `.stryker-tmp`, set
    `timeoutMS: 30000`. This repo's GitHub Actions job is Ubuntu and does not
    run a live Chrome `run` of a public site.
21. **JUnit reporter is built into vitest 4** (`reporters: ['junit']`,
    `outputFile: { junit: 'reports/junit.xml' }`) — no extra package.
22. **knip on Windows**: if the oxc raw-transfer hangs, set
    `KNIP_DISABLE_RAW_TRANSFER=1`; quote globs in pwsh.
23. **Survivor registry**: `mvp.md` allows "documented justified survivors" but
    allows no mechanism to enforce them in CI. M0 introduces
    `scripts/survivors.ts` + `mutation-survivors.json` — every permitted
    survivor is a named entry; CI fails on any survivor not in the registry.
    This is the ONLY escape from the mutation gate (per mvp.md lines 92–96) —
    the registry replaces the empty "document it" clause with a checked gate.

## TypeScript-only enforcement

28. **No `.js` / `.mjs` / `.cjs` anywhere** — configs, scripts, and build tooling
    included. `eslint.config.ts`, `stryker.config.ts`, `vitest.config.ts`, and
    `tsconfig*.json` are the only config formats. Scripts under `scripts/` are
    TypeScript emitted to `dist-scripts/` via `tsconfig.scripts.json`
    (`build:scripts`) for the rare cases that need plain-Node execution.
29. Enforced by (a) an AGENTS.md rule, (b) a CI step that fails on any tracked
    `.js`/`.mjs`/`.cjs`, and (c) knip/lint/format on the repo. The auto-generated
    `dist-scripts/` output is gitignored and excluded from lint/coverage/mutation.

## Operating guardrails for the loop

24. Master agent (Grok) orchestrates; subagents implement well-scoped modules
    per milestone in parallel where the milestone permits.
25. Every module is RED first (failing test), then GREEN, then refactor, then
    coverage + mutation on that module, then commit. Orchestrator re-runs the
    full gate chain before each milestone commit.
26. Subagents may NOT merge anything not red→green, mutation-clean, and
    tooling-clean (typecheck/knip/lint/format). Orchestrator enforces on merge.
27. No core product code before M0 is proven green (hard gate from mvp.md).
    "Core product code" was anything under `src/` beyond the M0 smoke module.
    That smoke module is gone; the gate is the current `src/` tree.

## Extension control HUD (v0.2)

30. **Three signals, one setting.** While the engine is attached to a tab the
    extension shows, in order of visibility: a per-tab toolbar badge
    (`ON` / `||`), a colored `BrowserEngine` tab group plus a `● ` document
    title marker, and an in-page overlay (hairline viewport frame + state
    pill). The `showHud` setting (default true) gates the overlay; badge,
    group, and title always reflect control. Detach, engine disconnect, tab
    close, or the kill switch restores the tab: overlay removed, title
    unmarked, badge cleared, and a group ungrouped only when we created it.
31. **Action visuals come from the page-side HUD.** `actionHud.ts` runs with
    every click/type/scroll/select/hover/press as an injected DOM function
    (`Runtime.callFunctionOn`), so the cursor, ripple, typing ring, swipe, and
    key chip work identically in the launched-Chrome and extension backends.
    The v0.2 CDP-derived signal path was removed in v0.2.1: the engine never
    emits `Input.dispatchMouseEvent` or `Input.insertText`, so deriving
    animation from the command stream could never fire.
32. **Injected as source, not imported.** `hudOverlay.ts` is a plain script
    compiled flat to `extension/hudOverlay.js`, fetched by the service worker
    and installed via `Page.addScriptToEvaluateOnNewDocument` plus one
    evaluation for the current document. The `● ` title marker is registered
    the same way, so it survives navigation. Both are entry points excluded
    from coverage/mutation; `hudTitle` and `hudState` decisions are unit-tested
    to 100%.
33. **One engine owns the bridge.** The native-host socket accepts a single live
    connection, and a second engine silently takes it over. `src/cli.ts` probes
    the socket and refuses to start when another engine is live, and the tab is
    grouped only when it is not already in a group, so a user's own tab group is
    never disturbed. Service-worker reconnection is backed by a 30s alarm
    watchdog so a dead host does not strand the bridge.
