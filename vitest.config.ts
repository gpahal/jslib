import { configDefaults, defineConfig, type ViteUserConfig } from 'vitest/config'

const resolve: NonNullable<ViteUserConfig['resolve']> = { tsconfigPaths: true }

const config: ViteUserConfig = defineConfig({
  resolve,
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

export default config

const { include = [], exclude = [], ...options } = config.test ?? {}

/**
 * The config of a package whose test files share a worker's modules, so modules that every file
 * imports load once per worker. The files of `isolated` get modules of their own
 */
export function withSharedModules(isolated: Array<string>): ViteUserConfig {
  // A project's `include` adds to the root level's, so only the projects have one
  const project = (
    name: string,
    test: { isolate?: boolean; include?: Array<string>; exclude?: Array<string> },
  ) => ({
    resolve,
    test: { ...options, name, include, exclude, ...test },
  })
  return {
    ...config,
    test: {
      ...options,
      projects: [
        project('shared', { isolate: false, exclude: [...exclude, ...isolated] }),
        project('isolated', { include: isolated }),
      ],
    },
  }
}

/**
 * The type of a Vitest config, for a package's config file without its own Vitest dependency
 */
export type VitestConfig = ViteUserConfig
