import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { ESLint, Linter } from 'eslint'

import { runNode, runNodeOk } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'
import { isInEditorEnvOf, type EditorEnv } from '@/internal/editor'

import { CORE_AREAS_OFF, CORE_AREAS_OFF_SOURCE, eslintWith, withProject } from './helpers'

const ESLINT_DIR = path.dirname(fileURLToPath(import.meta.resolve('eslint/package.json')))
const ESLINT_BIN = path.join(ESLINT_DIR, 'bin', 'eslint.js')

const PREFER_CONST = 'export function one() {\n  let a = 1\n  return a\n}\n'
const DISABLED_PREFER_CONST =
  'export function one() {\n  // eslint-disable-next-line prefer-const -- reason\n  let a = 1\n  return a\n}\n'

const FIXED_PREFER_CONST = 'export function one() {\n  const a = 1\n  return a\n}\n'

/**
 * Lints `src/index.js` of the working directory with `--fix`, as an editor would, with the
 * `defineConfig` of `CONFIG_URL` and each ESLint of `ESLINT_URLS`, and prints the rules that report
 * and the output of each. The config turns off the areas the test doesn't check, since loading them
 * makes up most of the time a fresh process takes to build the config
 */
const COPY_SCRIPT = `
const { defineConfig } = await import(process.env.CONFIG_URL)
const cwd = process.cwd()
const results = []
for (const eslintUrl of JSON.parse(process.env.ESLINT_URLS)) {
  const { ESLint } = await import(eslintUrl)
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: await defineConfig({ root: cwd, isInEditor: true, typeAware: false, ${CORE_AREAS_OFF_SOURCE} }),
    fix: true,
  })
  const [result] = await eslint.lintFiles(['src/index.js'])
  results.push({ ruleIds: result.messages.map((message) => message.ruleId), output: result.output })
}
console.log(JSON.stringify(results))
`

test("in an editor, prefer-const reports without fixing through the project's eslint and the config's own copy", async () => {
  await using project = await withProject({
    'app/package.json': '{ "name": "app", "type": "module" }\n',
    'app/eslint.config.mjs': 'export default []\n',
    'app/src/index.js': PREFER_CONST,
  })
  const packageDir = path.join(import.meta.dirname, '..')
  const appModules = path.join(project.dir, 'app', 'node_modules')
  const configDir = path.join(appModules, '@gpahal', 'eslint-config')
  // A second copy of eslint, with its dependencies, which the package manager gives the config
  // when it can't share the project's
  const copyModules = path.join(project.dir, 'copy', 'node_modules')
  await fs.cp(path.dirname(await fs.realpath(ESLINT_DIR)), copyModules, { recursive: true })
  await fs.mkdir(path.join(configDir, 'node_modules'), { recursive: true })
  await fs.copyFile(path.join(packageDir, 'package.json'), path.join(configDir, 'package.json'))
  await fs.cp(path.join(packageDir, 'build'), path.join(configDir, 'build'), { recursive: true })
  await fs.symlink(path.join(copyModules, 'eslint'), path.join(configDir, 'node_modules', 'eslint'))
  const { dependencies } = JSON.parse(
    await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'),
  ) as { dependencies: Record<string, string> }
  await Promise.all(
    Object.keys(dependencies).map(async (name) => {
      const link = path.join(appModules, name)
      await fs.mkdir(path.dirname(link), { recursive: true })
      await fs.symlink(await fs.realpath(path.join(packageDir, 'node_modules', name)), link)
    }),
  )
  await fs.symlink(await fs.realpath(ESLINT_DIR), path.join(appModules, 'eslint'))
  // One process, as the copies load apart: each from its own real path
  const stdout = await runNodeOk(['--input-type=module', '--eval', COPY_SCRIPT], {
    cwd: path.join(project.dir, 'app'),
    env: {
      CONFIG_URL: pathToFileURL(path.join(configDir, 'build', 'index.js')).href,
      ESLINT_URLS: JSON.stringify(
        [appModules, copyModules].map(
          (modules) => pathToFileURL(path.join(modules, 'eslint', 'lib', 'api.js')).href,
        ),
      ),
    },
  })
  expect(JSON.parse(stdout)).toEqual([{ ruleIds: ['prefer-const'] }, { ruleIds: ['prefer-const'] }])
})

// report-only.test.ts checks the report-only fixes, which are the same in and outside an editor
test('in one process, configs made in and outside an editor each fix as they say', async () => {
  await using project = await withProject({
    'package.json': '{ "name": "fixes", "type": "module" }\n',
    'src/prefer-const.js': PREFER_CONST,
    'src/disabled.js': DISABLED_PREFER_CONST,
  })
  const options = { root: project.dir, gitignore: false, typeAware: false, ...CORE_AREAS_OFF }
  // Every config is made before any lints, so each rule is patched for all of them at once
  const configs = {
    terminal: await defineConfig({ ...options, isInEditor: false }),
    editor: await defineConfig({ ...options, isInEditor: true }),
  }
  const fixAll = async (config: Array<Linter.Config>) => {
    const results = await eslintWith(project.dir, config, { fix: true }).lintFiles(['src'])
    return Object.fromEntries(
      results.map((result) => [path.relative(project.dir, result.filePath), result]),
    )
  }
  const isFixed = (byFile: Record<string, ESLint.LintResult>) =>
    Object.fromEntries(
      Object.entries(byFile).map(([file, result]) => [file, result.output !== undefined]),
    )

  const terminal = await fixAll(configs.terminal)
  expect(isFixed(terminal)).toEqual({ 'src/prefer-const.js': true, 'src/disabled.js': false })
  expect(terminal['src/prefer-const.js']?.output).toBe(FIXED_PREFER_CONST)

  const editor = await fixAll(configs.editor)
  expect(isFixed(editor)).toEqual({ 'src/prefer-const.js': false, 'src/disabled.js': false })
  expect(editor['src/prefer-const.js']?.messages.map((message) => message.ruleId)).toEqual([
    'prefer-const',
  ])
  // A disable comment names the rule, as outside an editor
  expect(editor['src/disabled.js']?.messages).toEqual([])
})

describe('editor detection', () => {
  const vscode = { VSCODE_PID: '1' }
  const server = ['/usr/bin/node', '/ext/dbaeumer.vscode-eslint/server/out/eslintServer.js']

  it.each<[string, EditorEnv, boolean]>([
    ['an editor language server', { env: vscode, argv: server }, true],
    ['no editor', { env: {}, argv: server }, false],
    ['a package script', { env: { ...vscode, npm_lifecycle_event: 'lint' }, argv: server }, false],
    [
      "ESLint's bin with its output piped",
      { env: vscode, argv: ['/usr/bin/node', '/p/node_modules/eslint/bin/eslint.js'] },
      false,
    ],
    [
      'an ESLint `--concurrency` worker',
      { env: vscode, argv: ['/usr/bin/node', '/p/node_modules/eslint/lib/eslint/worker.js'] },
      false,
    ],
    ["Zed's terminal", { env: { ZED_ENVIRONMENT: 'cli', ZED_TERM: 'true' }, argv: server }, false],
  ])('%s is an editor: %s', (_name, editorEnv, expected) => {
    expect(isInEditorEnvOf(editorEnv)).toBe(expected)
  })
})

test("ESLint's `--concurrency` workers run its worker script at the path editor detection matches", async () => {
  // Editor detection treats this script as ESLint's command line. If ESLint moves it, update
  // ESLINT_BIN_PATTERN in src/internal/editor.ts
  await expect(
    fs.access(path.join(ESLINT_DIR, 'lib', 'eslint', 'worker.js')),
  ).resolves.toBeUndefined()
  const eslintSource = await fs.readFile(
    path.join(ESLINT_DIR, 'lib', 'eslint', 'eslint.js'),
    'utf8',
  )
  expect(eslintSource).toContain('"./worker.js"')
})

// ESLint's `--concurrency` workers are worker threads that each load the config again
test("ESLint's bin fixes, in `--concurrency` workers too, with an editor's variables set and its output piped, and warns once, from the main thread", async () => {
  await using project = await withProject({
    // `turbo` without the `turbo` option, for a setup warning
    'package.json': '{ "name": "bin", "type": "module", "devDependencies": { "turbo": "*" } }\n',
    'index.js': PREFER_CONST,
    'a.js': PREFER_CONST,
    'b.js': PREFER_CONST,
    'eslint.config.mjs': `import { defineConfig } from ${JSON.stringify(new URL('../build/index.js', import.meta.url).href)}\n\nexport default defineConfig({ root: import.meta.dirname, typeAware: false, ${CORE_AREAS_OFF_SOURCE} })\n`,
  })
  // ESLint's bin as the script, so `process.argv` is as when it runs, not from a package script,
  // as when an agent in an editor's terminal runs it
  const fix = async (...args: Array<string>) =>
    runNode(
      [
        '--input-type=module',
        '--eval',
        `await import(${JSON.stringify(pathToFileURL(ESLINT_BIN).href)})`,
        ESLINT_BIN,
        '--fix',
        ...args,
      ],
      {
        cwd: project.dir,
        env: { VSCODE_PID: '1', npm_lifecycle_event: '', npm_lifecycle_script: '', CI: '' },
      },
    )
  // Separate files, so the runs can't race
  const runs = await Promise.all([fix('index.js'), fix('--concurrency', '2', 'a.js', 'b.js')])
  expect(runs.map(({ status }) => status)).toEqual([0, 0])
  for (const file of ['index.js', 'a.js', 'b.js']) {
    expect(await fs.readFile(path.join(project.dir, file), 'utf8'), file).toBe(FIXED_PREFER_CONST)
  }
  expect(runs[1].stderr.split('GPAHAL_FRAMEWORK_OPTION_UNSET')).toHaveLength(2)
})
