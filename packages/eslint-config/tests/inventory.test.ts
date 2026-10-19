import { createHash } from 'node:crypto'
import path from 'node:path'

import type { Linter, Rule } from 'eslint'
import { builtinRules } from 'eslint/use-at-your-own-risk'

import { defineConfig } from '@/index'
import { parseRuleId, PRESET_WARNINGS } from '@/internal/rules'

import { ALL_ON_OPTIONS } from '../scripts/typegen'
import {
  collator,
  createAllPresetsESLint,
  eslintWith,
  FILES,
  FIXTURES_DIR,
  severityOf,
} from './helpers'

// The rules on for each kind of file, so a change to the presets or an upgrade of a plugin shows up
// as a snapshot diff. Update it with `vitest -u` after checking the diff

/**
 * The kind of file the other code files are snapshotted against
 */
const REFERENCE_FILE = 'typescript/src/x.ts'

/**
 * The kinds of file whose rules are snapshotted in full, as they share little with code files
 */
const NON_CODE_FILES = new Set([
  'markdown/README.md',
  'json/data.json',
  'json/tsconfig.json',
  'json/data.json5',
  'json/.vscode/settings.json',
  'yaml/workflow.yml',
  'yaml/pnpm-workspace.yaml',
  'yaml/package.json',
  'toml/wrangler.toml',
  'html/index.html',
])

/**
 * Lists longer than this are snapshotted as a count and a hash: the browser globals from the
 * `globals` package, over a thousand, would otherwise make up most of the snapshot
 */
const MAX_LISTED_ITEMS = 100

/**
 * `<N items, sha256 …>` for a list over {@link MAX_LISTED_ITEMS}, else `list`
 */
function abbreviated(list: Array<unknown>): unknown {
  return list.length > MAX_LISTED_ITEMS
    ? `<${String(list.length)} items, sha256 ${createHash('sha256')
        .update(JSON.stringify(list, plain))
        .digest('hex')
        .slice(0, 12)}>`
    : list
}

/**
 * Regexes and functions, which JSON can't show, as text, and paths under the fixtures folder
 * starting with `<fixtures>`, so the snapshot doesn't depend on where the repository is
 */
function plain(_key: string, value: unknown): unknown {
  return typeof value === 'function' || value instanceof RegExp
    ? String(value)
    : typeof value === 'string'
      ? value.replaceAll(FIXTURES_DIR, '<fixtures>')
      : value
}

/**
 * Each rule that is on, with its severity and options on one line
 */
function inventoryOf(config: Linter.Config | undefined): Map<string, string> {
  const entries = Object.entries(config?.rules ?? {}).flatMap(([rule, entry]) => {
    const severity = severityOf(entry)
    if (severity === undefined || severity === 0) {
      return []
    }
    const options: Array<unknown> = Array.isArray(entry) ? entry.slice(1) : []
    // Some rules take each list item as an option of its own
    const shown = options.length > MAX_LISTED_ITEMS ? [abbreviated(options)] : options
    const formatted = JSON.stringify([severity, ...shown], (key, value: unknown) =>
      key !== '' && Array.isArray(value) ? abbreviated(value) : plain(key, value),
    )
    return [[rule, formatted] as const]
  })
  return new Map(entries.toSorted(([a], [b]) => collator.compare(a, b)))
}

function listOf(inventory: Map<string, string>): Array<string> {
  return Array.from(inventory, ([rule, entry]) => `${rule}: ${entry}`)
}

/**
 * The rules of `inventory` that differ from `reference`: `+ rule: entry` for one only `inventory`
 * has on, `- rule` for one only `reference` has on, and `~ rule: entry` for one with another entry
 */
function diffOf(reference: Map<string, string>, inventory: Map<string, string>): Array<string> {
  const lines: Array<string> = []
  const rules = new Set([...reference.keys(), ...inventory.keys()])
  for (const rule of rules) {
    const before = reference.get(rule)
    const after = inventory.get(rule)
    if (after === undefined) {
      lines.push(`- ${rule}`)
    } else if (before === undefined) {
      lines.push(`+ ${rule}: ${after}`)
    } else if (before !== after) {
      lines.push(`~ ${rule}: ${after}`)
    }
  }
  return lines.toSorted((a, b) => collator.compare(a.slice(2), b.slice(2)))
}

/**
 * The rule object of a rule, from ESLint's own rules or a plugin in the config
 *
 * @throws Error when neither has it
 */
function findRule(config: Linter.Config, name: string): Rule.RuleModule {
  const { pluginName, ruleName } = parseRuleId(name)
  const rule =
    pluginName === undefined
      ? // eslint-disable-next-line @typescript-eslint/no-deprecated -- ESLint exposes the core rules nowhere else
        builtinRules.get(ruleName)
      : config.plugins?.[pluginName]?.rules?.[ruleName]
  if (rule === undefined) {
    throw new Error(`rule ${name} is in no plugin of the config`)
  }
  return rule
}

const TAILWIND = [
  'better-tailwindcss/enforce-canonical-classes',
  'better-tailwindcss/enforce-consistent-class-order',
  'better-tailwindcss/no-deprecated-classes',
  'better-tailwindcss/no-duplicate-classes',
  'better-tailwindcss/no-unnecessary-whitespace',
]
const CODE = [
  'import-x/newline-after-import',
  'unicorn/no-leading-empty-lines',
  'unicorn/switch-case-braces',
  'unicorn/switch-case-break-position',
  ...TAILWIND,
]
/**
 * An ESM import in a script is wrong wherever it is, and an `import = require` in a `.cts` file can
 * follow code, so neither gets `import-x/newline-after-import`
 */
const COMMONJS_CODE = CODE.filter((rule) => rule !== 'import-x/newline-after-import')
const MARKDOWN = [
  '@gpahal/markdown/prefer-autolinks',
  'markdown-preferences/definitions-last',
  'markdown-preferences/hard-linebreak-style',
  'markdown-preferences/level1-heading-style',
  'markdown-preferences/level2-heading-style',
  'markdown-preferences/link-bracket-spacing',
  'markdown-preferences/no-text-backslash-linebreak',
  'markdown-preferences/ordered-list-marker-sequence',
  'markdown-preferences/ordered-list-marker-start',
  'markdown-preferences/prefer-fenced-code-blocks',
  'markdown-preferences/sort-definitions',
  'markdown-preferences/strikethrough-delimiters-style',
]

/**
 * Layout rules change code that Prettier also formats, so two of them can undo each other's fixes,
 * so review additions against both Prettier and the rules already listed.
 * `markdown-recipe.test.ts` checks that the Markdown ones and Prettier settle a file in one run
 */
const LAYOUT_RULES: Record<string, Array<string>> = {
  'typescript/src/x.ts': CODE,
  'react/src/x.tsx': CODE,
  'react/src/x.jsx': CODE,
  'x.js': CODE,
  'x.mjs': CODE,
  'cjs/x.cjs': COMMONJS_CODE,
  'typescript/src/x.mts': CODE,
  'typescript/src/x.cts': COMMONJS_CODE,
  'typescript/src/x.d.ts': CODE,
  'typescript/src/x.test.ts': CODE,
  'typescript/e2e/x.spec.ts': [...CODE, 'playwright/consistent-spacing-between-blocks'],
  'react/src/x.stories.tsx': CODE,
  'x.config.ts': CODE,
  'scripts/x.ts': CODE,
  'browser/src/x.ts': CODE,
  'server/src/x.ts': CODE,
  'astro/page.astro': CODE,
  'astro/page.astro/0_0.ts': CODE,
  'markdown/README.md': MARKDOWN,
  'markdown/README.md/0.tsx': CODE,
  'json/data.json': [],
  'json/tsconfig.json': [],
  'json/data.json5': [],
  'json/.vscode/settings.json': [],
  'yaml/workflow.yml': [],
  'yaml/pnpm-workspace.yaml': [],
  'yaml/package.json': ['pnpm/json-prefer-workspace-settings', 'pnpm/json-valid-catalog'],
  'toml/wrangler.toml': [
    'toml/array-bracket-newline',
    'toml/array-bracket-spacing',
    'toml/array-element-newline',
    'toml/comma-style',
    'toml/indent',
    'toml/inline-table-curly-spacing',
    'toml/key-spacing',
    'toml/no-space-dots',
    'toml/padding-line-between-tables',
    'toml/quoted-keys',
    'toml/table-bracket-spacing',
  ],
  'html/index.html': TAILWIND,
}

describe('with every preset on', () => {
  const configs = new Map<string, Linter.Config | undefined>()
  // Loading every preset takes about 3s alone, close to the default 10s hook timeout when the other
  // packages' tests run at the same time
  beforeAll(async () => {
    const eslint = await createAllPresetsESLint()
    for (const file of FILES) {
      configs.set(
        file,
        (await eslint.calculateConfigForFile(path.join(FIXTURES_DIR, file))) as
          Linter.Config | undefined,
      )
    }
  }, 30_000)

  it.each(FILES)('the rules on for %s', (file) => {
    const inventory = inventoryOf(configs.get(file))
    expect(
      file === REFERENCE_FILE || NON_CODE_FILES.has(file)
        ? listOf(inventory)
        : diffOf(inventoryOf(configs.get(REFERENCE_FILE)), inventory),
    ).toMatchSnapshot()
  })

  it('no rule on for any kind of file is deprecated', () => {
    const deprecated = FILES.flatMap((file) => {
      const config = configs.get(file)
      return config === undefined
        ? []
        : inventoryOf(config)
            .keys()
            .filter((name) => {
              const flag: unknown = findRule(config, name).meta?.deprecated
              return flag !== undefined && flag !== false
            })
            .map((name) => `${file}: ${name}`)
            .toArray()
    })
    expect(deprecated).toEqual([])
  })

  it('the layout rules on for each kind of file', () => {
    expect(Object.keys(LAYOUT_RULES)).toEqual(FILES)
    const layoutRules = Object.fromEntries(
      FILES.map((file) => {
        const config = configs.get(file)
        const rules = inventoryOf(config)
          .keys()
          .filter((name) => config !== undefined && findRule(config, name).meta?.type === 'layout')
          .toArray()
        return [file, rules]
      }),
    )
    expect(layoutRules).toEqual(
      Object.fromEntries(
        Object.entries(LAYOUT_RULES).map(([file, rules]) => [
          file,
          rules.toSorted((a, b) => collator.compare(a, b)),
        ]),
      ),
    )
  })
})

test(`the rules base alone turns on for ${REFERENCE_FILE}, as a difference from every preset`, async () => {
  const dir = path.join(FIXTURES_DIR, 'typescript')
  const eslint = eslintWith(dir, await defineConfig({ root: dir, isInEditor: false }))
  const base = inventoryOf(
    (await eslint.calculateConfigForFile(path.join(dir, 'src/x.ts'))) as Linter.Config | undefined,
  )
  const allPresets = inventoryOf(
    (await (
      await createAllPresetsESLint()
    ).calculateConfigForFile(path.join(FIXTURES_DIR, REFERENCE_FILE))) as Linter.Config | undefined,
  )
  expect(diffOf(allPresets, base)).toMatchSnapshot()
})

test('every rule the presets turn on is an error, but the warnings they set on purpose', async () => {
  const configs = await defineConfig(ALL_ON_OPTIONS)
  const warnings = configs.flatMap((config) =>
    Object.entries(config.rules ?? {})
      .filter(([rule, entry]) => severityOf(entry) === 1 && !PRESET_WARNINGS.has(rule))
      .map(([rule]) => `${config.name ?? 'unnamed'}: ${rule}`),
  )
  expect(warnings).toEqual([])
})
