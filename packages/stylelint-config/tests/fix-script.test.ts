import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertBuildIsCurrent, withTmpProject } from '@gpahal/internal/node/testing'

const PACKAGE_DIR = path.join(import.meta.dirname, '..')

const README_PATH = path.join(PACKAGE_DIR, '../../README.md')

/**
 * The `fix` script and the `fix:*` scripts it runs, from the README's recipe
 */
async function readFixScripts(): Promise<Record<string, string>> {
  const readme = await fs.readFile(README_PATH, 'utf8')
  const section = readme.slice(readme.indexOf('### Running the fixers'))
  const json = /```json\n(?<json>[\s\S]*?)\n```/.exec(section)?.groups?.['json']
  if (json === undefined) {
    throw new Error('No JSON block in the README\'s "Running the fixers" section')
  }
  const { scripts } = JSON.parse(json) as { scripts: Record<string, string> }
  return Object.fromEntries(
    Object.entries(scripts).filter(([name]) => name === 'fix' || name.startsWith('fix:')),
  )
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
    for (const url of [prettierConfigUrl, stylelintConfigUrl]) {
      await assertBuildIsCurrent(path.dirname(fileURLToPath(url)))
    }
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
    const binDir = path.join(dir, 'node_modules/.bin')
    await fs.mkdir(binDir, { recursive: true })
    for (const name of ['eslint', 'prettier', 'stylelint']) {
      await fs.symlink(path.join(PACKAGE_DIR, 'node_modules/.bin', name), path.join(binDir, name))
    }
  })

  afterAll(async () => {
    await project[Symbol.asyncDispose]()
  })

  it('runs every fixer after an ESLint error and fails', async () => {
    const { status, stdout, stderr } = spawnSync('pnpm', ['run', 'fix'], {
      cwd: dir,
      encoding: 'utf8',
    })
    const output = `${stdout}${stderr}`

    expect(status, output).not.toBe(0)
    expect(output).toContain('no-debugger')
    expect(await fs.readFile(path.join(dir, 'index.js'), 'utf8')).toBe(
      'const a = 1\ndebugger\nexport { a }\n',
    )
    expect(await fs.readFile(path.join(dir, 'style.css'), 'utf8')).toBe(
      '@media (width <= 100px) {\n  a {\n    color: red;\n  }\n}\n',
    )
  }, 60_000)
})
