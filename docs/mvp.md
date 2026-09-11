> Historical implementer brief from the start of the project. Not the current
> product spec. BrowserEngine is a named-intent browser engine with MCP
> authoring and a no-AI CLI `compile` / `run`. Read `README.md`, `docs/usage.md`,
> `docs/ci.md`, and `docs/architecture.md` for what shipped. `docs/decisions.md`
> wins wherever this file conflicts.

You are implementing a new MCP (Model Context Protocol) browser-automation server from scratch. This is a greenfield TypeScript/Node project. Follow the plan exactly, use strict TDD (red first, then green), and do not write any core product code until the entire tooling/test infrastructure is wired in, enforced, and proven.

Project context

We are building the "best possible" MCP browser integration. The core thesis: stop treating "read the page" and "act on the page" as separate text/pixel worlds. Build one unified, event-driven, visually-rich model where the semantic layer and the visual layer are the same object, and where the model can both watch and explain.

Key decisions already made (do not relitigate these):
• Language/stack: TypeScript on Node, built on top of Puppeteer (not raw CDP, not Playwright). Puppeteer's raw CDP access is an advantage because we need a11y trees, bounding boxes, traces, and heap snapshots.
• Not a fork of chrome-devtools-mcp. Fresh server. But borrow its proven patterns: stable element uids keyed by loaderId_backendNodeId, a ContextPage abstraction that hides Puppeteer behind a narrow contract, an "act then wait for stable DOM/navigation" wrapper, and token-optimized formatters.
• MCP spec: target the 2026-07-28 revision. Adopt the modern primitives: Tasks extension (long-running ops), subscriptions/listen (server-pushed change events), MRTR (multi round-trip requests for human-in-the-loop gates), MCP Apps (interactive HTML replay/annotation UI), and Tool Annotations (readOnlyHint, destructiveHint). Avoid deprecated features (Roots, Sampling, Logging, HTTP+SSE).
• The browser and the LLM are the bottlenecks, not our server code. Performance comes from fewer round trips (diff engine, event-driven observation), not from micro-optimization.

The product surface we are building (in dependency order)

1. observe tool — the unified primitive. Returns one object: { snapshot (a11y tree with uid + boundingBox + zIndex + role + name + value), image (screenshot), overlay (uid → pixel box mapping), events (recent console/network/dom), layout hints, page state }. This replaces the split snapshot/screenshot model.
2. Diff engine — observe returns changes since the last call (nodes added/removed, value changes), not the whole tree, so the model doesn't re-read the page every turn.
3. Event/subscription layer — adopt subscriptions/listen so the server pushes domChanged, navigated, consoleError, networkFailed, dialogOpened instead of the model polling.
4. Semantic action log — every action (click, type, hover, scroll, navigate) records {action, uid, box, timestamp}. This is the seed of the replay.
5. MCP App replay/annotation UI — an interactive HTML view (rendered in the chat via MCP Apps) that replays the action log as clean, eased animations (smooth cursor, click ripple, hover pulse, navigation fade), lets the user scrub the timeline, and lets the model annotate ("here's the broken element" → red ring + callout).
6. Tasks + MRTR — watch_until(condition, timeout), run_flow(sequence), and human-in-the-loop gates (e.g., "this submits a payment — confirm").
7. Intent tools — verify(assertion) (pass/fail with evidence) and explain(uid | region | diff) (produces an annotated visual artifact + human-readable summary).

Non-negotiable engineering requirements

1. Tooling + test infrastructure FIRST (before any core code)
   Wire up the full tooling and test/reporting pipeline as the very first milestone. This is a hard gate: no core product code may be written until this milestone is complete, enforced, and proven. The pipeline must catch every class of defect — not just "tests pass."

• TypeScript strictness: strict: true and noUncheckedIndexedAccess in tsconfig. A dedicated typecheck script (tsc --noEmit) that must pass in CI.
• Dead-code / unused detection: knip configured to flag unused files, unused exports, unused dependencies, and unused devDependencies. Zero knip findings allowed. This enforces "no dead unused code" — if a module, export, or dependency isn't actually used, it must be removed, not ignored.
• Linting/format: ESLint + Prettier, enforced in CI. No any, no as casts, no ! non-null assertions, no @ts-ignore/@ts-nocheck/@ts-expect-error. Prefer for..of over forEach. Add rules that catch unused variables/imports and unreachable code.
• Test runner: Vitest (fast, TS-native, good watch mode).
• Coverage: @vitest/coverage-v8. Configure thresholds: 100% line, 100% branch, 100% function, 100% statement on all src/ code. Coverage must be enforced in CI (fail the build if below threshold).
• Mutation testing: Stryker (@stryker-mutator/core + @stryker-mutator/vitest-runner). Configure it to run against src/ with the Vitest runner. Target 100% mutation score. Follow the methodology in https://stryker-mutator.io/blog/stryker4s-40-minutes-to-40-seconds/ — the point is: coverage % alone is a lie; mutation testing proves the tests actually catch real faults. Every new module must be written so its tests kill all injected mutants.
• Test reporting: produce clean, human-readable reports: coverage HTML report, Stryker HTML report, and a CI-friendly summary (JUnit XML or similar). Wire these into package.json scripts so a single command runs everything.
• CI: a pipeline that runs, in order: typecheck → lint → format-check → knip → unit tests → coverage (100% gate) → mutation (100% gate). Fails on any regression. Nothing merges unless all gates are green.

2. Test quality standards (not just "tests exist")
   Tests must be truthy, meaningful, and mutation-killing — not superficial. Enforce these patterns:

• Truthy assertions: assert on real behavior and outcomes, not on mocks being called. Prefer asserting the result of the code under test. Avoid tautological or self-fulfilling assertions (e.g., asserting a mock returns what you stubbed it to return without exercising real logic).
• Abstraction-driven testing: test through the public ContextPage / tool interfaces, not implementation internals. This is what makes the whole thing testable — you can mock the ContextPage and unit-test tools without a real browser.
• Reusable test helpers: extract shared fixtures, builders, and mock factories into reusable test utilities. No copy-pasted mock setup across test files. Mocks/stubs should be minimal and explicit — stub only what the unit under test depends on, and assert on the unit's behavior, not the stub's internals.
• Best practices with mocks/stubs: use dependency injection so seams are explicit and mockable. Prefer real collaborators where cheap and deterministic; use mocks only at the boundaries (browser, network, clock, filesystem). Inject clocks and timers — no sleeps, no flaky timing.
• No dead test code: knip and lint also apply to tests — no unused test helpers, no unused imports, no orphaned fixtures.
• Mutation testing is the proof: a test that doesn't kill its module's mutants is a bad test. Fix surviving mutants by strengthening tests — never by weakening code or adding ignore comments.

3. Strict TDD workflow (red → green → refactor)
   For every single feature and module:
1. Write the failing test first (RED). Run it, confirm it fails for the right reason.
1. Write the minimal code to make it pass (GREEN).
1. Refactor, keeping tests green.
1. Run coverage + Stryker on the new module. Fix any surviving mutants by strengthening tests.
1. Commit only when the module is at 100% coverage AND 100% mutation score, and knip/typecheck/lint are clean.

Do not write product code before its tests exist. Do not batch "write all the code then test it."

4. Architecture rules
   • ContextPage abstraction: tools never touch raw Puppeteer Page directly. Expose a narrow, testable contract (getElementByUid, waitForEventsAfterAction, observe, emulate, getDialog).
   • Stable uids: keyed by loaderId_backendNodeId, reused across snapshots so the model can reference elements across turns.
   • Act-then-wait: every action goes through a wrapper that waits for navigation and DOM stability (MutationObserver) before returning, with CPU/network throttling multipliers.
   • Token-optimized: return semantic summaries, not raw dumps. Reference-over-value for heavy assets (screenshots, traces → file path or resource URI).
   • Tool framework: defineTool/definePageTool + zod schemas + a ToolHandler that provides category gating, experimental-flag gating, unknown-argument rejection, a global tool mutex for writes (read-only observations may run concurrently), and a Response object that defers snapshot/screenshot/event attachment until handle().
   • MCP protocol layer: implement against the 2026-07-28 spec. Support stdio and Streamable HTTP transports. Implement server/discover, tools/list (deterministic order, with ttlMs/cacheScope), tools/call, subscriptions/listen, the Tasks extension (tasks/get, tasks/update, tasks/cancel), MRTR (InputRequiredResult), and MCP Apps (ui:// resources). Use the official @modelcontextprotocol/sdk where it helps, but you are responsible for the modern primitives.

5. Testing strategy
   • Unit tests for all pure logic: uid generation, snapshot formatting, diff engine, bounding-box math, event log, action log, token-optimized formatters, zod schemas, tool handlers (with mocked ContextPage).
   • Integration tests against a real headless Chrome (via Puppeteer) for the browser-facing pieces: observe returns correct a11y + boxes, click(uid) resolves and waits, diff engine detects changes, event subscriptions fire. Use a local test HTML server (no external network dependency).
   • Mutation tests on all of the above.
   • Keep tests deterministic: no sleeps, use explicit waits and injected clocks.

Build order (milestones)

M0 — Tooling + test infrastructure (do this first, alone, and do NOT proceed until it's proven): TypeScript strict config + typecheck, knip (zero findings), ESLint + Prettier, Vitest + coverage (100% thresholds), Stryker (100% mutation target), reporting scripts, CI config. Prove the pipeline works with a trivial module (e.g., a sum function with tests that kill all mutants, plus a deliberately-dead export that knip flags and you remove). This is the foundation — do not skip ahead until M0 is green, all gates enforced, and the reports render.

M1 — Core page model: stable uid generation, ContextPage abstraction, a11y snapshot with bounding boxes, observe tool (snapshot + image + overlay). TDD each piece.

M2 — Diff engine: change detection between observations, value-change tracking, token-optimized diff output.

M3 — Action primitives + wait wrapper: click, type, hover, scroll, select, press, navigate, each with the act-then-wait wrapper and the semantic action log.

M4 — Event/subscription layer: console/network/DOM/navigation event collection, subscriptions/listen integration.

M5 — MCP protocol layer: stdio + Streamable HTTP, server/discover, tools/list/tools/call, Tool Annotations, Tasks extension, MRTR.

M6 — Intent tools: watch_until, run_flow, verify, explain.

M7 — MCP App replay/annotation UI: the ui:// resource, action-log replay with animations, timeline scrubber, annotation layer.

M8 — Hardening: full mutation pass, edge cases, error paths, docs, final CI green.

How to work
• Use subagents for parallelizable, well-scoped milestones (e.g., M0 infra, then parallelize independent modules within a milestone), but the orchestrator (you) must enforce the TDD + coverage + mutation + knip + typecheck gates on every merge. Do not let a subagent merge code that isn't red→green, mutation-clean, and tooling-clean.
• Each milestone ends with: all tests green, 100% coverage, 100% mutation score on the new code, knip/typecheck/lint clean, reports generated, and a commit.
• If a mutation cannot be killed, document why (e.g., a defensive branch that's unreachable by design) rather than silently lowering the bar — but treat this as rare and justify it explicitly.

Definition of done
• npm run typecheck passes.
• npm run knip reports zero findings.
• npm run lint and npm run format pass.
• npm test runs the full suite green.
• npm run coverage reports 100% across all metrics.
• npm run mutation reports 100% (or documented, justified survivors).
• CI runs all of the above in order and fails on any regression.
• Every product module has red-first tests that kill all injected mutants.
• No dead code, unused exports, or unused dependencies anywhere.

Start with M0. Do not write any core product code until the tooling/test infrastructure is wired in, enforced, and proven. Report progress milestone by milestone. -- use subagents in parallel as much as you can here.
