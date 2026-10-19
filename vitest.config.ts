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
    // Turbo runs every package's tests alongside the lint and type-checks, so a 4-vCPU CI runner
    // takes several times a workstation's time. A timeout only catches hangs
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Tests that build configs for fixture projects trigger eslint-config's setup warnings without
    // checking them. This stops only the printing: spies on `process.emitWarning` still see them,
    // and processes the tests spawn still print them. The codes are its `WARNING_CODES`
    execArgv: [
      'GPAHAL_FRAMEWORK_OPTION_UNSET',
      'GPAHAL_UNSUPPORTED_FRAMEWORK',
      'GPAHAL_COMMONJS_PACKAGE',
      'GPAHAL_NO_TSCONFIG',
      'GPAHAL_FILES_OUTSIDE_TSCONFIG',
      'GPAHAL_DEFAULT_PROJECT_NODE_TYPES',
      'GPAHAL_LARGE_DEFAULT_PROJECT',
      'GPAHAL_ASTRO_TYPES_MISSING',
      'GPAHAL_ASTRO_JSX_A11Y_MISSING',
      'GPAHAL_PLAYWRIGHT_FILES_UNMATCHED',
      'GPAHAL_GITIGNORE_WILDCARDS',
      'GPAHAL_ROOT_GITIGNORED',
      'GPAHAL_PEER_NEWER_THAN_RANGE',
      'GPAHAL_SONARJS_TYPESCRIPT_COPY',
    ].map((code) => `--disable-warning=${code}`),
  },
})
