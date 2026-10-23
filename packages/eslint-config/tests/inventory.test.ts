import path from 'node:path'

import type { ESLint, Linter, Rule } from 'eslint'
import { builtinRules } from 'eslint/use-at-your-own-risk'

import { defineConfig } from '@/index'
import { parseRuleId } from '@/internal/rules'

import {
  collator,
  createAllPresetsESLint,
  diffOf,
  eslintWith,
  FILES,
  FIXTURES_DIR,
  getAllPresetsConfigs,
  inventoryOf,
  listOf,
  type ConfigOptions,
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

/**
 * The global names that `config` adds to `reference`'s, as `+ globals: a, b`, and that it drops, as
 * `- globals: …`, or their counts when there are more than 20, as for the browser globals
 */
function globalsDiffOf(
  reference: Linter.Config | undefined,
  config: Linter.Config | undefined,
): Array<string> {
  const namesOf = (of: Linter.Config | undefined) =>
    new Set(Object.keys(of?.languageOptions?.['globals'] ?? {}))
  const before = namesOf(reference)
  const after = namesOf(config)
  const lines: Array<string> = []
  for (const [sign, names] of [
    ['+', after.difference(before)],
    ['-', before.difference(after)],
  ] as const) {
    const list = [...names].toSorted((a, b) => collator.compare(a, b))
    if (list.length > 0) {
      lines.push(
        `${sign} globals: ${list.length > 20 ? `${String(list.length)} names` : list.join(', ')}`,
      )
    }
  }
  return lines
}

/**
 * `diffOf`'s lines with the rules of a plugin that 10 or more lines turn on or off alike as one line,
 * as `+ vitest/*: 26 rules`, which the inventory lists
 */
function grouped(lines: Array<string>): Array<string> {
  const keyOf = (line: string) => /^[+-] [^/: ]+\//.exec(line)?.[0]
  const counts = new Map<string, number>()
  for (const line of lines) {
    const key = keyOf(line)
    if (key !== undefined) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const result: Array<string> = []
  const shown = new Set<string>()
  for (const line of lines) {
    const key = keyOf(line)
    const count = key === undefined ? 0 : (counts.get(key) ?? 0)
    if (key === undefined || count < 10) {
      result.push(line)
    } else if (!shown.has(key)) {
      shown.add(key)
      result.push(`${key}*: ${String(count)} rules`)
    }
  }
  return result
}

/**
 * The files that show a variant's effect: a file is compared with the same file with every preset
 * on, and `[file, against]` with `against` in the variant
 */
type VariantFiles = Array<string | [file: string, against: string]>

/**
 * Options over every preset's, with the files that show their effect. Where an option takes
 * globs, the files needn't exist
 */
const VARIANTS: Array<[label: string, options: ConfigOptions, files: VariantFiles]> = [
  // Each turns only its own rules on or off
  ['e18e.modernization: false', { e18e: { modernization: false } }, ['typescript/src/x.ts']],
  [
    'e18e.moduleReplacements: true',
    { e18e: { moduleReplacements: true } },
    ['typescript/src/x.ts'],
  ],
  [
    'e18e.performanceImprovements: false',
    { e18e: { performanceImprovements: false } },
    ['typescript/src/x.ts'],
  ],
  // `checks/a.ts` becomes a test file, and `tests/a.ts` stays one
  [
    'testFiles adding to the defaults with a function',
    { testFiles: (defaults) => [...defaults, 'checks/**/*.ts'] },
    ['checks/a.ts', 'tests/a.ts'],
  ],
  // `tests/a.ts` stops being one
  [
    'testFiles replacing the defaults with a list',
    { testFiles: ['checks/**/*.ts'] },
    ['checks/a.ts', 'tests/a.ts'],
  ],
  // A type test is a test file, with Vitest's rules and globals
  ['nothing more, in a type test', {}, [['typescript/src/x.test-d.ts', 'typescript/src/x.ts']]],
  // A file of either list gets every test file exemption, and only Vitest's files get its rules:
  // `unit/a.ts` is only Vitest's, `tests/a.test.ts` only a test file, and `tests/fixtures/a.test.ts`
  // neither
  [
    'testFiles and vitest.files leaving out files of each other',
    {
      testFiles: (defaults) => [...defaults, '!tests/fixtures/**'],
      vitest: { files: () => ['unit/**/*.ts', 'tests/fixtures/**', '!tests/**/a.test.ts'] },
    },
    ['unit/a.ts', 'tests/a.test.ts', 'tests/fixtures/a.test.ts'],
  ],
  // `tests/integration/a.test.ts` stays a test file, without Vitest's rules
  [
    'vitest.files as a list',
    { vitest: { files: ['tests/unit/**/*.ts'] } },
    ['tests/integration/a.test.ts'],
  ],
  // The function gets the resolved testFiles, so `unit/a.ts` gets Vitest's rules
  [
    'vitest.files as a function of the resolved testFiles',
    {
      testFiles: (defaults) => [...defaults, 'spec/**/*.ts'],
      vitest: {
        files: (testFiles) => (testFiles.includes('spec/**/*.ts') ? ['unit/**/*.ts'] : []),
      },
    },
    ['unit/a.ts', 'tests/a.test.ts'],
  ],
  // Server files win over browser files where both match, with React's and Next.js's presets, and
  // with React's alone
  [
    'server.files matching browser files too',
    { server: { files: ['server/**', 'browser/**'] } },
    ['browser/src/x.ts'],
  ],
  [
    'server.files matching browser files too, without nextjs',
    { nextjs: false, server: { files: ['server/**', 'browser/**'] } },
    [['browser/src/x.ts', 'server/src/x.ts']],
  ],
]

async function configOf(eslint: ESLint, file: string): Promise<Linter.Config | undefined> {
  return (await eslint.calculateConfigForFile(path.join(FIXTURES_DIR, file))) as
    Linter.Config | undefined
}

/**
 * Each file's config with every preset on, resolved once
 */
const referenceConfigs = new Map<string, Promise<Linter.Config | undefined>>()
const reference: { eslint?: Promise<ESLint> } = {}

async function referenceConfigOf(file: string): Promise<Linter.Config | undefined> {
  const allPresetsConfigs = await getAllPresetsConfigs()
  if (allPresetsConfigs.has(file)) {
    return allPresetsConfigs.get(file)
  }
  let config = referenceConfigs.get(file)
  if (config === undefined) {
    reference.eslint ??= createAllPresetsESLint()
    config = reference.eslint.then(async (eslint) => configOf(eslint, file))
    referenceConfigs.set(file, config)
  }
  return config
}

test.each(VARIANTS)(
  'the rules and globals that differ from every preset with %s',
  async (_label, options, files) => {
    const eslint =
      Object.keys(options).length === 0 ? undefined : await createAllPresetsESLint(options)
    const variantConfigOf = async (file: string) =>
      eslint === undefined ? referenceConfigOf(file) : configOf(eslint, file)
    const diffs: Record<string, Array<string>> = {}
    for (const entry of files) {
      const [file, against] = typeof entry === 'string' ? [entry, undefined] : entry
      const config = await variantConfigOf(file)
      const before = await (against === undefined
        ? referenceConfigOf(file)
        : variantConfigOf(against))
      diffs[against === undefined ? file : `${file} against ${against}`] = [
        ...grouped(diffOf(inventoryOf(before), inventoryOf(config))),
        ...globalsDiffOf(before, config),
      ]
    }
    expect(diffs).toMatchSnapshot()
  },
)
