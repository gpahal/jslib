import fs from 'node:fs/promises'
import path from 'node:path'

import { ESLint } from 'eslint'

import { defineConfig, type EslintConfigOptions } from '@/index'

import { typeCheck } from './fix-helpers'
import { collator, FIXTURES_DIR, withProject } from './helpers'

const FIXTURE_DIR = path.join(FIXTURES_DIR, 'fix-output')

/**
 * Each file of `dir` by its `/`-separated path relative to `dir`, sorted, but `node_modules`
 */
async function listFiles(dir: string): Promise<Array<string>> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
    )
    .filter((file) => !file.startsWith('node_modules/'))
    .toSorted((a, b) => collator.compare(a, b))
}

/**
 * A file's text after `eslint --fix`, and the problems left in it
 */
type FileOutput = { text: string; problems: Array<string> | 'not linted' }

/**
 * Every file of the fixture after `eslint --fix` with `options`, and the problems left in it, as
 * `line:column rule`. The fixture is copied to a temporary folder, whose `node_modules` is this
 * package's, so the presets' peers resolve
 */
async function fixOutput(
  options: Partial<EslintConfigOptions>,
): Promise<{ files: Record<string, FileOutput>; diagnostics: Array<string> }> {
  await using project = await withProject()
  await fs.cp(FIXTURE_DIR, project.dir, { recursive: true })
  await fs.symlink(
    path.join(import.meta.dirname, '..', 'node_modules'),
    path.join(project.dir, 'node_modules'),
  )
  const eslint = new ESLint({
    cwd: project.dir,
    overrideConfigFile: true,
    overrideConfig: await defineConfig({
      root: project.dir,
      isInEditor: false,
      ...options,
    }),
    fix: true,
  })
  const results = await eslint.lintFiles(['.'])
  await ESLint.outputFixes(results)
  // The fixes converge: a second `--fix` finds nothing to change
  const unsettled = (await eslint.lintFiles(['.']))
    .filter((result) => result.output !== undefined)
    .map((result) => path.relative(project.dir, result.filePath))
  if (unsettled.length > 0) {
    throw new Error(`a second \`eslint --fix\` changed ${unsettled.join(', ')}`)
  }
  const problems = new Map(
    results.map((result) => [
      path.relative(project.dir, result.filePath).split(path.sep).join('/'),
      result.messages.map(
        (message) => `${message.line}:${message.column} ${message.ruleId ?? 'fatal'}`,
      ),
    ]),
  )
  const files = await listFiles(project.dir)
  return {
    files: Object.fromEntries(
      await Promise.all(
        files.map(async (file): Promise<[string, FileOutput]> => [
          file,
          {
            text: await fs.readFile(path.join(project.dir, file), 'utf8'),
            problems: problems.get(file) ?? 'not linted',
          },
        ]),
      ),
    ),
    diagnostics: typeCheck(project.dir),
  }
}

// One run with every preset that lints a file of the fixture, so a change to a preset's rules,
// fixes or patches shows as a snapshot diff. `editor.test.ts` checks the editor's fixes
test('eslint --fix output with every preset on', async () => {
  const { files, diagnostics } = await fixOutput({
    react: true,
    nextjs: true,
    astro: true,
    html: true,
    tailwindcss: { entryPoint: 'src/styles.css' },
    node: true,
    turbo: true,
    vitest: true,
    antislop: true,
  })
  expect(diagnostics).toStrictEqual([])
  expect(files).toMatchSnapshot()
})
