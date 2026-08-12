import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    // The plugin-iframe host loads a bundle by setting an <iframe> src to a blob:
    // URL. happy-dom cannot navigate a blob: frame and rejects async with this exact
    // DOMException, which escapes the owning test as an "unhandled error" and makes
    // the whole run exit non-deterministically. Swallow ONLY that one known-benign
    // happy-dom rejection (matched by its exact message AND its happy-dom navigator
    // stack); every other unhandled error still fails the run.
    onUnhandledError(error) {
      const message = error?.message ?? '';
      const stack = error?.stack ?? '';
      if (
        message.includes('URL scheme "blob" is not supported') &&
        (stack.includes('BrowserFrameNavigator') || stack.includes('happy-dom'))
      ) {
        return false;
      }
    },
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      // Co-located component tests under __tests__ directories.
      // Used by per-domain feature folders (e.g. drone-plugins/__tests__/).
      // The inner `**` matters: with a single `*` a test grouped one level
      // deeper (__tests__/<area>/x.test.ts) is silently never collected, and a
      // skipped test is indistinguishable from a passing one in the summary.
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',
    ],
    exclude: ['tests/e2e/**', '**/*.node-test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/stores/**', 'src/hooks/**'],
      exclude: ['src/mock/**'],
      reporter: ['text', 'html', 'lcov'],
      // Global floor seeded a few points below the measured level so a drop
      // toward zero fails the build while normal run-to-run variance does
      // not. This floor is a ratchet: raise it as coverage climbs, never
      // lower it. Measured at the time of seeding: statements ~31%,
      // branches ~28%, functions ~29%, lines ~32%.
      thresholds: {
        statements: 28,
        branches: 24,
        functions: 25,
        lines: 29,
      },
    },
    benchmark: { include: ['tests/bench/**/*.bench.ts'] },
  },
});
