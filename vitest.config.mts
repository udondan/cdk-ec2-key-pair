import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Count every source file, also the ones no test imports.
      include: ['lib/**/*.ts', 'lambda/**/*.ts'],
      // lib/types.ts is a symlink to lambda/types.ts.
      exclude: ['**/*.d.ts', 'lib/types.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { 100: true },
    },
  },
});
