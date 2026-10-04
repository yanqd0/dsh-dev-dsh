import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // `3rdp/deepseek-harness` is a gitignored, read-only reference checkout of
    // the whole harness monorepo. It is not part of this package, but its
    // thousands of test files sit inside the vitest root — scanning them makes
    // a bare `vitest run` load a foreign test tree and crash.
    exclude: [...configDefaults.exclude, '3rdp/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // `src/client-entry.ts` is a build-only browser entry: Node never executes
      // it, and `src/keyboard/client-bundle.test.ts` verifies its reachable path
      // from the built `dist/client.js` instead.
      exclude: ['src/client-entry.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
