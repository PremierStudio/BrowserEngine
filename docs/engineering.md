# Engineering

Every module is written test-first (RED, then GREEN, then refactor). CI enforces:

```text
typecheck → lint → format → knip → unit tests → coverage (100%) → mutation (100%) → survivor registry
```

```bash
npm run ci
```

| Command                    | What it does                                                                   |
| -------------------------- | ------------------------------------------------------------------------------ |
| `npm run typecheck`        | `tsc --noEmit`                                                                 |
| `npm run lint`             | ESLint (bans `as`/`any`/`!`/`@ts-ignore`/`.forEach`)                           |
| `npm run format`           | Prettier check                                                                 |
| `npm run knip`             | dead code / unused deps (zero findings)                                        |
| `npm test`                 | Vitest                                                                         |
| `npm run test:integration` | Real Chrome (set `BROWSER_ENGINE_INTEGRATION=1`)                               |
| `npm run ci:local-run`     | CLI `run` against local click-go HTML (headless)                               |
| `npm run build:scripts`    | Emit hook runners to `dist-scripts/hooks/` (`prepare` runs this after `build`) |
| `npm run showcase`         | Long headed public-site demo (`BROWSER_ENGINE_SHOWCASE=1`)                     |
| `npm run coverage`         | 100% threshold (lines/branches/functions/statements)                           |
| `npm run mutation`         | Stryker, 100% threshold + survivor registry                                    |
| `npm run reports`          | coverage + JUnit XML into `reports/`                                           |

- **100% coverage** (lines/branches/functions/statements) via Vitest + `@vitest/coverage-v8`.
- **100% mutation score** via Stryker. The only escape is a named entry in `mutation-survivors.json`.
- **No dead code.** knip runs with zero findings.
- **TypeScript only.** No `.js`/`.mjs`/`.cjs`, including configs and scripts (emitted to `dist-scripts/` via `tsconfig.scripts.json`).
- **No banned constructs.** `as`, `any`, `!`, `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error`, and `.forEach` are lint errors.
- **Deterministic tests.** Clocks and timers are injected. No sleeps.

Settled rules are in [`decisions.md`](decisions.md). [`mvp.md`](mvp.md) is the original implementer brief; decisions win when they conflict. Agent rules are in [`../AGENTS.md`](../AGENTS.md).

## Stack

| Layer     | Package                                                                                      | Version                    |
| --------- | -------------------------------------------------------------------------------------------- | -------------------------- |
| Protocol  | [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server) | `^2.0.0` (2026-07-28 line) |
| Browser   | [`puppeteer`](https://pptr.dev)                                                              | `^25.6.0`                  |
| Schemas   | [`zod`](https://zod.dev)                                                                     | `^4.4.3`                   |
| Language  | [`typescript`](https://www.typescriptlang.org)                                               | `^6.0.3`                   |
| Tests     | [`vitest`](https://vitest.dev)                                                               | `^4.1.10`                  |
| Mutation  | [`@stryker-mutator/core`](https://stryker-mutator.io)                                        | `^9.6.1`                   |
| Lint      | [`eslint`](https://eslint.org)                                                               | `^10.8.1`                  |
| Dead-code | [`knip`](https://knip.dev)                                                                   | `^6.32.2`                  |
| Format    | [`prettier`](https://prettier.io)                                                            | `^3.9.6`                   |
