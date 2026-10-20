import path from 'node:path'

import type { ESLint, Linter } from 'eslint'
import { builtinRules } from 'eslint/use-at-your-own-risk'

import { defineConfig, type EslintConfigOptions } from '@/index'
import { ALLOWED_OVERLAPS, DUPLICATE_REPORTS, DUPLICATE_RULES } from '@/internal/duplicate-rules'
import { parseRuleId } from '@/internal/rules'

import { ALL_ON_OPTIONS } from '../scripts/typegen'
import {
  createESLint,
  eslintWith,
  FILES,
  FIXTURES_DIR,
  lintText,
  severityOf,
  sharedESLint,
} from './helpers'

/**
 * Every preset with each type-information mode
 */
const BASE_OPTION_SETS: Array<[string, EslintConfigOptions]> = [
  ['every option on', ALL_ON_OPTIONS],
  ['typeAware: false', { ...ALL_ON_OPTIONS, typeAware: false }],
  ['typeAware.javascript', { ...ALL_ON_OPTIONS, typeAware: { javascript: true } }],
]

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
 * The type-information modes don't change which areas are on, so only the first set turns each off
 */
const OPTION_SETS: Array<[string, EslintConfigOptions]> = [
  ...BASE_OPTION_SETS,
  ...KEPT_AREAS_OFF.map(([offName, offOptions]): [string, EslintConfigOptions] => [
    `every option on, ${offName}`,
    { ...ALL_ON_OPTIONS, ...offOptions },
  ]),
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

test.each(OPTION_SETS)(
  'no file has both rules of a duplicate pair on, nor a twin off without its kept rules: %s',
  async (_name, options) => {
    const configs = await defineConfig(options)
    const eslint = eslintWith(FIXTURES_DIR, configs)
    // The same configs with every twin left on
    const eslintWithTwins = eslintWith(
      FIXTURES_DIR,
      configs.filter((config) => config.name?.startsWith('gpahal/duplicates/') !== true),
    )
    const both: Array<string> = []
    const unkept: Array<string> = []
    for (const file of PAIR_FILES) {
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
 * The rule of a message of `lintText`
 */
function ruleOf(message: string): string | undefined {
  return message.split(':', 1)[0]
}

/**
 * A typed file of the rules fixture, whose text each probe replaces
 */
const typed = 'src/dead-store.ts'

/**
 * Cases that a duplicate pair reports once, with the file, the kept rule and the twin that is off
 */
const ROWS: Array<[string, string, string, string]> = [
  [
    'x.js',
    "import { default as path } from 'node:path'\n\nexport const separator = path.sep\n",
    'import-x/no-named-default',
    'unicorn/no-named-default',
  ],
  [
    typed,
    'export async function run(): Promise<void> {\n  await 1\n}\n',
    '@typescript-eslint/await-thenable',
    'unicorn/no-unnecessary-await',
  ],
  ['x.js', "export const a = new String('a')\n", 'unicorn/new-for-builtins', 'no-new-wrappers'],
  [
    'x.js',
    'export function isOn(c) {\n  if (c) {\n    return true\n  }\n  return false\n}\n',
    'unicorn/prefer-boolean-return',
    'sonarjs/prefer-single-boolean-return',
  ],
  [
    'x.js',
    'export function last(v) {\n  return v[v.length - 1]\n}\n',
    'unicorn/prefer-at',
    'e18e/prefer-array-at',
  ],
]

describe('a duplicate pair reports once', () => {
  let eslint: ESLint
  // With every row's twin turned back on in the row's file
  let eslintWithTwins: ESLint
  const cwd = path.resolve(FIXTURES_DIR, 'rules')

  beforeAll(async () => {
    const configs = await defineConfig({ root: cwd, isInEditor: false, antislop: { slop: false } })
    eslint = eslintWith(cwd, configs)
    eslintWithTwins = eslintWith(cwd, [
      ...configs,
      ...ROWS.map((row) => ({ files: [row[0]], rules: { [row[3]]: 'error' as const } })),
    ])
  })

  it.each(ROWS)('%s: %j: %s, not %s', async (file, code, rule, twin) => {
    expect((await lintText(eslint, file, code)).map(ruleOf)).toEqual([rule])
    // The twin, turned back on, reports the case too
    expect((await lintText(eslintWithTwins, file, code)).map(ruleOf)).toContain(twin)
  })

  // No preset turns `strict-void-return` on, so its twin reports, and stays on when an area's
  // `rules` turn the rule on
  it('with `strict-void-return` turned on', async () => {
    const code = 'export const wait = new Promise((r) => setTimeout(r, 1))\n'
    const rule = '@typescript-eslint/strict-void-return'
    const twin = 'no-promise-executor-return'
    expect((await lintText(eslint, typed, code)).map(ruleOf)).toEqual([twin])
    const withRule = eslintWith(
      cwd,
      await defineConfig({
        root: cwd,
        isInEditor: false,
        antislop: { slop: false },
        typescript: { rulesTypeAware: { [rule]: 'error' } },
      }),
    )
    expect((await lintText(withRule, typed, code)).map(ruleOf)).toEqual([rule, twin])
  })
})

describe('a mistake that two rules report gets one report', () => {
  const tsx = 'src/counter.tsx'

  async function reportingRules(
    fixture: string,
    options: Partial<EslintConfigOptions>,
    file: string,
    code: string,
    rules: ReadonlyArray<string>,
  ): Promise<Array<string>> {
    const eslintOptions = { antislop: { slop: false }, ...options }
    // Each set of `configs` is used once, so caching its instance would only hold memory
    const eslint =
      options.configs === undefined
        ? await sharedESLint(fixture, eslintOptions)
        : await createESLint(fixture, eslintOptions)
    const messages = await lintText(eslint, file, code)
    return messages.map((message) => ruleOf(message) ?? '').filter((rule) => rules.includes(rule))
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
  let eslint: ESLint

  beforeAll(async () => {
    eslint = await sharedESLint('rules', { antislop: { slop: false } })
  })

  it.each([
    [
      '`a && a`',
      'x.js',
      'export function both(a) {\n  return a && a\n}\n',
      ['sonarjs/no-identical-expressions', 'unicorn/no-duplicate-logical-operands'],
    ],
    [
      '`a - a`, which only the SonarJS rule reports',
      'x.js',
      'export function zero(a) {\n  return a - a\n}\n',
      ['sonarjs/no-identical-expressions'],
    ],
    [
      '`module.exports = function () {}`, which only the unicorn rule reports',
      'x.cjs',
      'module.exports = function () {\n  return 1\n}\n',
      ['unicorn/no-anonymous-default-export'],
    ],
  ])('%s', async (_name, file, code, rules) => {
    const messages = await lintText(eslint, file, code)
    expect(messages.map(ruleOf)).toEqual(rules)
  })
})

describe('a style rule whose fix another rule reports is off where that rule runs', () => {
  const cwd = path.resolve(FIXTURES_DIR, 'rules')
  const code =
    'export function id(params: { id?: string }): string {\n  return params.id as string\n}\n'
  const rule = '@typescript-eslint/non-nullable-type-assertion-style'

  it('leaves `x as string` in source files, and fixes it to `x!` in test files (M4)', async () => {
    const eslint = await createESLint('rules', { antislop: { slop: false } }, { fix: true })
    const [source] = await eslint.lintText(code, { filePath: path.join(cwd, 'src/dead-store.ts') })
    expect(source?.output).toBeUndefined()
    expect(source?.messages.map((message) => message.ruleId)).not.toContain(rule)
    const [test] = await eslint.lintText(code, {
      filePath: path.join(cwd, 'src/__tests__/unbound-method.ts'),
    })
    expect(test?.output).toBe(code.replace('params.id as string', 'params.id!'))
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
    ['src/a.ts', 'src/a.test.ts', 'tests/a.ts', 'tests/fixtures/a.ts', 'tests/data/a.ts'].map(
      async (file) => {
        const config = (await eslint.calculateConfigForFile(file)) as Linter.Config
        return [file, severityOf(config.rules?.[twin]) ?? 0]
      },
    ),
  )
  expect(Object.fromEntries(severities)).toEqual({
    'src/a.ts': 0,
    'src/a.test.ts': 2,
    'tests/a.ts': 2,
    'tests/fixtures/a.ts': 0,
    'tests/data/a.ts': 0,
  })
})
