import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { ESLint, Linter } from 'eslint'

import { assertBuildIsCurrent, runNodeOk } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'
import { isInEditorEnvOf, type EditorEnv } from '@/internal/editor'

import { BUILD_DIR, CORE_AREAS_OFF_SOURCE, eslintWith, withProject } from './helpers'

beforeAll(async () => assertBuildIsCurrent(BUILD_DIR))

const ESLINT_DIR = path.dirname(fileURLToPath(import.meta.resolve('eslint/package.json')))
const ESLINT_BIN = path.join(ESLINT_DIR, 'bin', 'eslint.js')

const PREFER_CONST = 'export function one() {\n  let a = 1\n  return a\n}\n'
const DISABLED_PREFER_CONST =
  'export function one() {\n  // eslint-disable-next-line prefer-const -- reason\n  let a = 1\n  return a\n}\n'

const FIXED_PREFER_CONST = 'export function one() {\n  const a = 1\n  return a\n}\n'

/**
 * The options that turn off the areas these tests' child processes don't check, since loading them
 * makes up most of the time a fresh process takes to build the config
 */
const COPY_SCRIPT = `
const { defineConfig } = await import(process.env.CONFIG_URL)
const { ESLint } = await import(process.env.ESLINT_URL)
const cwd = process.cwd()
const eslint = new ESLint({
  cwd,
  overrideConfigFile: true,
  overrideConfig: await defineConfig({ root: cwd, isInEditor: true, typeAware: false, ${CORE_AREAS_OFF_SOURCE} }),
  fix: true,
})
const [result] = await eslint.lintFiles(['src/index.js'])
console.log(JSON.stringify({ ruleIds: result.messages.map((message) => message.ruleId), output: result.output }))
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
  await Promise.all(
    [path.join(appModules, 'eslint'), path.join(copyModules, 'eslint')].map(async (eslintDir) => {
      const stdout = await runNodeOk(['--input-type=module', '--eval', COPY_SCRIPT], {
        cwd: path.join(project.dir, 'app'),
        env: {
          CONFIG_URL: pathToFileURL(path.join(configDir, 'build', 'index.js')).href,
          ESLINT_URL: pathToFileURL(path.join(eslintDir, 'lib', 'api.js')).href,
        },
      })
      expect(JSON.parse(stdout), eslintDir).toEqual({ ruleIds: ['prefer-const'] })
    }),
  )
})

const ASYNC_RETURN =
  "export function load(ok: boolean): Promise<number> {\n  if (!ok) {\n    throw new Error('sync')\n  }\n  return Promise.resolve(1)\n}\n"
const LAST_ITEM = 'export function last(list) {\n  return list[list.length - 1]\n}\n'

test('in one process, configs made in and outside an editor, and one with the report-only fixes removed, each fix as they say', async () => {
  await using project = await withProject({
    'package.json': '{ "name": "fixes", "type": "module" }\n',
    'tsconfig.json':
      '{ "compilerOptions": { "strict": true, "noEmit": true }, "include": ["src"] }\n',
    'src/prefer-const.js': PREFER_CONST,
    'src/disabled.js': DISABLED_PREFER_CONST,
    'src/async-return.ts': ASYNC_RETURN,
    'src/last.js': LAST_ITEM,
    'src/last.ts': LAST_ITEM.replace('(list)', '(list: Array<number>): number | undefined'),
  })
  const options = { root: project.dir, gitignore: false } as const
  // Every config is made before any lints, so each rule is patched for all of them at once
  const configs = {
    terminal: await defineConfig({ ...options, isInEditor: false }),
    editor: await defineConfig({ ...options, isInEditor: true }),
    fixesOn: await defineConfig({ ...options, isInEditor: false })
      .remove('gpahal/fixes/report-only')
      .remove('gpahal/fixes/report-only-untyped'),
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
  const terminalFixes = {
    'src/prefer-const.js': true,
    'src/disabled.js': false,
    'src/async-return.ts': false,
    'src/last.js': false,
    'src/last.ts': true,
  }
  const editorFixes = { ...terminalFixes, 'src/prefer-const.js': false }

  const terminal = await fixAll(configs.terminal)
  expect(isFixed(terminal)).toEqual(terminalFixes)
  expect(terminal['src/prefer-const.js']?.output).toBe(FIXED_PREFER_CONST)
  // A file with type information keeps the fix, since the type checker reports an array-like there
  expect(terminal['src/last.ts']?.output).toContain('list.at(-1)')

  const editor = await fixAll(configs.editor)
  expect(isFixed(editor)).toEqual(editorFixes)
  expect(editor['src/prefer-const.js']?.messages.map((message) => message.ruleId)).toEqual([
    'prefer-const',
  ])
  // A disable comment names the rule, as outside an editor
  expect(editor['src/disabled.js']?.messages).toEqual([])
  expect(isFixed(await fixAll(configs.fixesOn))).toEqual({
    ...terminalFixes,
    'src/async-return.ts': true,
    'src/last.js': true,
  })
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

test("ESLint's bin fixes, in `--concurrency` workers too, with an editor's variables set and its output piped", async () => {
  await using project = await withProject({
    'package.json': '{ "name": "bin", "type": "module" }\n',
    'index.js': PREFER_CONST,
    'a.js': PREFER_CONST,
    'b.js': PREFER_CONST,
    'eslint.config.mjs': `import { defineConfig } from ${JSON.stringify(new URL('../build/index.js', import.meta.url).href)}\n\nexport default defineConfig({ root: import.meta.dirname, typeAware: false, ${CORE_AREAS_OFF_SOURCE} })\n`,
  })
  // ESLint's bin as the script, so `process.argv` is as when it runs, not from a package script,
  // as when an agent in an editor's terminal runs it
  const fix = async (...args: Array<string>) =>
    runNodeOk(
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
  await Promise.all([fix('index.js'), fix('--concurrency', '2', 'a.js', 'b.js')])
  for (const file of ['index.js', 'a.js', 'b.js']) {
    expect(await fs.readFile(path.join(project.dir, file), 'utf8'), file).toBe(FIXED_PREFER_CONST)
  }
})
