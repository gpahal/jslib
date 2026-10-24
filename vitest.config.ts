import { configDefaults, defineConfig } from 'vitest/config'
import type { ViteUserConfig } from 'vitest/config'

const resolve: NonNullable<ViteUserConfig['resolve']> = { tsconfigPaths: true }

type TestOptions = NonNullable<ViteUserConfig['test']>

/**
 * The canaries, which fail once upstream fixes a bug that a workaround exists for. They make a
 * project of their own, which only the `test-canaries` task selects
 */
const CANARIES = 'tests/**/*.canary.test.ts'

function isCanary(file: string): boolean {
  return file.endsWith('.canary.test.ts')
}

/**
 * Turbo hashes only the files git tracks, so a test in a gitignored folder could fail while turbo
 * replays a cached pass
 */
const EXCLUDE = [...configDefaults.exclude, 'tests/tmp/**']

const options = {
  globals: true,
  // Fails on a missing snapshot instead of writing it, so `pnpm check` can't pass by writing files
  update: 'none',
  // typescript-eslint assumes a single run when `CI=true` and never refreshes a file's program, so
  // a test that lints new text under a path it already linted would get stale type information
  env: { TSESTREE_SINGLE_RUN: 'false' },
  // Under `pnpm check`, Turbo runs every package's tests alongside the lint and type-checks, and a
  // 4-vCPU CI runner is several times slower than a workstation. A timeout only catches hangs
  testTimeout: 120_000,
  hookTimeout: 120_000,
  // Each package keeps its own module cache. Vitest clears the cache when the lockfile changes, and
  // packages that Turbo starts together would otherwise clear a shared one under each other
  fsModuleCachePath: 'node_modules/.vitest-cache',
} satisfies TestOptions

type Project = { name: string } & Pick<TestOptions, 'include' | 'exclude' | 'isolate'>

/**
 * A config of named projects, which the scripts select with `--project`: `test` runs `tests*` and
 * `test-canaries` runs `canaries`. `extra` adds to every project's options
 */
function withProjects(projects: Array<Project>, extra: TestOptions): ViteUserConfig {
  return {
    resolve,
    test: {
      ...options,
      ...extra,
      projects: projects.map((test) => ({ resolve, test: { ...options, ...extra, ...test } })),
    },
  }
}

const config: ViteUserConfig = defineConfig(
  withProjects(
    [
      { name: 'tests', include: ['tests/**/*.test.ts'], exclude: [...EXCLUDE, CANARIES] },
      { name: 'canaries', include: [CANARIES], exclude: EXCLUDE },
    ],
    {},
  ),
)

export default config

/**
 * The config of a package whose test files share a worker's modules, so modules that every file
 * imports load once per worker. The files of `isolated` get modules of their own: those that aren't
 * canaries in the `tests-isolated` project, and canaries by isolating the whole `canaries` project.
 * `extra` adds to every project's options
 */
export function withSharedModules(
  isolated: Array<string>,
  extra: TestOptions = {},
): ViteUserConfig {
  const isolatedTests = isolated.filter((file) => !isCanary(file))
  return withProjects(
    [
      {
        name: 'tests',
        isolate: false,
        include: ['tests/**/*.test.ts'],
        exclude: [...EXCLUDE, CANARIES, ...isolatedTests],
      },
      ...(isolatedTests.length > 0
        ? [{ name: 'tests-isolated', include: isolatedTests, exclude: EXCLUDE }]
        : []),
      { name: 'canaries', isolate: isolated.some(isCanary), include: [CANARIES], exclude: EXCLUDE },
    ],
    extra,
  )
}

/**
 * The type of a Vitest config, for a package's config file without its own Vitest dependency
 */
export type VitestConfig = ViteUserConfig
