import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    // Turbo hashes only the files git tracks, so a test in a gitignored folder could fail while
    // turbo replays a cached pass
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/tmp/**'],
    // Fails on a missing snapshot instead of writing it, so `pnpm check` can't pass by writing
    // files
    update: 'none',
    // typescript-eslint assumes a single run when `CI=true` and never refreshes a file's program,
    // so a test that lints new text under a path it already linted would get stale type information
    env: { TSESTREE_SINGLE_RUN: 'false' },
  },
})
