import type { KnipConfiguration } from 'knip'

// knip's built-in Stryker plugin defaults to non-TS config globs
// (`stryker.config.{js,mjs,cjs,json}`), so it never loads our TypeScript-only
// `stryker.config.ts`. Point the plugin's `config` at the `.ts` file: knip
// then parses it and derives `@stryker-mutator/vitest-runner` from
// `testRunner: 'vitest'` (instead of flagging it as an unused dependency).
const config: KnipConfiguration = {
  entry: [
    'scripts/*.ts',
    'src/cli.ts',
    // Browser/native entry points that the TS extension build emits as the
    // unpacked extension's runtime files (see tsconfig.extension.json).
    'src/extension/background.ts',
    'src/extension/popup.ts',
    'src/extension/panel.ts',
    'src/extension/options.ts',
    'src/extension/nativeHost.ts',
    'src/extension/nativeFraming.ts',
    'src/extension/session.ts',
    'src/extension/nativePort.ts',
    'src/extension/cockpit.ts',
    'src/testing/clickGoMain.ts',
    'vitest.stryker.config.ts',
  ],
  stryker: { config: ['stryker.config.ts'] },
}

export default config
