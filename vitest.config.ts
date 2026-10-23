import { readFileSync } from 'node:fs'

import { configDefaults, defineConfig, type ViteUserConfig } from 'vitest/config'

const resolve: NonNullable<ViteUserConfig['resolve']> = { tsconfigPaths: true }

/**
 * The canaries, which fail once upstream fixes a bug that a workaround exists for. They run in the
 * `test-canaries` task, which sets `VITEST_CANARIES=1`, instead of `test`
 */
const CANARIES = 'tests/**/*.canary.test.ts'

const { VITEST_CANARIES } = process.env

const isCanaryRun = VITEST_CANARIES === '1'

function isCanary(file: string): boolean {
  return file.endsWith('.canary.test.ts')
}

const UTILS_PATH = 'packages/eslint-config/src/internal/utils.ts'

/**
 * eslint-config's `WARNING_CODES`, read from its source: importing the module would load
 * `@gpahal/std`'s build, which a package's tests don't wait for, and moving the list to a module
 * of its own would change eslint-config's declarations
 *
 * @throws Error when the source has no `WARNING_CODES` array of codes.
 */
function readWarningCodes(): Array<string> {
  const source = readFileSync(new URL(UTILS_PATH, import.meta.url), 'utf8')
  const [, list = ''] = /^export const WARNING_CODES = \[([^\]]*)\] as const$/m.exec(source) ?? []
  const codes = list
    .matchAll(/'(GPAHAL_\w+)'/g)
    .map(([, code = '']) => code)
    .toArray()
  if (codes.length === 0) {
    // The repo's error shape, written by hand, since a root config imports no workspace package
    throw new Error(
      `jslib: \`vitest.config.ts\`: \`${UTILS_PATH}\`: expected an \`export const WARNING_CODES = [...] as const\` of codes`,
    )
  }
  return codes
}

const config: ViteUserConfig = defineConfig({
  resolve,
  test: {
    globals: true,
    // Turbo hashes only the files git tracks, so a test in a gitignored folder could fail while
    // turbo replays a cached pass
    include: [isCanaryRun ? CANARIES : 'tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/tmp/**', ...(isCanaryRun ? [] : [CANARIES])],
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
    // and processes the tests spawn still print them
    execArgv: readWarningCodes().map((code) => `--disable-warning=${code}`),
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
  // Only the isolated files of this run, the canaries or the others
  const isolatedFiles = isolated.filter((file) => isCanary(file) === isCanaryRun)
  return {
    ...config,
    test: {
      ...options,
      projects: [
        project('shared', { isolate: false, exclude: [...exclude, ...isolatedFiles] }),
        ...(isolatedFiles.length > 0 ? [project('isolated', { include: isolatedFiles })] : []),
      ],
    },
  }
}

/**
 * The type of a Vitest config, for a package's config file without its own Vitest dependency
 */
export type VitestConfig = ViteUserConfig
