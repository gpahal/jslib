/**
 * Writes `src/internal/typegen.gen.d.ts`, the names and options of every rule the presets can turn
 * on and their config names, and `src/internal/config-names.gen.ts`, those names at runtime. It
 * loads the build, so `pnpm gen` builds before and after. `tests/typegen.test.ts` checks freshness
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import type { ESLint, Rule } from 'eslint'
import { compileRule, flatConfigsToPlugins } from 'eslint-typegen/core'
import { builtinRules } from 'eslint/use-at-your-own-risk'

import { formatMessage } from '@gpahal/std/errors'
import { isRecord } from '@gpahal/std/objects'

import { defineConfig } from '../build/index.js'
import { DUPLICATE_RULES } from '../src/internal/duplicate-rules.ts'
import { AREA_RULE_PREFIXES, GITIGNORE_CONFIG_NAMES, hasRulePrefix } from '../src/internal/names.ts'
import type { AreaName } from '../src/internal/names.ts'

const PACKAGE_DIR = path.join(import.meta.dirname, '..')

export const TYPEGEN_PATH: string = path.join(PACKAGE_DIR, 'src/internal/typegen.gen.d.ts')

export const CONFIG_NAMES_PATH: string = path.join(PACKAGE_DIR, 'src/internal/config-names.gen.ts')

const SCHEMA_MAP_KEYWORDS = new Set(['properties', 'patternProperties', 'definitions', '$defs'])

const DATA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples'])

function mapSubschemas(schema: unknown, fn: (subschema: unknown) => unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item: unknown) => fn(item))
  }
  if (!isRecord(schema)) {
    return schema
  }
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]): [string, unknown] => {
      if (DATA_KEYWORDS.has(key)) {
        return [key, value]
      }
      if (SCHEMA_MAP_KEYWORDS.has(key) && isRecord(value)) {
        return [
          key,
          Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, fn(sub)])),
        ]
      }
      return [key, Array.isArray(value) ? value.map((item: unknown) => fn(item)) : fn(value)]
    }),
  )
}

/**
 * Sets `additionalProperties: true` on object schemas with `properties` and none, or with
 * `patternProperties` beside `properties`, so the compiler writes an `unknown` index signature.
 * Otherwise it writes the `patternProperties` type, which `skipLibCheck: false` rejects when a
 * named property doesn't fit it, as in `vitest/valid-title`
 */
export function withAdditionalProperties(schema: unknown): unknown {
  const patched = mapSubschemas(schema, withAdditionalProperties)
  if (!isRecord(patched) || !isRecord(patched['properties'])) {
    return patched
  }
  const hasNamedProperties = Object.keys(patched['properties']).length > 0
  return !('additionalProperties' in patched) ||
    (hasNamedProperties && 'patternProperties' in patched)
    ? { ...patched, additionalProperties: true }
    : patched
}

const DEFINITION_REF_REGEX = /^#\/(definitions|\$defs)\/(.+)$/u

/**
 * Inlines non-recursive `$ref`s to `definitions` or `$defs`. The compiler writes a definition
 * reached twice as an interface with two index signatures, which `skipLibCheck: false` rejects
 */
export function withInlinedDefinitions(schema: unknown): unknown {
  const definitionsOf = (keyword: string): Record<string, unknown> =>
    isRecord(schema) && isRecord(schema[keyword]) ? schema[keyword] : {}
  const definitions = { definitions: definitionsOf('definitions'), $defs: definitionsOf('$defs') }
  const inline = (node: unknown, expanding: ReadonlySet<string>): unknown => {
    const ref = isRecord(node) ? node['$ref'] : undefined
    const match = typeof ref === 'string' ? DEFINITION_REF_REGEX.exec(ref) : null
    const [, keyword, name] = match ?? []
    const source = keyword === '$defs' ? definitions.$defs : definitions.definitions
    const key = `${keyword ?? ''}/${name ?? ''}`
    if (
      name !== undefined &&
      isRecord(node) &&
      !expanding.has(key) &&
      Object.hasOwn(source, name)
    ) {
      const { $ref: _ref, ...rest } = node
      const definition = inline(source[name], new Set([...expanding, key]))
      const siblings = inline(rest, expanding)
      return {
        ...(isRecord(definition) && definition),
        ...(isRecord(siblings) && siblings),
      }
    }
    return mapSubschemas(node, (subschema) => inline(subschema, expanding))
  }
  return inline(schema, new Set())
}

function hasDuplicateDeclarations(declarations: ReadonlyArray<string>): boolean {
  const names = declarations.flatMap((line) => /^(?:interface|type) (\w+)/.exec(line)?.[1] ?? [])
  return new Set(names).size !== names.length
}

/**
 * Throws when the compiler would still declare a name twice, as for a recursive definition
 */
export async function patchRule(name: string, rule: Rule.RuleModule): Promise<Rule.RuleModule> {
  const withSchema = (schema: unknown): Rule.RuleModule => ({
    ...rule,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The rule's own schema, patched without changing what it accepts
    meta: { ...rule.meta, schema: schema as Rule.RuleMetaData['schema'] },
  })
  const patched = withSchema(withAdditionalProperties(rule.meta?.schema))
  if (!hasDuplicateDeclarations((await compileRule(name, patched)).typeDeclarations)) {
    return patched
  }
  const inlined = withSchema(withInlinedDefinitions(patched.meta?.schema))
  if (hasDuplicateDeclarations((await compileRule(name, inlined)).typeDeclarations)) {
    throw new Error(
      formatMessage(
        '@gpahal/eslint-config',
        ['typegen', `\`${name}\``],
        'declares a type name twice after its definitions are inlined, which a consumer with `skipLibCheck: false` rejects. Patch its schema in `patchRule`',
      ),
    )
  }
  return inlined
}

async function patchPlugins(
  plugins: Record<string, ESLint.Plugin>,
): Promise<Record<string, ESLint.Plugin>> {
  const entries = await Promise.all(
    Object.entries(plugins).map(async ([pluginName, plugin]) => {
      const rules = await Promise.all(
        Object.entries(plugin.rules ?? {}).map(
          async ([ruleName, rule]): Promise<[string, typeof rule]> => [
            ruleName,
            typeof rule === 'object'
              ? await patchRule(pluginName ? `${pluginName}/${ruleName}` : ruleName, rule)
              : rule,
          ],
        ),
      )
      return [pluginName, { ...plugin, rules: Object.fromEntries(rules) }] as const
    }),
  )
  return Object.fromEntries(entries)
}

/**
 * `localeCompare` sorts by the process's locale
 */
const collator = new Intl.Collator('en')

/**
 * eslint-typegen's `pluginsToRulesDTS` without the module augmentation, sorting by `collator`.
 * `tests/upstream-workarounds.canary.test.ts` fails once upstream sorts the same in every
 * locale: then use `pluginsToRulesDTS` and remove this fork
 */
export async function pluginsToRulesDts(plugins: Record<string, ESLint.Plugin>): Promise<string> {
  const rules = Object.entries(plugins)
    .flatMap(([pluginName, plugin]) =>
      Object.entries(plugin.rules ?? {}).map(
        ([ruleName, rule]) => [pluginName ? `${pluginName}/${ruleName}` : ruleName, rule] as const,
      ),
    )
    .filter(([, rule]) => rule.meta == null || typeof rule.meta === 'object')
    .toSorted(([a], [b]) => collator.compare(a, b))
  const compiled = await Promise.all(rules.map(async ([name, rule]) => compileRule(name, rule)))
  return [
    '/* eslint-disable */',
    '/* prettier-ignore */',
    "import type { Linter } from 'eslint'",
    '',
    'export interface RuleOptions {',
    ...compiled.flatMap(({ typeName, name, jsdoc }) => [
      ...(jsdoc.length > 0
        ? [
            `  /**\n${jsdoc
              .map((line) => `   * ${line}`)
              .join('\n')
              .replaceAll('*/', String.raw`*\/`)}\n   */`,
          ]
        : []),
      `  '${name}'?: Linter.RuleEntry<${typeName}>`,
    ]),
    '}',
    '',
    '/* ======= Declarations ======= */',
    compiled.flatMap(({ typeDeclarations }) => typeDeclarations).join('\n'),
  ].join('\n')
}

/**
 * A rule per area, which a `rules` entry turns off, so the area's `rules` config is named.
 * `tests/typegen.test.ts` checks every area has one
 */
export const AREA_RULES: Readonly<Record<AreaName, string>> = {
  javascript: 'no-console',
  typescript: '@typescript-eslint/array-type',
  imports: 'import-x/first',
  unicorn: 'unicorn/no-null',
  regexp: 'regexp/no-useless-flag',
  sonarjs: 'sonarjs/non-existent-operator',
  commentLayout: '@gpahal/comment-layout',
  e18e: 'e18e/prefer-timer-args',
  antislop: 'sonarjs/no-commented-code',
  eslintComments: '@eslint-community/eslint-comments/no-aggregating-enable',
  jsdoc: 'jsdoc/check-access',
  json: 'json/no-duplicate-keys',
  yaml: 'yml/no-empty-key',
  toml: 'toml/indent',
  pnpm: 'pnpm/json-valid-catalog',
  packageJson: 'package-json/require-name',
  markdown: 'markdown/no-empty-links',
  react: '@eslint-react/no-missing-key',
  nextjs: '@next/next/no-img-element',
  astro: 'astro/no-conflict-set-directives',
  html: '@html-eslint/require-img-alt',
  tailwindcss: 'better-tailwindcss/no-duplicate-classes',
  node: 'n/no-deprecated-api',
  turbo: 'turbo/no-undeclared-env-vars',
  vitest: 'vitest/no-focused-tests',
  playwright: 'playwright/no-focused-test',
  storybook: 'storybook/story-exports',
  browser: '@gpahal/no-node-imports',
  server: '@gpahal/no-browser-globals',
}

/**
 * Without the git ignore configs, which depend on the checkout. `getConfigNames` adds them
 */
const BASE_OPTIONS = {
  root: path.join(PACKAGE_DIR, 'tests/fixtures'),
  isInEditor: false,
  gitignore: false,
} satisfies Parameters<typeof defineConfig>[0]

/**
 * `tests/typegen.test.ts` checks that it turns every area on
 */
export const ALL_ON_OPTIONS: Parameters<typeof defineConfig>[0] = {
  ...BASE_OPTIONS,
  typescript: { library: true },
  // Not every `.js` file, which the other tests lint as ES modules
  commonjs: { files: ['cjs/**'] },
  imports: { removeUnused: true, cycles: true },
  browser: { files: ['src/client/**'] },
  server: { files: ['src/server/**'] },
  pnpm: true,
  packageJson: true,
  markdown: true,
  react: true,
  nextjs: true,
  astro: true,
  html: true,
  tailwindcss: { entryPoint: 'tailwindcss/src/styles.css' },
  node: { typeStripping: true },
  turbo: true,
  vitest: true,
  playwright: true,
  storybook: true,
  antislop: { slop: { inspection: 'full' } },
}

const ALWAYS_ON_AREAS: ReadonlySet<AreaName> = new Set(['javascript', 'typescript'])

function isAreaName(name: string): name is AreaName {
  return Object.hasOwn(AREA_RULE_PREFIXES, name)
}

/**
 * The first area with a prefix of the rule, so `javascript` for a core rule
 */
function getRuleArea(rule: string): AreaName | undefined {
  return Object.keys(AREA_RULE_PREFIXES)
    .filter((name) => isAreaName(name))
    .find((area) => hasRulePrefix(rule, AREA_RULE_PREFIXES[area]))
}

/**
 * For each kept rule of `DUPLICATE_RULES`, every option on but the areas whose rules keep its twin
 * config from being added. Without them, a config named after the kept rule's area, as
 * `gpahal/duplicates/rules/antislop/sonarjs` with `unicorn: false`, wouldn't be typed
 */
export function getDuplicateOptionSets(): Array<Parameters<typeof defineConfig>[0]> {
  const offAreaSets = new Map<string, Array<AreaName>>()
  for (const { kept, off } of DUPLICATE_RULES) {
    for (const rule of kept) {
      const pruners = [
        ...kept.filter((other) => other !== rule),
        ...DUPLICATE_RULES.filter((other) => other.off === rule).flatMap((other) => other.kept),
      ]
      const needed = new Set([getRuleArea(rule), getRuleArea(off)])
      const areas = [
        ...new Set(
          pruners.flatMap((pruner) => {
            const area = getRuleArea(pruner)
            return area === undefined || needed.has(area) || ALWAYS_ON_AREAS.has(area) ? [] : area
          }),
        ),
      ].toSorted((a, b) => collator.compare(a, b))
      if (areas.length > 0) {
        offAreaSets.set(areas.join(','), areas)
      }
    }
  }
  return Array.from(offAreaSets.values(), (areas) => ({
    ...ALL_ON_OPTIONS,
    ...Object.fromEntries(areas.map((area) => [area, false])),
  }))
}

/**
 * The option sets whose configs together have every name
 */
const NAMED_OPTION_SETS: Array<Parameters<typeof defineConfig>[0]> = [
  ALL_ON_OPTIONS,
  {
    ...ALL_ON_OPTIONS,
    ...Object.fromEntries(
      Object.entries(AREA_RULES).map(([area, rule]) => [area, { rules: { [rule]: 'off' } }]),
    ),
    typescript: {
      library: true,
      rules: { [AREA_RULES.typescript]: 'off' },
      rulesTypeAware: { [AREA_RULES.typescript]: 'off' },
    },
    antislop: { slop: { inspection: 'full' }, rules: { [AREA_RULES.antislop]: 'off' } },
    browser: { files: ['src/client/**'], rules: { [AREA_RULES.browser]: 'off' } },
    server: { files: ['src/server/**'], rules: { [AREA_RULES.server]: 'off' } },
    tailwindcss: {
      entryPoint: 'tailwindcss/src/styles.css',
      rules: { [AREA_RULES.tailwindcss]: 'off' },
    },
  },
  // Rules that also run in Markdown and data files, so the areas add `user-rules` configs there
  {
    ...ALL_ON_OPTIONS,
    antislop: { slop: { inspection: 'full' }, rules: { 'slop/no-em-dash': 'off' } },
    eslintComments: { rules: { '@eslint-community/eslint-comments/require-description': 'off' } },
    javascript: { rules: { '@gpahal/no-bidi-characters': 'off' } },
  },
  { ...ALL_ON_OPTIONS, typeAware: false },
  { ...ALL_ON_OPTIONS, isInEditor: true },
  {
    ...ALL_ON_OPTIONS,
    react: { scope: ['react/**', 'nextjs/**'] },
    nextjs: { scope: ['nextjs/**'], rootDir: 'nextjs' },
  },
  ...getDuplicateOptionSets(),
]

/**
 * Configs added once the composer's configs resolve, which its methods can't reach
 */
const RESOLVED_CONFIGS_PREFIXES = [
  'gpahal/formatting/off',
  'gpahal/disable-type-checked/',
  'gpahal/root-spelling',
]

export function isResolvedConfigName(name: string): boolean {
  return RESOLVED_CONFIGS_PREFIXES.some((prefix) => name.startsWith(prefix))
}

const GITIGNORE_NAMES: ReadonlySet<string> = new Set(GITIGNORE_CONFIG_NAMES)

/**
 * In order of first appearance, with the git ignore configs before `gpahal/ignores/defaults`
 */
export function getConfigNames(
  configSets: Array<Array<{ name?: string | undefined }>>,
): Array<string> {
  const names = new Set<string>()
  for (const config of configSets.flat()) {
    const { name } = config
    if (name === undefined || isResolvedConfigName(name) || GITIGNORE_NAMES.has(name)) {
      continue
    }
    if (name === 'gpahal/ignores/defaults') {
      for (const gitignoreName of GITIGNORE_CONFIG_NAMES) {
        names.add(gitignoreName)
      }
    }
    names.add(name)
  }
  return [...names]
}

/**
 * A single-quoted string literal, in the generated files' quote style
 */
export function toStringLiteral(value: string): string {
  const escaped = JSON.stringify(value)
    .slice(1, -1)
    .replaceAll(/\\"|'/gu, (match) => (match === "'" ? String.raw`\'` : '"'))
  return `'${escaped}'`
}

/**
 * Warnings about the fixtures' setup, which say nothing about the generated types
 */
const FIXTURE_WARNING_CODES: ReadonlySet<string> = new Set(['GPAHAL_DEFAULT_PROJECT_NODE_TYPES'])

async function withoutFixtureWarnings<T>(run: () => Promise<T>): Promise<T> {
  const emitWarning = process.emitWarning.bind(process)
  const filtered = (warning: string | Error, ...rest: Array<unknown>): void => {
    const [options] = rest
    const code: unknown = isRecord(options) ? Reflect.get(options, 'code') : undefined
    if (typeof code !== 'string' || !FIXTURE_WARNING_CODES.has(code)) {
      Reflect.apply(emitWarning, process, [warning, ...rest])
    }
  }
  process.emitWarning = filtered
  try {
    return await run()
  } finally {
    process.emitWarning = emitWarning
  }
}

export async function generateTypegen(): Promise<{ typegen: string; configNames: string }> {
  const configSets = await withoutFixtureWarnings(async () =>
    Promise.all(NAMED_OPTION_SETS.map(async (options) => defineConfig(options))),
  )
  const plugins = await flatConfigsToPlugins([
    // The core rules, which no plugin holds
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- ESLint exposes them nowhere else
    { plugins: { '': { rules: Object.fromEntries(builtinRules) } } },
    // The first set has every rule, but those of configs the composer can't reach
    ...(configSets[0] ?? []).filter(
      ({ name }) => name === undefined || !isResolvedConfigName(name),
    ),
  ])
  const rules = await pluginsToRulesDts(await patchPlugins(plugins))
  const names = getConfigNames(configSets)
  return {
    typegen: [
      '// Generated by `pnpm gen` from the presets. Do not edit',
      rules.trim(),
      '',
      '// The names of the configs, for `.override()` and the other composer methods',
      `export type ConfigNames =\n${names.map((name) => `  | ${toStringLiteral(name)}`).join('\n')}`,
      '',
    ].join('\n'),
    configNames: [
      '// Generated by `pnpm gen` from the presets. Do not edit',
      '',
      '/**',
      ' * The name of every config that `defineConfig` can add and the composer can reach, with some',
      ' * options',
      ' */',
      'export const CONFIG_NAMES: ReadonlySet<string> = new Set([',
      ...names.map((name) => `  ${toStringLiteral(name)},`),
      '])',
      '',
    ].join('\n'),
  }
}

// Not `import.meta.main`, which Node 24 marks experimental
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  const { typegen, configNames } = await generateTypegen()
  await Promise.all([
    fs.writeFile(TYPEGEN_PATH, typegen),
    fs.writeFile(CONFIG_NAMES_PATH, configNames),
  ])
}
