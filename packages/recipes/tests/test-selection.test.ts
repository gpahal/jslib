import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { describeValue, formatMessage } from '@gpahal/std/errors'

// Lists the test files that each package's `test` and `test-canaries` scripts select through the
// root Vitest config's projects: `test` runs no canary, and `test-canaries` runs all of them. The
// scripts run with `VITEST_CANARIES=1` exported, to check that such a variable doesn't change the
// selection

const REPO_DIR = path.join(import.meta.dirname, '../../..')

const PACKAGES_DIR = path.join(REPO_DIR, 'packages')

/**
 * Vitest's CLI, which the listings run with Node rather than through pnpm's `.bin` shim, since the
 * shim sets `NODE_PATH` to pnpm's store
 */
const VITEST = path.join(REPO_DIR, 'node_modules/vitest/vitest.mjs')

const execFileAsync = promisify(execFile)

/**
 * The environment without the test runner's `VITEST*` variables and `NODE_OPTIONS`, and with an
 * empty `NODE_PATH`, which pnpm points at its store for package scripts and which would hide a
 * missing dependency
 */
const RUNNER_FREE_ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('VITEST') && name !== 'NODE_OPTIONS',
    ),
  ),
  NODE_PATH: '',
}

const collator = new Intl.Collator('en')

/**
 * The files under `cwd` that `pattern` matches, outside `tests/tmp`, sorted
 */
async function glob(pattern: string, cwd: string): Promise<Array<string>> {
  const files: Array<string> = []
  const matches = fs.glob(pattern, { cwd, exclude: ['tests/tmp/**'] })
  for await (const file of matches) {
    files.push(file.replaceAll(path.sep, '/'))
  }
  return files.toSorted((a, b) => collator.compare(a, b))
}

const packages = await Promise.all(
  (await glob('*/package.json', PACKAGES_DIR)).map(async (file) => {
    type Manifest = { name: string; scripts?: Record<string, string> }
    const dir = path.join(PACKAGES_DIR, path.dirname(file))
    const manifest = JSON.parse(
      await fs.readFile(path.join(dir, 'package.json'), 'utf8'),
    ) as Manifest
    return { dir, manifest, canaries: await glob('tests/**/*.canary.test.ts', dir) }
  }),
)

const RUN = 'vitest run '

/**
 * The test files, relative to `dir` and sorted, that `script`, the `vitest run` command of the
 * package script `name`, selects
 */
async function listFiles(
  dir: string,
  name: string,
  script: string | undefined,
): Promise<Array<string>> {
  if (script?.startsWith(RUN) !== true) {
    throw new Error(
      formatMessage(
        '@gpahal/recipes',
        [`\`${path.relative(REPO_DIR, dir)}/package.json\``, `\`scripts.${name}\``],
        `expected a \`vitest run\` command, received ${describeValue(script)}`,
      ),
    )
  }
  // The shell gets Node's and Vitest's paths as `$0` and `$1`, so a space in them stays in one
  // word. The listing turns off the module cache, which it would share with the package's own
  // tests, since Vitest clears that cache under a running suite after a lockfile change
  const command = `"$0" "$1" list --filesOnly --json --no-fsModuleCache ${script.slice(RUN.length)}`
  const { stdout } = await execFileAsync('sh', ['-c', command, process.execPath, VITEST], {
    cwd: dir,
    env: { ...RUNNER_FREE_ENV, VITEST_CANARIES: '1' },
  })
  const files = JSON.parse(stdout) as Array<{ file: string }>
  return files
    .map(({ file }) => path.relative(dir, file).replaceAll(path.sep, '/'))
    .toSorted((a, b) => collator.compare(a, b))
}

const isCanary = (file: string): boolean => file.endsWith('.canary.test.ts')

describe.concurrent.each(packages)('$manifest.name', ({ dir, manifest, canaries }) => {
  const { test: testScript, 'test-canaries': canaryScript } = manifest.scripts ?? {}

  it('`test` runs test files and no canary', async () => {
    const files = await listFiles(dir, 'test', testScript)
    expect(files.filter((file) => isCanary(file))).toEqual([])
    expect(files.length).toBeGreaterThan(0)
  })

  it('has `test-canaries` only with canaries, running each of them and nothing else', async () => {
    expect(canaryScript !== undefined).toBe(canaries.length > 0)
    const files =
      canaryScript === undefined ? [] : await listFiles(dir, 'test-canaries', canaryScript)
    expect(files).toEqual(canaries)
  })
})
