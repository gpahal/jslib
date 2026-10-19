import fs from 'node:fs/promises'
import path from 'node:path'

import type { Linter } from 'eslint'
import { builtinRules } from 'eslint/use-at-your-own-risk'

import { withTmpProject } from '@gpahal/internal/node/testing'

import { defineConfig, type EslintConfigOptions } from '@/index'
import {
  AUDITED_SAFE_FIXES,
  REPORT_ONLY_RULES,
  UNFIXED_FIXABLE_RULES,
  UNTYPED_REPORT_ONLY_RULES,
} from '@/internal/fix-policy'
import { isRuleOn, parseRuleId } from '@/internal/rules'

import { ALL_ON_OPTIONS } from '../scripts/typegen'
import { fixFiles, type FixResult } from './fix-helpers'
import { collator, FIXTURES_DIR } from './helpers'

// Each file of the `report-only` fixture holds code that a report-only rule's fix would change, with
// the reason in a comment. With the presets' configs, the rule reports it and `--fix` leaves it.
// Without `gpahal/fixes/report-only*`, the fix applies

const FIXTURE_DIR = path.join(FIXTURES_DIR, 'report-only')

/**
 * The fixture files of report-only rules, each named for its rule, as `<folder>/*<extension>
 * <plugin prefix>` keys with the rule names
 */
const CASE_GROUPS: Record<string, string> = {
  'data/*.json json/': 'no-unnormalized-keys',
  'docs/*.md markdown-preferences/': `
    definitions-last emoji-notation hard-linebreak-style level1-heading-style level2-heading-style
    ordered-list-marker-sequence ordered-list-marker-start prefer-fenced-code-blocks
    prefer-link-reference-definitions sort-definitions
  `,
  'docs/*.html @html-eslint/': 'no-redundant-role require-button-type',
  'docs/*.md markdown/': 'no-reference-like-urls no-space-in-emphasis',
  'e2e/*.spec.js playwright/': `
    no-unsafe-references no-useless-await prefer-to-have-count prefer-to-have-length
    prefer-web-first-assertions valid-title
  `,
  'src/astro/*.astro unicorn/': 'consistent-boolean-name name-replacements',
  'src/e18e/*.js e18e/': `
    prefer-array-at prefer-array-from-map prefer-array-some prefer-date-now prefer-includes
    prefer-object-has-own prefer-regex-test prefer-timer-args
  `,
  'src/e18e/*.ts e18e/': 'prefer-spread-syntax',
  'src/js/*.js n/': 'hashbang',
  'src/js/*.js import-x/': 'no-absolute-path no-relative-packages',
  'src/js/*.js': 'no-extra-bind object-shorthand prefer-object-spread prefer-template',
  'src/jsdoc/*.ts jsdoc/': 'check-tag-names',
  'src/jsdoc/*.js jsdoc/': 'empty-tags no-multi-asterisks',
  'src/react/*.jsx @eslint-react/': `
    dom-no-hydrate dom-no-render dom-no-use-form-state no-component-will-mount
    no-component-will-receive-props no-component-will-update rsc-function-definition
  `,
  'src/regexp/*.js regexp/': `
    control-character-escape no-dupe-characters-character-class no-trivially-nested-quantifier
    no-useless-character-class no-useless-flag no-useless-lazy no-useless-non-capturing-group
    no-useless-set-operand no-useless-string-literal optimal-quantifier-concatenation
    prefer-character-class prefer-predefined-assertion prefer-question-quantifier
    prefer-set-operation prefer-unicode-codepoint-escapes prefer-w strict use-ignore-case
  `,
  'src/storybook/*.stories.js storybook/': `
    default-exports hierarchy-separator use-storybook-testing-library
  `,
  'src/tailwind/*.js better-tailwindcss/': `
    enforce-canonical-classes enforce-consistent-class-order enforce-consistent-line-wrapping
    no-deprecated-classes no-duplicate-classes no-unnecessary-whitespace
  `,
  'src/ts-untyped/*.ts @typescript-eslint/': 'consistent-type-imports',
  'src/ts/*.ts @typescript-eslint/': `
    consistent-indexed-object-style no-array-constructor no-confusing-void-expression
    no-meaningless-void-operator prefer-function-type prefer-includes prefer-optional-chain
    prefer-string-starts-ends-with promise-function-async return-await
  `,
  'src/unicorn-typed/*.ts unicorn/': `
    prefer-aggregate-error prefer-array-flat-map prefer-array-flat prefer-array-index-of
  `,
  'src/unicorn-untyped-server/*.js unicorn/': 'no-unnecessary-global-this prefer-array-from-async',
  'src/unicorn-untyped/*.js unicorn/': `
    consistent-date-clone no-array-method-this-argument no-await-expression-member no-new-buffer
    no-unnecessary-string-trim no-unreadable-array-destructuring no-useless-coercion prefer-at
    prefer-class-fields prefer-dom-node-append prefer-dom-node-remove
    prefer-iterable-in-constructor prefer-modern-dom-apis prefer-promise-try
    prefer-promise-with-resolvers prefer-prototype-methods prefer-reflect-apply prefer-regexp-test
    prefer-set-methods prefer-string-starts-ends-with prefer-toggle-attribute prefer-url-can-parse
    require-array-join-separator switch-case-braces throw-new-error
  `,
  'src/unicorn/*.js unicorn/': `
    dom-node-dataset escape-case explicit-length-check new-for-builtins no-array-reduce
    no-console-spaces no-declarations-before-early-exit no-for-each no-for-loop
    no-immediate-mutation no-incorrect-query-selector no-instanceof-builtins
    no-invalid-url-protocol-comparison no-invalid-well-known-symbol-methods no-named-default
    no-new-array no-redundant-comparison no-selector-as-dom-name
    no-single-promise-in-promise-methods no-static-only-class no-unnecessary-await
    no-unnecessary-splice no-useless-else no-useless-iterator-to-array no-useless-override
    no-useless-promise-resolve-reject no-useless-spread no-useless-undefined
    prefer-add-event-listener prefer-array-find prefer-array-from-range prefer-array-some
    prefer-block-statement-over-iife prefer-classlist-toggle prefer-dom-node-html-methods
    prefer-dom-node-replace-children prefer-export-from prefer-get-or-insert-computed
    prefer-global-this prefer-group-by prefer-https prefer-includes prefer-keyboard-event-key
    prefer-location-assign prefer-math-min-max prefer-modern-math-apis
    prefer-native-coercion-functions prefer-negative-index prefer-object-define-properties
    prefer-object-from-entries prefer-object-iterable-methods prefer-private-class-fields
    prefer-query-selector prefer-promise-static-methods prefer-queue-microtask
    prefer-response-static-json prefer-set-has prefer-single-call prefer-spread
    prefer-string-pad-start-end prefer-type-error require-css-escape
    require-number-to-fixed-digits-argument
  `,
  'src/vitest/*.test.js vitest/': `
    consistent-test-it no-import-node-test no-unneeded-async-expect-function
    prefer-called-exactly-once-with prefer-to-be valid-title
  `,
}

/**
 * Each fixture file, by its path in the fixture, with the rule it shows
 */
const CASES: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(CASE_GROUPS).flatMap(([key, names]) => {
      const [glob = '', prefix = ''] = key.split(' ', 2)
      return names
        .trim()
        .split(/\s+/u)
        .map((name) => [glob.replace('*', () => name), `${prefix}${name}`])
    }),
  ),
  'packages/repository-shorthand/package.json': 'package-json/repository-shorthand',
  'packages/require-type/package.json': 'package-json/require-type',
  'packages/valid-author/package.json': 'package-json/valid-author',
  'src/astro/fetch-content.astro': 'astro/no-deprecated-astro-fetchcontent',
  'src/js/import-first.js': 'import-x/first',
}

const OPTIONS: Partial<EslintConfigOptions> = {
  // Off by default, and report-only when they're on
  markdown: {
    rules: { 'markdown-preferences/prefer-link-reference-definitions': ['error', { minLinks: 2 }] },
  },
  unicorn: { rules: { 'unicorn/no-useless-undefined': 'error' } },
  react: true,
  astro: true,
  html: true,
  node: true,
  vitest: true,
  playwright: true,
  storybook: true,
  tailwindcss: { entryPoint: 'src/styles.css' },
}

/**
 * e18e's twins of Unicorn's rules run with `unicorn` off, some rules are report-only only without
 * type information, and some are off in browser code, which `react` makes every file
 */
const FOLDER_OPTIONS: Record<string, Partial<EslintConfigOptions>> = {
  'src/e18e/': { ...OPTIONS, unicorn: false },
  'src/unicorn-untyped-server/': { ...OPTIONS, react: false },
  'src/ts-untyped/': { ...OPTIONS, typeAware: false },
}

const GROUPS: Array<[string, Array<string>, Partial<EslintConfigOptions>]> = [
  [
    'with the presets on',
    Object.keys(CASES).filter((file) =>
      Object.keys(FOLDER_OPTIONS).every((folder) => !file.startsWith(folder)),
    ),
    OPTIONS,
  ],
  ...Object.entries(FOLDER_OPTIONS).map(
    ([folder, options]): [string, Array<string>, Partial<EslintConfigOptions>] => [
      `in ${folder}`,
      Object.keys(CASES).filter((file) => file.startsWith(folder)),
      options,
    ],
  ),
]

/**
 * `--fix` of `files` with only the report-only rules running, without the report-only configs with
 * `withFixes`
 */
async function fixCases(
  dir: string,
  files: Array<string>,
  options: Partial<EslintConfigOptions>,
  withFixes: boolean,
): Promise<Record<string, FixResult>> {
  const composer = defineConfig({ root: dir, isInEditor: false, gitignore: false, ...options })
  const configs: Array<Linter.Config> = withFixes
    ? await composer.remove('gpahal/fixes/report-only').remove('gpahal/fixes/report-only-untyped')
    : await composer
  return fixFiles({
    dir,
    configs,
    files,
    ruleIds: [...REPORT_ONLY_RULES, ...UNTYPED_REPORT_ONLY_RULES],
  })
}

/**
 * `--fix` of `files`, written into `dir` first, with only `ruleIds` running
 */
async function writeAndFix(
  dir: string,
  files: Record<string, string>,
  options: Partial<EslintConfigOptions>,
  ruleIds: ReadonlyArray<string>,
): Promise<Record<string, FixResult>> {
  for (const [file, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
    await fs.writeFile(path.join(dir, file), text)
  }
  const configs = await defineConfig({ root: dir, isInEditor: false, gitignore: false, ...options })
  return fixFiles({ dir, configs, files: Object.keys(files), ruleIds })
}

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
    const project = await withTmpProject('eslint-config')
    dir = project.dir
    dispose = async () => project[Symbol.asyncDispose]()
    await fs.cp(FIXTURE_DIR, dir, { recursive: true })
    await fs.symlink(
      path.join(import.meta.dirname, '..', 'node_modules'),
      path.join(dir, 'node_modules'),
    )
  })
  afterAll(async () => dispose())

  it('lists the report-only rules in the README, and has a case for each', async () => {
    const readme = await fs.readFile(path.join(import.meta.dirname, '..', 'README.md'), 'utf8')
    const sorted = (rules: ReadonlyArray<string>) =>
      rules.toSorted((a, b) => collator.compare(a, b))
    expect(listedRules(readme, 'Report-only rules')).toEqual(sorted(REPORT_ONLY_RULES))
    expect(listedRules(readme, 'Report-only rules without type information')).toEqual(
      sorted(UNTYPED_REPORT_ONLY_RULES),
    )
    const shown = new Set(Object.values(CASES))
    expect(
      [...REPORT_ONLY_RULES, ...UNTYPED_REPORT_ONLY_RULES].filter((rule) => !shown.has(rule)),
    ).toEqual([])
  })

  it.for(GROUPS)(
    'reports each case without fixing it, and fixes it without the report-only configs, %s',
    { timeout: 120_000 },
    async ([, files, options], { expect }) => {
      const results = await fixCases(dir, files, options, false)
      const failing = files.filter(
        (file) =>
          results[file]?.rules.includes(CASES[file] ?? '') !== true ||
          results[file].output !== undefined,
      )
      expect(Object.fromEntries(failing.map((file) => [file, results[file]]))).toEqual({})
      // A case whose rule no longer fixes it is a report-only entry to remove
      const fixed = await fixCases(dir, files, options, true)
      expect(files.filter((file) => fixed[file]?.output === undefined)).toEqual([])
    },
  )

  it("doesn't report `void` of a value that isn't a call, which `no-unused-expressions` needs (H1)", async () => {
    const file = 'src/fix-safety/void-non-call.ts'
    const text =
      'export function run(record: () => void, el: { offsetHeight: number }): void {\n  record()\n  void (1 + 2)\n  void el.offsetHeight\n}\n'
    const rules = ['@typescript-eslint/no-meaningless-void-operator']
    expect((await writeAndFix(dir, { [file]: text }, OPTIONS, rules))[file]).toEqual({
      output: undefined,
      rules: [],
    })
  })

  it("reports the library config's method signatures without fixing them, following an `.override()` of its files (M3)", async () => {
    const text = 'export interface Server {\n  close(callback: () => void): void\n}\n'
    const files = { 'src/fix-safety/lib/server.ts': text, 'src/fix-safety/app/server.ts': text }
    for (const [file, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
      await fs.writeFile(path.join(dir, file), content)
    }
    const configs = await defineConfig({
      root: dir,
      isInEditor: false,
      gitignore: false,
      ...OPTIONS,
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

  it(
    'lists every enabled fixable rule as audited or report-only',
    { timeout: 120_000 },
    async () => {
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
        [...AUDITED_SAFE_FIXES, ...UNFIXED_FIXABLE_RULES].filter((ruleId) =>
          reportOnly.has(ruleId),
        ),
      ).toEqual([])
      expect(AUDITED_SAFE_FIXES.filter((ruleId) => UNFIXED_FIXABLE_RULES.includes(ruleId))).toEqual(
        [],
      )
    },
  )
})
