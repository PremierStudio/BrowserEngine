import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['default', 'junit'],
    outputFile: { junit: 'reports/junit.xml' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      // src/cli.ts is the thin stdio entry point: it calls buildCliMain() at
      // module load, which would start a real server, so it cannot be
      // imported in tests. All of its logic lives in buildCliMain, which is
      // covered at 100% via src/protocol/cli.ts.
      exclude: [
        'src/cli.ts',
        'src/testing/clickGoMain.ts',
        // Browser/native entry points: they attach to chrome.* or process
        // stdio and cannot be imported in Node tests. Their logic lives in
        // the tested modules (session/settings/cockpit/nativePort/
        // nativeBridge), the same pattern as src/cli.ts -> src/protocol/cli.ts.
        'src/extension/background.ts',
        'src/extension/popup.ts',
        'src/extension/panel.ts',
        'src/extension/options.ts',
        'src/extension/nativeHost.ts',
        // Injected page overlay: evaluated over CDP into the controlled tab.
        'src/extension/hudOverlay.ts',
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
})
