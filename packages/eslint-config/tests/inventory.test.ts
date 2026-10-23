import { createHash } from 'node:crypto'
import path from 'node:path'

import type { Linter, Rule } from 'eslint'
import { builtinRules } from 'eslint/use-at-your-own-risk'

import { defineConfig } from '@/index'
import { parseRuleId } from '@/internal/rules'

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

/**
 * Each file's config with every preset on, resolved once for the tests that read it
 */
const allPresetsConfigs: { promise?: Promise<Map<string, Linter.Config | undefined>> } = {}

async function getAllPresetsConfigs(): Promise<Map<string, Linter.Config | undefined>> {
  allPresetsConfigs.promise ??= (async () => {
    const eslint = await createAllPresetsESLint()
    const configs = new Map<string, Linter.Config | undefined>()
    for (const file of FILES) {
      configs.set(
        file,
        (await eslint.calculateConfigForFile(path.join(FIXTURES_DIR, file))) as
          Linter.Config | undefined,
      )
    }
    return configs
  })()
  return allPresetsConfigs.promise
}

describe('with every preset on', () => {
  let configs = new Map<string, Linter.Config | undefined>()
  beforeAll(async () => {
    configs = await getAllPresetsConfigs()
  })

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
})

test(`the rules base alone turns on for ${REFERENCE_FILE}, as a difference from every preset`, async () => {
  const dir = path.join(FIXTURES_DIR, 'typescript')
  const eslint = eslintWith(dir, await defineConfig({ root: dir, isInEditor: false }))
  const base = inventoryOf(
    (await eslint.calculateConfigForFile(path.join(dir, 'src/x.ts'))) as Linter.Config | undefined,
  )
  const allPresets = inventoryOf((await getAllPresetsConfigs()).get(REFERENCE_FILE))
  expect(diffOf(allPresets, base)).toMatchSnapshot()
})
