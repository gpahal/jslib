import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import { readCodeBlocks, readMarkdownSection, withTmpProject } from '@gpahal/internal/node/testing'
import { describeValue, formatMessage } from '@gpahal/std/errors'

const PACKAGE_DIR = path.join(import.meta.dirname, '..')

const README_PATH = path.join(PACKAGE_DIR, '../../README.md')

const FIXERS_HEADING = '### Running the fixers'

/**
 * The scripts of the README's "Running the fixers" section
 */
async function readScripts(): Promise<Record<string, string>> {
  const section = readMarkdownSection(await fs.readFile(README_PATH, 'utf8'), FIXERS_HEADING)
  const block = readCodeBlocks(section ?? '').find(({ language }) => language === 'json')
  if (block === undefined) {
    throw new Error(
      formatMessage(
        '@gpahal/stylelint-config',
        ['README'],
        `section ${describeValue(FIXERS_HEADING)} has no JSON block`,
      ),
    )
  }
  return (JSON.parse(block.code) as { scripts: Record<string, string> }).scripts
}

/**
 * The `fix` script and the `fix:*` scripts it runs
 */
async function readFixScripts(): Promise<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(await readScripts()).filter(
      ([name]) => name === 'fix' || name.startsWith('fix:'),
    ),
  )
}

/**
 * Runs `pnpm run <script>` in `dir`, with `NODE_PATH` and `NODE_OPTIONS` emptied, as `runNode` does,
 * so a missing link doesn't resolve through the test runner's `NODE_PATH`
 */
function runScript(dir: string, script: string): { status: number | null; output: string } {
  const { status, stdout, stderr } = spawnSync('pnpm', ['run', script], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
  })
  return { status, output: `${stdout}${stderr}` }
}

/**
 * Links this package's CLIs `names` into `dir`'s `node_modules/.bin`
 */
async function linkBins(dir: string, names: Array<string>) {
  const binDir = path.join(dir, 'node_modules/.bin')
  await fs.mkdir(binDir, { recursive: true })
  for (const name of names) {
    await fs.symlink(path.join(PACKAGE_DIR, 'node_modules/.bin', name), path.join(binDir, name))
  }
}

/**
 * A `debugger` statement, which ESLint can't fix, and a `let` that `prefer-const` fixes
 */
const JS = 'let a = 1\ndebugger\nexport { a }\n'

/**
 * Unformatted CSS with a media query range for `media-feature-range-notation` to fix
 */
const CSS = '@media (max-width:100px){a{color:red}}\n'

// Runs the README's `fix` script with pnpm in a project that uses this package's build and
// `@gpahal/prettier-config`. The project's `node_modules/.bin` links this package's ESLint, Prettier
// and Stylelint CLIs
describe("the README's fix script", () => {
  let project: Awaited<ReturnType<typeof withTmpProject>>
  let dir: string

  beforeAll(async () => {
    const prettierConfigUrl = import.meta.resolve('@gpahal/prettier-config')
    const stylelintConfigUrl = import.meta.resolve('@gpahal/stylelint-config')
    project = await withTmpProject('stylelint-config-fix-script', {
      'package.json': `${JSON.stringify({ type: 'module', scripts: await readFixScripts() })}\n`,
      '.gitignore': 'node_modules\n',
      'eslint.config.mjs':
        "export default [{ rules: { 'no-debugger': 'error', 'prefer-const': 'error' } }]\n",
      'prettier.config.mjs': `import { defineConfig } from ${JSON.stringify(prettierConfigUrl)}\n\nexport default defineConfig({ root: import.meta.dirname })\n`,
      'stylelint.config.mjs': `import { defineConfig } from ${JSON.stringify(stylelintConfigUrl)}\n\nexport default await defineConfig({ root: import.meta.dirname })\n`,
      'index.js': JS,
      'style.css': CSS,
    })
    dir = project.dir
    await linkBins(dir, ['eslint', 'prettier', 'stylelint'])
  })

  afterAll(async () => {
    await project[Symbol.asyncDispose]()
  })

  it('runs every fixer after an ESLint error and fails', async () => {
    const { status, output } = runScript(dir, 'fix')

    expect(status, output).not.toBe(0)
    expect(output).toContain('no-debugger')
    expect(await fs.readFile(path.join(dir, 'index.js'), 'utf8')).toBe(
      'const a = 1\ndebugger\nexport { a }\n',
    )
    expect(await fs.readFile(path.join(dir, 'style.css'), 'utf8')).toBe(
      '@media (width <= 100px) {\n  a {\n    color: red;\n  }\n}\n',
    )
  })
})
