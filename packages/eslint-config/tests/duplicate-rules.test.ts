import path from 'node:path'

import type { Linter } from 'eslint'
import { builtinRules } from 'eslint/use-at-your-own-risk'

import { defineConfig, type EslintConfigOptions } from '@/index'
import { ALLOWED_OVERLAPS, DUPLICATE_REPORTS, DUPLICATE_RULES } from '@/internal/duplicate-rules'
import { isRuleOn, parseRuleId } from '@/internal/rules'

import { ALL_ON_OPTIONS } from '../scripts/typegen'
import { withRulesOnly } from './fix-helpers'
import {
  createESLint,
  eslintWith,
  FILES,
  FIXTURES_DIR,
  lintRuleIds,
  severityOf,
  sharedESLint,
} from './helpers'

/**
 * The options that turn off the areas of the kept rules that can be turned off
 */
const KEPT_AREAS_OFF: Array<[string, Partial<EslintConfigOptions>]> = [
  ['imports: false', { imports: false }],
  ['unicorn: false', { unicorn: false }],
  ['regexp: false', { regexp: false }],
  ['sonarjs: false', { sonarjs: false }],
  ['antislop.sonarjs: false', { antislop: { sonarjs: false } }],
  ['antislop: false', { antislop: false }],
]

/**
 * Whether `a` and `b` may both be on
 */
function isAllowedOverlap(a: string, b: string): boolean {
  return ALLOWED_OVERLAPS.some(
    ({ rules }) => rules.includes(a as never) && rules.includes(b as never),
  )
}

/**
 * The inventory's files and a JavaScript code block, which `antislop`'s SonarJS configs leave out
 */
const PAIR_FILES = [...FILES, 'markdown/README.md/0.js']

/**
 * The code files that stand for the others in every set but the first, and every file that isn't
 * code, which resolves quickly. Each file of `PAIR_FILES` had the same pairs' rules on and off, with
 * and without the twins, as one of these in every option set, with code files grouped as `.ts`
 * outside tests, untyped `.js`, test files, and Astro's and Markdown's own. Resolving a code file's
 * config takes about 0.1s per file and ESLint, so the first set alone checks every file, to catch a
 * file that leaves its group
 */
const AREA_PAIR_FILES = PAIR_FILES.filter(
  (file) =>
    ![
      'react/src/x.jsx',
      'x.mjs',
      'cjs/x.cjs',
      'typescript/src/x.mts',
      'typescript/src/x.cts',
      'typescript/src/x.d.ts',
      'typescript/e2e/x.spec.ts',
      'react/src/x.stories.tsx',
      'x.config.ts',
      'scripts/x.ts',
      'browser/src/x.ts',
      'server/src/x.ts',
    ].includes(file),
)

/**
 * Every preset with each type-information mode, and without the SonarJS area, where only
 * `antislop`'s SonarJS configs run its kept rules, in some files. The other options of
 * `KEPT_AREAS_OFF` leave the kept rules of their areas on nowhere, which the structural test below
 * checks
 */
const OPTION_SETS: Array<[string, EslintConfigOptions, ReadonlyArray<string>]> = [
  ['every option on', ALL_ON_OPTIONS, PAIR_FILES],
  ['typeAware: false', { ...ALL_ON_OPTIONS, typeAware: false }, AREA_PAIR_FILES],
  ['typeAware.javascript', { ...ALL_ON_OPTIONS, typeAware: { javascript: true } }, AREA_PAIR_FILES],
  ['every option on, sonarjs: false', { ...ALL_ON_OPTIONS, sonarjs: false }, AREA_PAIR_FILES],
]

/**
 * The rules of the duplicate pairs, the only ones whose severities the test reads
 */
const PAIR_RULES = new Set<string>(DUPLICATE_RULES.flatMap(({ kept, off }) => [...kept, off]))

/**
 * Whether `config` is one of the configs that turn twins off
 */
function isDuplicatesConfig(config: Linter.Config): boolean {
  return config.name?.startsWith('gpahal/duplicates/') === true
}

test.each(KEPT_AREAS_OFF)(
  'with every option on and %s, no twin is off whose kept rules no config turns on',
  async (_name, offOptions) => {
    const configs = await defineConfig({ ...ALL_ON_OPTIONS, ...offOptions })
    const isOnAnywhere = (rule: string) =>
      configs.some((config) => !isDuplicatesConfig(config) && isRuleOn(config.rules?.[rule]))
    const twinsOff = new Set(
      configs.filter(isDuplicatesConfig).flatMap((config) => Object.keys(config.rules ?? {})),
    )
    expect(
      DUPLICATE_RULES.filter(({ kept, off }) => twinsOff.has(off) && !kept.some(isOnAnywhere)).map(
        ({ kept, off }) => `${off} without ${kept.join(' or ')}`,
      ),
    ).toEqual([])
  },
)

test.each(OPTION_SETS)(
  'no file has both rules of a duplicate pair on, nor a twin off without its kept rules: %s',
  async (_name, options, files) => {
    const configs = withRulesOnly(await defineConfig(options), PAIR_RULES)
    const eslint = eslintWith(FIXTURES_DIR, configs)
    // The same configs with every twin left on
    const eslintWithTwins = eslintWith(
      FIXTURES_DIR,
      configs.filter((config) => !isDuplicatesConfig(config)),
    )
    const both: Array<string> = []
    const unkept: Array<string> = []
    for (const file of files) {
      const config = (await eslint.calculateConfigForFile(file)) as Linter.Config | undefined
      const twinsConfig = (await eslintWithTwins.calculateConfigForFile(file)) as
        Linter.Config | undefined
      const isOn = (rule: string, of: Linter.Config | undefined = config) =>
        (severityOf(of?.rules?.[rule]) ?? 0) > 0
      for (const { kept, off } of DUPLICATE_RULES) {
        for (const rule of kept) {
          if (isOn(rule) && isOn(off) && !isAllowedOverlap(rule, off)) {
            both.push(`${file}: ${rule} and ${off}`)
          }
        }
        if (isOn(off, twinsConfig) && !isOn(off) && kept.every((rule) => !isOn(rule))) {
          unkept.push(`${file}: ${off} without ${kept.join(' or ')}`)
        }
      }
    }
    expect({ both, unkept }).toEqual({ both: [], unkept: [] })
  },
)

/**
 * A cycle in the graph from each `off` twin to its `kept` rules, as the rules along it, or
 * `undefined` when there is none. `twinScopes` follows a kept rule that is itself an `off` twin, so
 * a cycle would recurse forever
 */
function findTwinCycle(
  rules: ReadonlyArray<{ kept: ReadonlyArray<string>; off: string }>,
): Array<string> | undefined {
  const kept = new Map<string, Array<string>>()
  for (const rule of rules) {
    kept.set(rule.off, [...(kept.get(rule.off) ?? []), ...rule.kept])
  }
  const done = new Set<string>()
  const visit = (rule: string, path: Array<string>): Array<string> | undefined => {
    const index = path.indexOf(rule)
    if (index !== -1) {
      return [...path.slice(index), rule]
    }
    if (done.has(rule)) {
      return undefined
    }
    const nextRules = kept.get(rule) ?? []
    for (const next of nextRules) {
      const cycle = visit(next, [...path, rule])
      if (cycle !== undefined) {
        return cycle
      }
    }
    done.add(rule)
    return undefined
  }
  for (const rule of kept.keys()) {
    const cycle = visit(rule, [])
    if (cycle !== undefined) {
      return cycle
    }
  }
  return undefined
}

test('no off twin or report twin is kept, through other pairs, in place of itself', () => {
  expect(findTwinCycle(DUPLICATE_RULES)).toBeUndefined()
  const twins = DUPLICATE_REPORTS.map(({ twin }) => twin)
  expect(twins.filter((twin, index) => twins.indexOf(twin) !== index)).toEqual([])
  expect(
    findTwinCycle(DUPLICATE_REPORTS.map(({ kept, twin }) => ({ kept, off: twin }))),
  ).toBeUndefined()
})

test('names only rules that exist, and no pair twice or as an allowed overlap', async () => {
  const configs = await defineConfig(ALL_ON_OPTIONS)
  const plugins = new Map(configs.flatMap((config) => Object.entries(config.plugins ?? {})))
  const exists = (rule: string) => {
    const { pluginName, ruleName } = parseRuleId(rule)
    return pluginName === undefined
      ? // eslint-disable-next-line @typescript-eslint/no-deprecated -- ESLint exposes the core rules nowhere else
        builtinRules.has(ruleName)
      : plugins.get(pluginName)?.rules?.[ruleName] !== undefined
  }
  const rules = [
    ...DUPLICATE_RULES.flatMap(({ kept, off }) => [...kept, off]),
    ...ALLOWED_OVERLAPS.flatMap(({ rules: overlap }) => overlap),
    ...DUPLICATE_REPORTS.flatMap(({ kept, twin }) => [...kept, twin]),
  ]
  expect(rules.filter((rule) => !exists(rule))).toEqual([])
  const offRules = DUPLICATE_RULES.map(({ off }) => off)
  expect(offRules.filter((rule, index) => offRules.indexOf(rule) !== index)).toEqual([])
  expect(
    DUPLICATE_RULES.flatMap(({ kept, off }) =>
      kept.filter((rule) => isAllowedOverlap(rule, off)).map((rule) => `${rule} and ${off}`),
    ),
  ).toEqual([])
})

/**
 * A typed file of the rules fixture, whose text each probe replaces
 */
const typed = 'src/dead-store.ts'

/**
 * The options of the probes, which keep the slop rules off their code
 */
const NO_SLOP = { antislop: { slop: false } } as const

describe('a duplicate pair reports once', () => {
  // No preset turns `strict-void-return` on, so its twin reports, and stays on when an area's
  // `rules` turn the rule on
  it('with `strict-void-return` turned on', async () => {
    const code = 'export const wait = new Promise((r) => setTimeout(r, 1))\n'
    const rule = '@typescript-eslint/strict-void-return'
    const twin = 'no-promise-executor-return'
    expect(await lintRuleIds(await sharedESLint('rules', NO_SLOP), typed, code)).toEqual([twin])
    const withRule = await createESLint('rules', {
      ...NO_SLOP,
      typescript: { rulesTypeAware: { [rule]: 'error' } },
    })
    expect(await lintRuleIds(withRule, typed, code)).toEqual([rule, twin])
  })
})

describe('a mistake that two rules report gets one report', () => {
  const tsx = 'src/counter.tsx'
  // As `.match()` in a condition, where `re.test(s)` serves
  const matchCondition =
    'export function check(s: string): unknown {\n  if (s.match(/a/)) {\n    console.error(s)\n  }\n  return s\n}\n'
  const mappedArrayFrom =
    'export function double(values: Array<number>): Array<number> {\n  return Array.from(values).map((value) => value * 2)\n}\n'

  /**
   * The rules of `rules` that report `code` as `file` of `fixture`, with `options` and slop off
   */
  async function reportingRules(
    fixture: string,
    options: Partial<EslintConfigOptions>,
    file: string,
    code: string,
    rules: ReadonlyArray<string>,
  ): Promise<Array<string>> {
    const eslintOptions = { ...NO_SLOP, ...options }
    // Each set of `configs` is used once, so caching its instance would only hold memory
    const eslint =
      options.configs === undefined
        ? await sharedESLint(fixture, eslintOptions)
        : await createESLint(fixture, eslintOptions)
    return lintRuleIds(eslint, file, code, rules)
  }

  it.each([
    [
      'rules',
      {},
      typed,
      'type Base = { a: string }\n\nexport interface Extended extends Base {}\n',
      '@typescript-eslint/no-empty-object-type',
      '@typescript-eslint/consistent-type-definitions',
    ],
    [
      'react',
      { react: true },
      tsx,
      'export function A(): React.ReactNode {\n  return <a href="javascript:void(0)">a</a>\n}\n',
      '@eslint-react/dom-no-script-url',
      'no-script-url',
    ],
    [
      'rules',
      { node: { typeStripping: true } },
      typed,
      'export namespace N {\n  export const a = 1\n}\n',
      '@gpahal/no-unstrippable-syntax',
      '@typescript-eslint/no-namespace',
    ],
    [
      'rules',
      { vitest: true },
      'src/__tests__/inferrable-types.ts',
      "import { expect, test } from 'vitest'\n\ntest('a', () => {\n  expect(Promise.resolve(1)).resolves.toBe(1)\n})\n",
      'vitest/valid-expect',
      '@typescript-eslint/no-floating-promises',
    ],
  ] as Array<[string, Partial<EslintConfigOptions>, string, string, string, string]>)(
    '%s, %j, %s: in %j, only %s reports, and %s does where the kept rule is off',
    async (fixture, options, file, code, kept, twin) => {
      expect(await reportingRules(fixture, options, file, code, [kept, twin])).toEqual([kept])
      const keptOff = {
        ...options,
        configs: [{ files: [file], rules: { [kept]: 'off' } }],
      } as Partial<EslintConfigOptions>
      expect(await reportingRules(fixture, keptOff, file, code, [kept, twin])).toEqual([twin])
    },
  )

  it.each<[string, Partial<EslintConfigOptions>, string, string]>([
    [
      'unicorn/prefer-iterator-to-array',
      {},
      'x.js',
      'export function keys(m) {\n  return [...m.keys()]\n}\n',
    ],
    [
      'unicorn/prefer-iterator-to-array',
      {},
      'x.js',
      'export function keys(m, fn) {\n  return [...m.keys()].map(fn)\n}\n',
    ],
    ['unicorn/prefer-regexp-test', {}, typed, matchCondition],
    ['e18e/prefer-regex-test', { unicorn: false }, typed, matchCondition],
    ['unicorn/prefer-spread', {}, typed, mappedArrayFrom],
  ])('reports with %s alone, with %j, in %s: %j', async (rule, options, file, code) => {
    const eslint = await sharedESLint('rules', { ...NO_SLOP, ...options })
    expect(await lintRuleIds(eslint, file, code)).toEqual([rule])
  })

  it('keeps the report of a twin on another node than the kept report, in report order', async () => {
    // eslint-disable-next-line no-template-curly-in-string -- The code of the probe
    const code = 'export function f() {\n  throw Error(`at ${Date()}`)\n}\n'
    const rules = ['unicorn/throw-new-error', 'unicorn/new-for-builtins']
    expect(await reportingRules('rules', {}, 'x.js', code, rules)).toEqual(rules)
  })

  it('keeps the report of a twin where the options of the kept rule make it skip the node', async () => {
    // `ignorePrimitives` keeps `@typescript-eslint/prefer-nullish-coalescing` off strings
    const code =
      "export function f(name: string | undefined): string {\n  return name ? name : 'anonymous'\n}\n"
    expect(
      await reportingRules('rules', {}, typed, code, [
        '@typescript-eslint/prefer-nullish-coalescing',
        'unicorn/prefer-logical-operator-over-ternary',
      ]),
    ).toEqual(['unicorn/prefer-logical-operator-over-ternary'])
  })

  it('reports an unused catch binding once, and `no-unused-vars` does with unicorn off', async () => {
    const code =
      "export function f(): unknown {\n  try {\n    return JSON.parse('x')\n  } catch (e) {\n    return undefined\n  }\n}\n"
    const rules = [
      '@typescript-eslint/no-unused-vars',
      'unicorn/prefer-optional-catch-binding',
      'unicorn/catch-error-name',
      'preserve-caught-error',
    ]
    expect(await reportingRules('rules', {}, typed, code, rules)).toEqual([
      'unicorn/prefer-optional-catch-binding',
    ])
    expect(await reportingRules('rules', { unicorn: false }, typed, code, rules)).toEqual([
      '@typescript-eslint/no-unused-vars',
    ])
  })

  it('keeps `no-script-url` outside JSX in React files', async () => {
    const code = "export function go(): void {\n  location.assign('javascript:void(0)')\n}\n"
    expect(
      await reportingRules('react', { react: true }, tsx, code, [
        'no-script-url',
        '@eslint-react/dom-no-script-url',
      ]),
    ).toEqual(['no-script-url'])
  })
})

describe('an allowed overlap keeps both rules', () => {
  it('`a && a`', async () => {
    const eslint = await sharedESLint('rules', NO_SLOP)
    expect(
      await lintRuleIds(eslint, 'x.js', 'export function both(a) {\n  return a && a\n}\n'),
    ).toEqual(['sonarjs/no-identical-expressions', 'unicorn/no-duplicate-logical-operands'])
  })
})

test('a twin that stays on in tests is off outside them, in a files list linear in the test globs', async () => {
  const cwd = path.resolve(FIXTURES_DIR, 'rules')
  const configs = await defineConfig({
    root: cwd,
    isInEditor: false,
    testFiles: (defaults) => [...defaults, '!**/fixtures/**', '!**/data/**'],
  })
  const nonTest = configs.filter((config) => config.name?.endsWith('/non-test') === true)
  expect(nonTest.length).toBeGreaterThan(0)
  for (const config of nonTest) {
    expect(config.files?.length).toBeLessThan(40)
  }
  const eslint = eslintWith(cwd, configs)
  const twin = '@typescript-eslint/non-nullable-type-assertion-style'
  const severities = await Promise.all(
    [
      'src/a.ts',
      'src/a.test.ts',
      'src/__tests__/a.ts',
      'tests/a.ts',
      'tests/fixtures/a.ts',
      'tests/data/a.ts',
    ].map(async (file) => {
      const config = (await eslint.calculateConfigForFile(file)) as Linter.Config
      return [file, severityOf(config.rules?.[twin]) ?? 0]
    }),
  )
  expect(Object.fromEntries(severities)).toEqual({
    'src/a.ts': 0,
    'src/a.test.ts': 2,
    'src/__tests__/a.ts': 2,
    'tests/a.ts': 2,
    'tests/fixtures/a.ts': 0,
    'tests/data/a.ts': 0,
  })
})
