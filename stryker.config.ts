import type { PartialStrykerOptions } from '@stryker-mutator/api/core'

// `fileLogLevel` is typed as a const enum (`LogLevel`) whose string form is
// "info". Under `verbatimModuleSyntax` a const enum cannot be imported as a
// value, and plain string literals are not assignable to the const-enum type.
// Stryker validates the real values against its JSON schema at runtime, so we
// keep full type-checking on every other field and widen only this one.
type StrykerConfig = Omit<PartialStrykerOptions, 'fileLogLevel'> & {
  fileLogLevel?: string
}

const config: StrykerConfig = {
  testRunner: 'vitest',
  // Stryker 9 auto-detects only json/js/mjs/cjs; this file must be passed
  // as `stryker run stryker.config.ts` (see package.json "mutation").
  vitest: { configFile: 'vitest.stryker.config.ts' },
  mutate: [
    'src/**/*.ts',
    '!src/cli.ts',
    '!src/testing/clickGoMain.ts',
    // Browser/native entry points are covered by the same reasoning as
    // src/cli.ts: they are process boundaries, not importable units.
    '!src/extension/background.ts',
    '!src/extension/popup.ts',
    '!src/extension/panel.ts',
    '!src/extension/options.ts',
    '!src/extension/nativeHost.ts',
  ],
  // perTest + no concurrency cap + ignoreStatic follow the
  // 40-minutes-to-40-seconds methodology: only covering tests run,
  // every core is used, and static mutants (full reload + all tests)
  // are ignored. incremental reuses prior killed/survived results.
  coverageAnalysis: 'perTest',
  ignoreStatic: true,
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  timeoutMS: 30000,
  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation.html' },
  thresholds: { high: 100, low: 100, break: 100 },
  symlinkNodeModules: true,
  tempDirName: '.stryker-tmp',
  fileLogLevel: 'info',
  jsonReporter: { fileName: 'reports/mutation.json' },
  checkers: [],
}

export default config
