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

/**
 * The lines that differ between `before` and `after`, by a longest common subsequence: `-n: line`
 * for line `n` of `before` that `after` drops, and `+n: line` for line `n` of `after` that it adds
 */
function lineDiff(before: string, after: string): Array<string> {
  const a = before.split('\n')
  const b = after.split('\n')
  // `common[i][j]`: the length of the longest common subsequence of `a.slice(i)` and `b.slice(j)`
  const common = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = common[i] ?? []
      row[j] =
        a[i] === b[j]
          ? (common[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(common[i + 1]?.[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  const lines: Array<string> = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++
      j++
    } else if (
      i < a.length &&
      (j === b.length || (common[i + 1]?.[j] ?? 0) >= (common[i]?.[j + 1] ?? 0))
    ) {
      lines.push(`-${String(i + 1)}: ${a[i] ?? ''}`)
      i++
    } else {
      lines.push(`+${String(j + 1)}: ${b[j] ?? ''}`)
      j++
    }
  }
  return lines
}

/**
 * The problems of `after` that `before` lacks, as `+ problem`, and the reverse, as `- problem`
 */
function problemsDiff(
  before: FileOutput['problems'] | undefined,
  after: FileOutput['problems'] | undefined,
): Array<string> {
  const listOf = (problems: FileOutput['problems'] | undefined) =>
    Array.isArray(problems) ? problems : [String(problems)]
  const removed = listOf(before).filter((problem) => !listOf(after).includes(problem))
  const added = listOf(after).filter((problem) => !listOf(before).includes(problem))
  return [...removed.map((problem) => `- ${problem}`), ...added.map((problem) => `+ ${problem}`)]
}

/**
 * The files of `variant` that differ from `defaults`, with their text and problems as differences
 */
function outputDiff(
  defaults: Record<string, FileOutput>,
  variant: Record<string, FileOutput>,
): Record<string, { text?: Array<string>; problems?: Array<string> }> {
  const files = [...new Set([...Object.keys(defaults), ...Object.keys(variant)])].toSorted((a, b) =>
    collator.compare(a, b),
  )
  return Object.fromEntries(
    files.flatMap((file) => {
      const text = lineDiff(defaults[file]?.text ?? '', variant[file]?.text ?? '')
      const problems = problemsDiff(defaults[file]?.problems, variant[file]?.problems)
      return text.length === 0 && problems.length === 0
        ? []
        : [
            [
              file,
              {
                ...(text.length > 0 && { text }),
                ...(problems.length > 0 && { problems }),
              },
            ],
          ]
    }),
  )
}

/**
 * The fixture's output with the defaults, which the other options' snapshots are differences from,
 * computed once
 */
const defaultsOutput: { promise?: ReturnType<typeof fixOutput> } = {}

async function getDefaultsOutput(): ReturnType<typeof fixOutput> {
  defaultsOutput.promise ??= fixOutput({})
  return defaultsOutput.promise
}

test('eslint --fix output with the defaults', async () => {
  const { files, diagnostics } = await getDefaultsOutput()
  expect(diagnostics).toStrictEqual([])
  expect(files).toMatchSnapshot()
})

test.concurrent.for([
  [
    'every preset on',
    {
      react: true,
      nextjs: true,
      astro: true,
      html: true,
      tailwindcss: { entryPoint: 'src/styles.css' },
      node: true,
      turbo: true,
      vitest: true,
      antislop: true,
    },
  ],
  ['typeAware: false in an editor', { typeAware: false, isInEditor: true }],
  // e18e's twins of `unicorn/prefer-at` and `unicorn/prefer-spread` run in their place
  ['unicorn: false', { unicorn: false }],
] satisfies Array<[string, Partial<EslintConfigOptions>]>)(
  'eslint --fix output with %s, as a difference from the defaults',
  // The context's `expect`, which concurrent snapshot tests need
  async ([, options], { expect }) => {
    const [{ files, diagnostics }, defaults] = await Promise.all([
      fixOutput(options),
      getDefaultsOutput(),
    ])
    expect(diagnostics).toStrictEqual([])
    expect(outputDiff(defaults.files, files)).toMatchSnapshot()
  },
)
