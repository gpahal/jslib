import fs from 'node:fs/promises'
import path from 'node:path'

import { builtinRules } from 'eslint/use-at-your-own-risk'

import { writeFiles } from '@gpahal/internal/node/testing'

import { defineConfig, type EslintConfigOptions } from '@/index'
import {
  AUDITED_SAFE_FIXES,
  REPORT_ONLY_RULES,
  UNFIXED_FIXABLE_RULES,
  UNTYPED_REPORT_ONLY_RULES,
} from '@/internal/fix-policy'
import { isRuleOn, parseRuleId } from '@/internal/rules'

import { ALL_ON_OPTIONS } from '../scripts/typegen'
import { fixFiles, reportFiles, withRulesOnly } from './fix-helpers'
import { collator, CORE_AREAS_OFF, withProject } from './helpers'

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
    const ruleIds = Object.values(CASES).map(({ rule }) => rule)
    const options = { root: dir, isInEditor: false, gitignore: false, ...CORE_AREAS_OFF }
    const reported = await reportFiles({
      dir,
      configs: withRulesOnly(await defineConfig(options), new Set(ruleIds)),
      files,
      ruleIds,
    })
    expect(reported).toEqual(
      Object.fromEntries(
        Object.entries(CASES).map(([file, { rule }]) => [file, { rules: [rule], fixing: [] }]),
      ),
    )
    const configs = await defineConfig(options)
      .remove('gpahal/fixes/report-only')
      .remove('gpahal/fixes/report-only-untyped')
    const fixed = await fixFiles({
      dir,
      configs: withRulesOnly(configs, new Set(ruleIds)),
      files,
      ruleIds,
    })
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
    expect(await fixFiles({ dir, configs, files: Object.keys(files), ruleIds: rules })).toEqual({
      'src/fix-safety/lib/server.ts': { output: undefined, rules },
      'src/fix-safety/app/server.ts': {
        output: 'export interface Server {\n  close: (callback: () => void) => void\n}\n',
        rules: [],
      },
    })
  })
})

describe('fix-safety guardrail', () => {
  // Other options turn on more rules: e18e's twins of Unicorn's, the core rules for files without
  // type information, and the editor's
  const OPTION_SETS: Array<EslintConfigOptions> = [
    ALL_ON_OPTIONS,
    { ...ALL_ON_OPTIONS, unicorn: false },
    { ...ALL_ON_OPTIONS, typeAware: false },
    { ...ALL_ON_OPTIONS, isInEditor: true },
  ]

  it('lists every enabled fixable rule as audited or report-only', async () => {
    const fixable = new Set<string>()
    for (const options of OPTION_SETS) {
      const configs = await defineConfig({ isInEditor: false, ...options })
      const plugins = new Map(configs.flatMap((config) => Object.entries(config.plugins ?? {})))
      const entries = configs.flatMap((config) => Object.entries(config.rules ?? {}))
      for (const [ruleId, entry] of entries) {
        const { pluginName, ruleName } = parseRuleId(ruleId)
        const rule =
          pluginName === undefined
            ? // eslint-disable-next-line @typescript-eslint/no-deprecated -- ESLint exposes the core rules nowhere else
              builtinRules.get(ruleName)
            : plugins.get(pluginName)?.rules?.[ruleName]
        // ESLint rejects a fix from a rule whose `meta.fixable` isn't set
        if (isRuleOn(entry) && rule?.meta?.fixable) {
          fixable.add(ruleId)
        }
      }
    }
    const listed = new Set([
      ...AUDITED_SAFE_FIXES,
      ...UNFIXED_FIXABLE_RULES,
      ...REPORT_ONLY_RULES,
      ...UNTYPED_REPORT_ONLY_RULES,
    ])
    // Audit each rule's fixer, then add it to `AUDITED_SAFE_FIXES` or a report-only list
    const unlisted = [...fixable.difference(listed)]
    expect(unlisted.toSorted((a, b) => collator.compare(a, b))).toEqual([])
    const reportOnly = new Set([...REPORT_ONLY_RULES, ...UNTYPED_REPORT_ONLY_RULES])
    expect(
      [...AUDITED_SAFE_FIXES, ...UNFIXED_FIXABLE_RULES].filter((ruleId) => reportOnly.has(ruleId)),
    ).toEqual([])
    expect(AUDITED_SAFE_FIXES.filter((ruleId) => UNFIXED_FIXABLE_RULES.includes(ruleId))).toEqual(
      [],
    )
  })
})
