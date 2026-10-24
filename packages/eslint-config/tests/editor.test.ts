import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ESLint, Linter } from 'eslint'

import { defineConfig } from '@/index'
import { isInEditorEnvOf } from '@/internal/editor'
import type { EditorEnv } from '@/internal/editor'

import { CORE_AREAS_OFF, eslintWith, withProject } from './helpers'

const ESLINT_DIR = path.dirname(fileURLToPath(import.meta.resolve('eslint/package.json')))

const PREFER_CONST = 'export function one() {\n  let a = 1\n  return a\n}\n'
const DISABLED_PREFER_CONST =
  'export function one() {\n  // eslint-disable-next-line prefer-const -- reason\n  let a = 1\n  return a\n}\n'

const FIXED_PREFER_CONST = 'export function one() {\n  const a = 1\n  return a\n}\n'

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

test("ESLint's `--concurrency` workers run its worker script at the path editor detection matches, with the `workerData` that `isESLintWorker` reads", async () => {
  // Editor detection treats this script as ESLint's command line. If ESLint moves it, update
  // ESLINT_BIN_PATTERN in src/internal/editor.ts. The setup warnings are given only outside the
  // workers, which `isESLintWorker` in src/internal/utils.ts tells by these `workerData` keys
  await expect(
    fs.access(path.join(ESLINT_DIR, 'lib', 'eslint', 'worker.js')),
  ).resolves.toBeUndefined()
  const eslintSource = await fs.readFile(
    path.join(ESLINT_DIR, 'lib', 'eslint', 'eslint.js'),
    'utf8',
  )
  expect(eslintSource).toContain('"./worker.js"')
  expect(eslintSource).toMatch(/workerData: \{\s*eslintOptionsOrURL,\s*filePathIndexArray,/)
})
