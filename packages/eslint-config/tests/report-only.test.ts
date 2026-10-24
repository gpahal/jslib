import fs from 'node:fs/promises'
import path from 'node:path'

import type { ESLint, Linter } from 'eslint'

import { writeFiles } from '@gpahal/internal/node/testing'

import { defineConfig } from '@/index'
import { REPORT_ONLY_RULES, UNTYPED_REPORT_ONLY_RULES } from '@/internal/fix-policy'

import {
  collator,
  CORE_AREAS_OFF,
  createFocusedESLint,
  focusedESLintWith,
  ruleIdOf,
  withProject,
} from './helpers'

// The report-only configs drop a report-only rule's fix and keep its report. Which rules are
// report-only, and why, is in `src/internal/fix-policy.ts`

/**
 * Code that a report-only rule's fix would change, by file, with the rule. An untyped rule and two
 * that need type information
 */
const CASES: Record<string, { rule: string; text: string }> = {
  'src/object-shorthand.js': {
    rule: 'object-shorthand',
    text: 'export const factory = {\n  make: function () {\n    this.made = true\n  },\n}\n',
  },
  'src/return-await.ts': {
    rule: '@typescript-eslint/return-await',
    text: 'export async function load(read: () => Promise<string>): Promise<string> {\n  return await read()\n}\n',
  },
  'src/prefer-optional-chain.ts': {
    rule: '@typescript-eslint/prefer-optional-chain',
    text: 'export function second(take: () => { value: number } | undefined): number | undefined {\n  return take() && take()!.value\n}\n',
  },
}

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, module: 'preserve', noEmit: true, types: [] },
  include: ['src'],
})

/**
 * The rule names in the paragraph after the README's `<summary>summary</summary>` line
 */
function listedRules(readme: string, summary: string): Array<string> {
  const lines = readme.split('\n')
  const line = lines[lines.indexOf(`<summary>${summary}</summary>`) + 2] ?? ''
  return line
    .matchAll(/`([^`]+)`/gu)
    .map((match) => match[1] ?? '')
    .filter((name) => name.includes('/') || name.includes('-'))
    .toArray()
}

/**
 * Each of `files`' output after `--fix`, `undefined` when the fix leaves it, the rules left
 * reporting in it, and the rules among them that offer a fix, by its path relative to `dir`
 */
async function fixResults(
  eslint: ESLint,
  dir: string,
  files: ReadonlyArray<string>,
): Promise<
  Record<string, { output: string | undefined; rules: Array<string>; fixing: Array<string> }>
> {
  const results = await eslint.lintFiles([...files])
  const rulesOf = (messages: ReadonlyArray<Linter.LintMessage>) => messages.map(ruleIdOf)
  return Object.fromEntries(
    results.map((result) => [
      path.relative(dir, result.filePath).split(path.sep).join('/'),
      {
        output: result.output,
        rules: rulesOf(result.messages),
        fixing: rulesOf(result.messages.filter((message) => message.fix !== undefined)),
      },
    ]),
  )
}

describe('report-only fixes', () => {
  let dir: string
  let dispose: () => Promise<void>
  beforeAll(async () => {
    const project = await withProject({
      'tsconfig.json': TSCONFIG,
      ...Object.fromEntries(Object.entries(CASES).map(([file, { text }]) => [file, text])),
    })
    dir = project.dir
    dispose = async () => project[Symbol.asyncDispose]()
  })
  afterAll(async () => dispose())

  it('lists the report-only rules in the README', async () => {
    const readme = await fs.readFile(path.join(import.meta.dirname, '..', 'README.md'), 'utf8')
    const sorted = (rules: ReadonlyArray<string>) =>
      rules.toSorted((a, b) => collator.compare(a, b))
    expect(listedRules(readme, 'Report-only rules')).toEqual(sorted(REPORT_ONLY_RULES))
    expect(listedRules(readme, 'Report-only rules without type information')).toEqual(
      sorted(UNTYPED_REPORT_ONLY_RULES),
    )
  })

  // The report-only configs, not the presets' rule options, keep the cases from fixing: without
  // them, the untyped case and the typed ones fix
  it('reports each case without fixing it, and fixes it without the report-only configs', async () => {
    const files = Object.keys(CASES)
    const ruleIds = new Set(Object.values(CASES).map(({ rule }) => rule))
    const options = { gitignore: false, ...CORE_AREAS_OFF }
    const reported = await fixResults(await createFocusedESLint(dir, ruleIds, options), dir, files)
    expect(reported).toEqual(
      Object.fromEntries(
        Object.entries(CASES).map(([file, { rule }]) => [
          file,
          { output: undefined, rules: [rule], fixing: [] },
        ]),
      ),
    )
    const configs = await defineConfig({ root: dir, isInEditor: false, ...options })
      .remove('gpahal/fixes/report-only')
      .remove('gpahal/fixes/report-only-untyped')
    const fixed = await fixResults(
      focusedESLintWith(dir, configs, ruleIds, { fix: true }),
      dir,
      files,
    )
    expect(files.filter((file) => fixed[file]?.output === undefined)).toEqual([])
    expect(files.flatMap((file) => fixed[file]?.rules ?? [])).toEqual([])
  })

  it("reports the library config's method signatures without fixing them, following an `.override()` of its files", async () => {
    const text = 'export interface Server {\n  close(callback: () => void): void\n}\n'
    const files = { 'src/fix-safety/lib/server.ts': text, 'src/fix-safety/app/server.ts': text }
    await writeFiles(dir, files)
    const configs = await defineConfig({
      root: dir,
      isInEditor: false,
      gitignore: false,
      ...CORE_AREAS_OFF,
      typescript: { library: true },
    }).override('gpahal/typescript/library', {
      files: ['src/fix-safety/lib/**/*.ts'],
    })
    const rules = ['@typescript-eslint/method-signature-style']
    const fixer = focusedESLintWith(dir, configs, new Set(rules), { fix: true })
    expect(await fixResults(fixer, dir, Object.keys(files))).toEqual({
      'src/fix-safety/lib/server.ts': { output: undefined, rules, fixing: [] },
      'src/fix-safety/app/server.ts': {
        output: 'export interface Server {\n  close: (callback: () => void) => void\n}\n',
        rules: [],
        fixing: [],
      },
    })
  })
})
