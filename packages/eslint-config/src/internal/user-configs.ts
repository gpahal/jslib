import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import type { ESLint, Linter } from 'eslint'
import { defineConfig } from 'eslint/config'

import { expandBraces } from '@gpahal/internal/globs'
import { toArray } from '@gpahal/std/arrays'
import { describeValue, formatMessage, formatNames, getErrorReason } from '@gpahal/std/errors'
import { clonePlain, isPlainObject, isRecord } from '@gpahal/std/objects'

import { PACKAGE_JSON_FILES } from '@/internal/configs/constants'
import {
  CODE_EXTNS,
  JAVASCRIPT_EXTNS,
  MARKDOWN_EXTNS,
  NON_CODE_EXTNS,
  NON_CODE_FILES,
  NON_CODE_KIND_EXTNS,
  UNTYPED_CODE_EXTNS,
} from '@/internal/files'
import { checkFormattingRules } from '@/internal/formatting'
import { canMatchFile, canMatchOtherFile } from '@/internal/glob-match'
import {
  createGlobMatcher,
  createListMatcher,
  GLOBAL_IGNORES_KEYS,
  isLiteralGlob,
  rebaseGlob,
  splitGlobs,
  unescapeGlob,
  withoutLeadingDotSlash,
} from '@/internal/globs'
import { joinList } from '@/internal/lists'
import { AREA_RULE_PREFIXES, PLUGIN_AREAS, type AreaName } from '@/internal/names'
import {
  canRunIn,
  getLanguageIgnores,
  getLanguageKind,
  getLanguageSources,
  getMatchedLanguages,
  type KindLanguage,
  type LanguageSource,
} from '@/internal/preset-languages'
import { checkRelativeGlobsAt } from '@/internal/relative-globs'
import { getPlugins, isRuleOn, needsTypeInformation, parseRuleId } from '@/internal/rules'
import type { TypedConfig } from '@/internal/types'
import { fail, isPresetPlugin, PREFIX } from '@/internal/utils'

/**
 * `config` as it is, typed so its `rules` can name a rule newer than the generated types. Its rule
 * names are still checked against the loaded plugins
 *
 * @example
 * ```ts
 * import { defineConfig, untyped } from '@gpahal/eslint-config'
 *
 * defineConfig({
 *   root: import.meta.dirname,
 *   configs: [untyped({ rules: { 'unicorn/newer-rule': 'error' } })],
 * })
 * ```
 */
export function untyped(config: Linter.Config): TypedConfig {
  return config
}

/**
 * The sources of configs of yours that are scoped and checked as `configs` is
 */
export type AddedConfigSource = 'configs' | 'append' | 'insertBefore' | 'insertAfter'

export type UserConfigSource =
  AddedConfigSource | 'overrideRules' | 'onResolved' | { method: 'override'; name: string }

function isAddedSource(source: UserConfigSource): source is AddedConfigSource {
  return typeof source === 'string' && source !== 'overrideRules' && source !== 'onResolved'
}

/**
 * As in `` `configs` `` or `` `.override('gpahal/javascript/rules')` ``
 */
function describeSource(source: UserConfigSource): string {
  if (typeof source === 'object') {
    return formatNames([`.${source.method}('${source.name}')`])
  }
  return source === 'configs' ? '`configs`' : `\`.${source}()\``
}

/**
 * Error subjects for the item of `source` at `indices`, as in `` ['`configs[0][1]`'] `` or
 * `` ['`.append()`', 'item `[0]`'] ``
 */
function describeItem(
  source: AddedConfigSource,
  indices: ReadonlyArray<number>,
  suffix = '',
): Array<string> {
  const path = `${indices.map((index) => `[${String(index)}]`).join('')}${suffix}`
  return source === 'configs'
    ? [`\`configs${path}\``]
    : [describeSource(source), `item \`${path}\``]
}

const EXTENDED_CONFIGS = new WeakSet<TypedConfig>()

/**
 * One index per level of nesting, shared by the configs one item's `extends` flattens to
 */
const ITEM_INDICES = new WeakMap<TypedConfig, ReadonlyArray<number>>()

/**
 * Configs named by `nameUserConfig`, whose name the error subjects already give
 */
const GENERATED_NAMES = new WeakSet<TypedConfig>()

/**
 * Names an unnamed copy of a config of yours, as in `user/configs[1][0]`, for `--inspect-config`.
 * Its split parts and flattened `extends` take the name. `gpahal/` marks the presets' configs
 */
export function nameUserConfig(
  config: TypedConfig,
  source: AddedConfigSource | 'onResolved',
  indices: ReadonlyArray<number>,
): void {
  if (config.name !== undefined) {
    return
  }
  config.name = `user/${source}${indices.map((index) => `[${String(index)}]`).join('')}`
  GENERATED_NAMES.add(config)
}

/**
 * Splits as ESLint does: a scoped plugin keeps its scope, as in `@scope/plugin/config`
 */
function parseExtendsName(value: string): { pluginName: string; configName: string } | undefined {
  const slash = value.indexOf('/')
  if (slash === -1) {
    return undefined
  }
  const scopedSlash = value.startsWith('@') && slash > 1 ? value.indexOf('/', slash + 1) : -1
  const end = scopedSlash === -1 ? slash : scopedSlash
  return { pluginName: value.slice(0, end), configName: value.slice(end + 1) }
}

/**
 * Throws on a string in `extends` that doesn't name a config of a plugin `config` registers.
 * ESLint's own error names neither the config nor the string
 */
function checkExtendsNames(
  config: TypedConfig,
  source: AddedConfigSource,
  indices: ReadonlyArray<number>,
): void {
  const entries: unknown = Reflect.get(config, 'extends')
  if (!Array.isArray(entries)) {
    return
  }
  for (const [index, entry] of entries.entries()) {
    if (typeof entry !== 'string') {
      continue
    }
    const subjects = [...describeItem(source, indices), `\`extends[${String(index)}]\``]
    const parsed = parseExtendsName(entry)
    const plugin: unknown =
      parsed === undefined || !isPlainObject(config.plugins)
        ? undefined
        : config.plugins[parsed.pluginName]
    if (parsed === undefined || plugin === undefined || parsed.configName === '') {
      fail(
        subjects,
        `expected \`<plugin>/<config>\` naming a plugin this config registers, received ${describeValue(entry)}`,
      )
    }
    // A module namespace or a class instance isn't a plain object
    const configs: unknown = isRecord(plugin) ? plugin['configs'] : undefined
    if (
      !isRecord(configs) ||
      (configs[parsed.configName] === undefined &&
        configs[`flat/${parsed.configName}`] === undefined)
    ) {
      fail(
        subjects,
        `plugin ${formatNames([parsed.pluginName])} has no config ${formatNames([parsed.configName])}`,
      )
    }
  }
}

/**
 * Nested arrays spread, and `extends` flattened as ESLint's `defineConfig` does
 *
 * @throws TypeError on an item that is neither a plain object nor an array, which ESLint would fail
 *   on later without naming the item
 */
function flattenUserConfigs(
  configs: ReadonlyArray<unknown>,
  source: AddedConfigSource,
  indices: ReadonlyArray<number> = [],
): Array<TypedConfig> {
  return configs.flatMap((config, index): Array<TypedConfig> => {
    const itemIndices = [...indices, index]
    if (Array.isArray(config)) {
      return flattenUserConfigs(config, source, itemIndices)
    }
    if (!isPlainObject(config)) {
      fail(
        describeItem(source, itemIndices),
        `expected a config object or an array of them, received ${describeValue(config)}`,
      )
    }

    const typed = config as TypedConfig
    nameUserConfig(typed, source, itemIndices)
    if (!('extends' in config)) {
      ITEM_INDICES.set(typed, itemIndices)
      return [typed]
    }
    checkExtendsNames(typed, source, itemIndices)
    // ESLint names the extended configs `<name> > <their name>`
    const name = typeof typed.name === 'string' ? typed.name : undefined
    let flattened: Array<Linter.Config>
    try {
      flattened = defineConfig(config)
    } catch (error) {
      // ESLint's message names neither the config nor the entry
      throw new TypeError(
        formatMessage(
          PREFIX,
          describeItem(source, itemIndices),
          `ESLint's \`defineConfig\` rejects it: ${getErrorReason(error)}`,
        ),
        { cause: error },
      )
    }
    for (const flat of flattened) {
      ITEM_INDICES.set(flat, itemIndices)
      if (flat.name !== name) {
        EXTENDED_CONFIGS.add(flat)
      } else if (GENERATED_NAMES.has(typed)) {
        GENERATED_NAMES.add(flat)
      }
    }
    return flattened
  })
}

/**
 * Error subjects for a config of yours, as in `` ['`configs[1]` (`user/tsx`)'] ``
 */
export function describeUserConfig(config: TypedConfig, source: UserConfigSource): Array<string> {
  const indices = ITEM_INDICES.get(config)
  const subjects =
    indices !== undefined && isAddedSource(source)
      ? describeItem(source, indices)
      : [describeSource(source)]
  const { name } = config
  if (typeof source === 'object' || name === undefined || GENERATED_NAMES.has(config)) {
    return subjects
  }
  const last = subjects.length - 1
  return subjects.map((subject, index) =>
    index === last ? `${subject} (${formatNames([name])})` : subject,
  )
}

const NON_CODE_AREAS = [
  ['markdown', 'markdown', 'Markdown'],
  ['json', 'json', 'JSON'],
  ['packageJson', 'json', 'JSON'],
  ['yaml', 'yaml', 'YAML'],
  ['toml', 'toml', 'TOML'],
  ['html', 'html', 'HTML'],
] as const satisfies ReadonlyArray<[area: AreaName, kind: string, language: string]>

/**
 * Rule prefixes for non-code files. `pnpm/json-*` rules are for `package.json` and `pnpm/yaml-*`
 * ones for `pnpm-workspace.yaml`, as eslint-plugin-pnpm's configs apply them
 */
const NON_CODE_RULE_PREFIXES: ReadonlyArray<
  [prefix: string, kind: (typeof NON_CODE_AREAS)[number][1], language: string]
> = [
  ...NON_CODE_AREAS.flatMap(([area, kind, language]) =>
    AREA_RULE_PREFIXES[area].map((prefix): [string, typeof kind, string] => [
      prefix,
      kind,
      language,
    ]),
  ),
  ...AREA_RULE_PREFIXES.pnpm.flatMap((prefix): Array<[string, 'json' | 'yaml', string]> => [
    [`${prefix}json-`, 'json', 'JSON'],
    [`${prefix}yaml-`, 'yaml', 'YAML'],
  ]),
]

/**
 * `undefined` for a rule that isn't for non-code files
 */
function getNonCodeRuleFiles(
  rule: string,
): { kind: (typeof NON_CODE_AREAS)[number][1]; language: string; files: string } | undefined {
  const match = NON_CODE_RULE_PREFIXES.find(([prefix]) => rule.startsWith(prefix))
  if (match === undefined) {
    return undefined
  }
  const [, kind, language] = match
  // eslint-plugin-package-json's rules run in `json/json` only, but `files.json` matches JSONC too
  if (rule.startsWith(AREA_RULE_PREFIXES.packageJson[0])) {
    const files = `\`files: [${PACKAGE_JSON_FILES.map((glob) => `'${glob}'`).join(', ')}]\``
    return { kind, language: '`package.json`', files }
  }
  return {
    kind,
    language,
    files: `\`files: [...files.${kind}]\`, with \`files\` from this package`,
  }
}

/**
 * Throws on a non-code rule in `config`, which doesn't reach those files
 */
function checkNonCodeRules(
  config: TypedConfig,
  source: UserConfigSource,
  rules: ReadonlyArray<string>,
  scope: string,
  target: (files: string) => string,
): void {
  for (const rule of rules) {
    const match = getNonCodeRuleFiles(rule)
    if (match === undefined) {
      continue
    }
    const { kind, language, files } = match
    // html-eslint can lint HTML in template literals, but the `html` preset doesn't set that up
    const reason =
      kind === 'html'
        ? ' The `html` preset lints `.html` files only, not HTML in template literals, so set `files` to target them.'
        : ''
    fail(
      [...describeUserConfig(config, source), formatNames([rule])],
      `is a rule for ${language} files${scope}.${reason} ${target(files)}`,
    )
  }
}

/**
 * A negated glob matches every file but those it names, so it doesn't narrow an entry
 */
function isCodeOnly(config: TypedConfig, source: UserConfigSource): boolean {
  const subjects = [...describeUserConfig(config, source), '`files`']
  return (
    config.files !== undefined &&
    config.language === undefined &&
    config.files.every((entry) =>
      toArray(entry).some(
        (glob) =>
          typeof glob === 'string' &&
          !glob.startsWith('!') &&
          !canMatchFile(subjects, glob, NON_CODE_EXTNS),
      ),
    )
  )
}

/**
 * Throws on a change that removes a code-only config's `files` or widens them to non-code files.
 * A config that only turns rules off can apply anywhere
 */
function checkCodeOnlyScope(
  config: TypedConfig,
  source: UserConfigSource,
  original: TypedConfig,
): void {
  if (!isCodeOnly(original, source) || isCodeOnly(config, source) || isAllOff(config)) {
    return
  }
  fail(
    [...describeUserConfig(config, source), '`files`'],
    `${
      config.files === undefined
        ? 'removes them from a config for code files only, so its rules would run on JSON, YAML, TOML, Markdown and HTML files too'
        : 'widens a config for code files only to files that can be JSON, YAML, TOML, Markdown or HTML, where its rules would run too'
    }. Keep \`files\` within the code files, as in \`[...files.code]\`, with \`files\` from this package`,
  )
}

/**
 * The Markdown processor parses with fixed options, since a processor gets no `languageOptions`,
 * and both parses must find the same code blocks
 */
const MARKDOWN_PARSE_OPTIONS = {
  frontmatter: 'Front matter is fixed to YAML and TOML',
  math: 'Set the `markdown.math` option instead',
} as const

function canMatchMarkdown(config: TypedConfig, source: UserConfigSource): boolean {
  const subjects = [...describeUserConfig(config, source), '`files`']
  return (
    config.files === undefined ||
    config.files.some((entry) =>
      toArray(entry).every(
        (glob) =>
          typeof glob !== 'string' ||
          glob.startsWith('!') ||
          canMatchFile(subjects, glob, ['md', 'markdown']),
      ),
    )
  )
}

function isChanged(record: object, original: object | undefined, key: string): boolean {
  return (
    original === undefined ||
    !Object.hasOwn(original, key) ||
    !isDeepStrictEqual(Reflect.get(record, key), Reflect.get(original, key))
  )
}

/**
 * Allows the value `original` has
 */
function checkMarkdownParseOptions(
  config: TypedConfig,
  source: UserConfigSource,
  original: TypedConfig | undefined,
): void {
  const { languageOptions } = config
  if (languageOptions === undefined || !canMatchMarkdown(config, source)) {
    return
  }
  for (const [key, reason] of Object.entries(MARKDOWN_PARSE_OPTIONS)) {
    if (
      Object.hasOwn(languageOptions, key) &&
      isChanged(languageOptions, original?.languageOptions, key)
    ) {
      fail(
        [...describeUserConfig(config, source), `\`languageOptions.${key}\``],
        `can apply to Markdown files, whose parse this package's Markdown processor shares with the language. ${reason}`,
      )
    }
  }
}

/**
 * ESLint doesn't check an off rule against the file's language, so such a config can apply to
 * every file
 */
function isAllOff(config: TypedConfig): boolean {
  return (
    config.languageOptions === undefined &&
    config.processor === undefined &&
    Object.values(config.rules ?? {}).every((entry) => !isRuleOn(entry))
  )
}

export type Presets = {
  plugins: ReadonlyMap<string, ESLint.Plugin>
  /**
   * In config order, yours included
   */
  languages: ReadonlyArray<LanguageSource>
}

export function getPresets(configs: ReadonlyArray<TypedConfig>): Presets {
  const presets = configs.filter((config) => config.name?.startsWith('gpahal/') === true)
  return {
    plugins: getPlugins(presets),
    languages: getLanguageSources(
      configs.filter(
        (config) => config.name?.startsWith('gpahal/') === true || config.language !== undefined,
      ),
    ),
  }
}

function describePlugins(config: TypedConfig, source: UserConfigSource): Array<string> {
  const indices = ITEM_INDICES.get(config)
  return indices !== undefined && isAddedSource(source)
    ? describeItem(source, indices, '.plugins')
    : [...describeUserConfig(config, source), '`plugins`']
}

/**
 * Throws on a plugin registered under a preset's name as another object, which ESLint would reject
 * without saying where to set its rules instead
 */
function checkPresetPlugins(
  config: TypedConfig,
  source: UserConfigSource,
  presetPlugins: Presets['plugins'],
): void {
  const plugins = isPlainObject(config.plugins) ? config.plugins : {}
  for (const [name, plugin] of Object.entries(plugins)) {
    const preset = presetPlugins.get(name)
    // `withPresetPlugin` swaps a wrapped plugin's stock object for the preset's
    if (preset === undefined || isPresetPlugin(plugin, preset)) {
      continue
    }
    const area = PLUGIN_AREAS.get(name)
    fail(
      describePlugins(config, source),
      `registers ${formatNames([name])} again with a different plugin. ${area === undefined ? 'Remove it from the config' : `Set its rules with \`${area}.rules\` instead`}`,
    )
  }
}

const CODE_BLOCK_GLOB = new RegExp(String.raw`\.(?:${MARKDOWN_EXTNS.join('|')})/`)

export const SCOPE_KEYS = ['files', 'ignores', 'language'] as const

/**
 * eslint-comments reads directives through `getInlineConfigNodes` when a language has no
 * `getAllComments`
 */
const ANY_LANGUAGE_PLUGINS: ReadonlySet<string> = new Set(['@eslint-community/eslint-comments'])

type UnrunnableRule = {
  rule: string
  /**
   * In the order of `NON_CODE_KIND_EXTNS`
   */
  kinds: Array<string>
  isTyped: boolean
  isNonCode: boolean
}

const CODE_KIND = 'code'

/**
 * Code blocks, such as `README.md/0.ts`, are code files too
 */
const CODE_SOURCE: LanguageSource = {
  kind: CODE_KIND,
  language: 'js/js',
  names: [...CODE_EXTNS, 'astro'].map((extension) => [`*.${extension}`]),
  ignoredNames: [],
  hasFolderIgnores: false,
}

function isCodeBlockEntry(entry: NonNullable<TypedConfig['files']>[number]): boolean {
  return toArray(entry).some((glob) => typeof glob === 'string' && CODE_BLOCK_GLOB.test(glob))
}

/**
 * The rules that `config` turns on, or changes from `original`, that can't run on files it can
 * match: they need type information, or `meta.languages` leaves out the language. Without
 * `language`, a rule without `meta.languages` counts as JavaScript-only, unless it's a non-code
 * rule or of `ANY_LANGUAGE_PLUGINS`. A rule no plugin has counts as JavaScript; a later check
 * rejects it
 */
function getUnrunnableRules(
  config: TypedConfig,
  source: UserConfigSource,
  plugins: ReadonlyMap<string, ESLint.Plugin>,
  languages: ReadonlyArray<LanguageSource>,
  original: TypedConfig | undefined,
): Array<UnrunnableRule> {
  const subjects = [...describeUserConfig(config, source), '`files`']
  let matched: Array<KindLanguage>
  // The guards turn typed rules off in code blocks, so a code-block entry is left out
  let typedMatched: Array<KindLanguage>
  if (config.language === undefined) {
    matched = getMatchedLanguages(subjects, config.files, config.ignores, languages)
    const files = config.files?.filter((entry) => !isCodeBlockEntry(entry))
    typedMatched =
      files?.length === config.files?.length
        ? matched
        : getMatchedLanguages(subjects, files, config.ignores, languages)
  } else {
    matched = [{ kind: getLanguageKind(config.language), language: config.language }]
    typedMatched = []
  }
  const canMatchCode =
    config.language === undefined &&
    getMatchedLanguages(subjects, config.files, config.ignores, [CODE_SOURCE]).length > 0
  if (!canMatchCode && matched.length === 0) {
    return []
  }
  const rules = config.rules ?? {}
  const originalRules = original?.rules ?? {}
  const isSameScope =
    original !== undefined &&
    SCOPE_KEYS.every((key) => isDeepStrictEqual(config[key], original[key]))
  return Object.entries(rules).flatMap(([rule, entry]): Array<UnrunnableRule> => {
    if (
      !isRuleOn(entry) ||
      (isSameScope &&
        (!isChanged(rules, original.rules, rule) || isRuleOn(Reflect.get(originalRules, rule))))
    ) {
      return []
    }
    const isTyped = needsTypeInformation(rule, plugins)
    const nonCodeKind = getNonCodeRuleFiles(rule)?.kind
    const isNonCode = nonCodeKind !== undefined
    const { pluginName, ruleName } = parseRuleId(rule)
    const declared: unknown =
      pluginName === undefined
        ? undefined
        : plugins.get(pluginName)?.rules?.[ruleName]?.meta?.languages
    const isAnyLanguage =
      isNonCode || (pluginName !== undefined && ANY_LANGUAGE_PLUGINS.has(pluginName))
    // ESLint runs a rule without `meta.languages` in any language
    const ruleLanguages =
      declared ?? (isAnyLanguage || config.language !== undefined ? undefined : ['js/js'])
    const failing = new Set(
      [
        ...matched.filter(({ language }) => !canRunIn(ruleLanguages, language, plugins)),
        ...(isTyped ? typedMatched : []),
      ].map(({ kind }) => kind),
    )
    // html-eslint's rules lint HTML in template literals too
    if (
      canMatchCode &&
      ((isNonCode && nonCodeKind !== 'html') || !canRunIn(declared, 'js/js', plugins))
    ) {
      failing.add(CODE_KIND)
    }
    if (failing.size === 0) {
      return []
    }
    const known = NON_CODE_KIND_EXTNS.map(([kind]) => kind)
    const kinds = [
      ...known.filter((kind) => failing.has(kind)),
      ...[...failing].filter((kind) => !known.includes(kind)),
    ]
    return [{ rule, kinds, isTyped, isNonCode }]
  })
}

function failUnrunnable(
  config: TypedConfig,
  source: UserConfigSource,
  { rule, kinds }: UnrunnableRule,
): never {
  const subjects = describeUserConfig(config, source)
  const nonCode = getNonCodeRuleFiles(rule)
  if (config.language !== undefined) {
    fail(
      [...subjects, formatNames([rule])],
      `can't run in the config's language, \`${config.language}\`. Turn it on in a config of its own ${nonCode === undefined ? 'for code files' : `with ${nonCode.files}`} instead`,
    )
  }
  if (nonCode === undefined && kinds.includes(CODE_KIND)) {
    fail(
      [...subjects, ...(config.files === undefined ? [] : ['`files`'])],
      `${config.files === undefined ? 'has no `files`, so it applies to' : 'can match'} ${joinList(kinds, 'and')} files, where ${formatNames([rule])} can't run. Limit it to files in a language the rule supports, and set \`language\``,
    )
  }
  const [target, example] =
    nonCode === undefined
      ? ['code', `\`files: [['src/**', '**/*.{${CODE_EXTNS.join(',')}}']]\``]
      : [`${nonCode.language} files`, nonCode.files]
  if (config.files === undefined) {
    fail(
      subjects,
      `has no \`files\`, so it applies to ${joinList(kinds, 'and')} files, where ${formatNames([rule])} can't run. Give it \`files\` limited to ${target}, as in ${example}`,
    )
  }
  fail(
    [...subjects, '`files`'],
    `can match ${joinList(kinds, 'and')} files, where ${formatNames([rule])} can't run. Limit it to ${target}, as in ${example}`,
  )
}

/**
 * ESLint would throw only on linting such a file, without naming the config
 */
function checkRuleLanguages(
  config: TypedConfig,
  source: UserConfigSource,
  plugins: ReadonlyMap<string, ESLint.Plugin>,
  languages: ReadonlyArray<LanguageSource>,
  original: TypedConfig | undefined,
): void {
  const [first] = getUnrunnableRules(config, source, plugins, languages, original)
  if (first !== undefined) {
    failUnrunnable(config, source, first)
  }
}

/**
 * `scopeUserConfig` limits an added config instead
 */
function checkLoadedUserConfig(
  config: TypedConfig,
  source: UserConfigSource,
  presets: Presets,
  plugins: ReadonlyMap<string, ESLint.Plugin> | undefined,
  original: TypedConfig | undefined,
): void {
  checkPresetPlugins(config, source, presets.plugins)
  if (original === undefined) {
    return
  }
  const allPlugins = new Map([
    ...(plugins ?? presets.plugins),
    ...Object.entries(config.plugins ?? {}),
  ])
  checkRuleLanguages(config, source, allPlugins, presets.languages, original)
}

export type UserConfigContext = {
  codeFiles: ReadonlyArray<string>
  allowFormattingRules: ReadonlyArray<string>
  presets?: Presets | undefined
  /**
   * Every config's plugins, which a change's rules resolve from. The presets' plugins without it
   */
  plugins?: ReadonlyMap<string, ESLint.Plugin> | undefined
  /**
   * `false` with `typeAware: false`. `undefined` skips the check of type-aware rules
   */
  isTypeAware?: boolean | undefined
  /**
   * `undefined` skips the check of rules on only untyped files
   */
  untypedKinds?: UntypedKinds | undefined
  /**
   * What the fix for an absolute glob is relative to
   */
  root?: string | undefined
}

const CONFIG_KEY_SHAPES = [
  ['files', 'array'],
  ['ignores', 'array'],
  ['rules', 'object'],
  ['languageOptions', 'object'],
  ['settings', 'object'],
  ['plugins', 'object'],
  ['linterOptions', 'object'],
] as const

function checkConfigShape(config: TypedConfig, source: UserConfigSource): void {
  if (config.basePath !== undefined && typeof config.basePath !== 'string') {
    fail(
      [...describeUserConfig(config, source), '`basePath`'],
      `expected a string, received ${describeValue(config.basePath)}`,
    )
  }
  for (const [key, shape] of CONFIG_KEY_SHAPES) {
    const value: unknown = config[key]
    if (value === undefined || (shape === 'array' ? Array.isArray(value) : isPlainObject(value))) {
      continue
    }
    fail(
      [...describeUserConfig(config, source), formatNames([key])],
      `expected ${shape === 'array' ? 'an array' : 'an object'}, received ${describeValue(value)}`,
    )
  }
  // ESLint's error gives an index into the whole config array
  if (Array.isArray(config.files) && config.files.length === 0) {
    fail(
      [...describeUserConfig(config, source), '`files`'],
      'lists no globs. List the files the config is for, or leave out `files` for every file',
    )
  }
}

/**
 * A change would replace the project service's options for `typeAware.allowDefaultProject`, so its
 * files would fail to lint
 */
const PROTECTED_PARSER_OPTIONS = [
  [
    'projectService',
    'is set from `root` and `typeAware`, so a config of yours may not change it. List the files to lint with the default project in `typeAware.allowDefaultProject`, or those to lint without type information in `typeAware.ignores`',
  ],
  [
    'tsconfigRootDir',
    'is set from `root`, so a config of yours may not change it. Set `root` to the folder of your `tsconfig.json`',
  ],
] as const

function checkProtectedParserOptions(
  config: TypedConfig,
  source: UserConfigSource,
  original: TypedConfig | undefined,
): void {
  const getOption = (target: TypedConfig | undefined, key: string): unknown => {
    const parserOptions: unknown = target?.languageOptions?.['parserOptions']
    return isPlainObject(parserOptions) && Object.hasOwn(parserOptions, key)
      ? parserOptions[key]
      : undefined
  }
  for (const [key, description] of PROTECTED_PARSER_OPTIONS) {
    const value = getOption(config, key)
    const originalValue = getOption(original, key)
    if (
      (value !== undefined || originalValue !== undefined) &&
      !isDeepStrictEqual(value, originalValue)
    ) {
      fail(
        [...describeUserConfig(config, source), `\`languageOptions.parserOptions.${key}\``],
        description,
      )
    }
  }
}

function isGlobalIgnores(config: TypedConfig): boolean {
  return (
    config.ignores !== undefined && Object.keys(config).every((key) => GLOBAL_IGNORES_KEYS.has(key))
  )
}

/**
 * Another key would make ESLint read `ignores` as the config's own exclusions, so its files would
 * be linted
 */
function checkGlobalIgnoresChange(
  config: TypedConfig,
  source: UserConfigSource,
  original: TypedConfig,
): void {
  if (!isGlobalIgnores(original)) {
    return
  }
  const keys = Object.keys(config).filter((key) => !GLOBAL_IGNORES_KEYS.has(key))
  if (keys.length > 0) {
    fail(
      describeUserConfig(config, source),
      `changes a global ignores config, which may set only \`ignores\`, \`name\` and \`basePath\`, but this sets ${formatNames(keys, { conjunction: 'and' })}, so ESLint would stop ignoring its files everywhere. Put the other keys in a config of their own`,
    )
  }
}

/**
 * Rules that need type information would be off with `typeAware: false`
 */
function checkTypeAwareRules(
  config: TypedConfig,
  source: UserConfigSource,
  plugins: ReadonlyMap<string, ESLint.Plugin>,
  original: TypedConfig | undefined,
): void {
  const originalRules = original === undefined ? undefined : (original.rules ?? {})
  const entries = Object.entries(config.rules ?? {})
  for (const [rule, entry] of entries) {
    if (
      isRuleOn(entry) &&
      (originalRules === undefined || !isRuleOn(Reflect.get(originalRules, rule))) &&
      needsTypeInformation(rule, plugins)
    ) {
      fail(
        [...describeUserConfig(config, source), formatNames([rule])],
        'is a rule that needs type information, and `typeAware: false` lints without it, so it would be off. Remove one of them',
      )
    }
  }
}

/**
 * Besides Markdown code blocks and Astro `<script>` blocks, which never get type information
 */
export type UntypedKinds = {
  root: string
  isJavascriptTyped: boolean
  /**
   * The `allowDefaultProject` globs that can match a JavaScript file
   */
  typedJavascriptGlobs: ReadonlyArray<string>
  isAstroUntyped: boolean
  ignores: ReadonlyArray<string>
}

type UntypedKind = 'codeBlock' | 'scriptBlock' | 'ignores' | 'javascript' | 'astro'

/**
 * As `**\/*.md/**` matches only Markdown code blocks
 */
function matchesOnlyVirtualFiles(
  subjects: ReadonlyArray<string>,
  glob: string,
  extensions: ReadonlyArray<string>,
): boolean {
  return expandBraces(glob, { prefix: PREFIX, subjects }).every((expanded) =>
    expanded
      .split('/')
      .slice(0, -1)
      .some(
        (segment) =>
          canMatchFile(subjects, segment, extensions) &&
          !canMatchOtherFile(subjects, segment, extensions),
      ),
  )
}

/**
 * With a `!` glob in `ignores`, only a literal path counts, to stay conservative
 */
function isInIgnores(glob: string, ignores: ReadonlyArray<string>): boolean {
  if (ignores.length === 0) {
    return false
  }
  if (isLiteralGlob(glob)) {
    return createListMatcher(ignores)(unescapeGlob(glob))
  }
  const { positive, negated } = splitGlobs(ignores)
  return (
    negated.length === 0 &&
    positive.some((ignore) => {
      if (ignore === glob) {
        return true
      }
      const folder = ignore.endsWith('/**') ? ignore.slice(0, -3) : undefined
      return folder !== undefined && isLiteralGlob(folder) && glob.startsWith(`${folder}/`)
    })
  )
}

function canMatchTypedJavascript(
  subjects: ReadonlyArray<string>,
  glob: string,
  typedJavascriptGlobs: ReadonlyArray<string>,
): boolean {
  return typedJavascriptGlobs.some((typed) =>
    isLiteralGlob(typed)
      ? createGlobMatcher(glob)(unescapeGlob(typed))
      : JAVASCRIPT_EXTNS.some(
          (extension) =>
            canMatchFile(subjects, glob, [extension]) && canMatchFile(subjects, typed, [extension]),
        ),
  )
}

/**
 * `undefined` when a positive `files` glob can match a file with type information
 */
function getUntypedKind(
  subjects: ReadonlyArray<string>,
  glob: string,
  kinds: UntypedKinds,
): UntypedKind | undefined {
  if (matchesOnlyVirtualFiles(subjects, glob, MARKDOWN_EXTNS)) {
    return 'codeBlock'
  }
  if (matchesOnlyVirtualFiles(subjects, glob, ['astro'])) {
    return 'scriptBlock'
  }
  if (isInIgnores(glob, kinds.ignores)) {
    return 'ignores'
  }
  if (
    !kinds.isJavascriptTyped &&
    !canMatchOtherFile(subjects, glob, UNTYPED_CODE_EXTNS) &&
    !canMatchTypedJavascript(subjects, glob, kinds.typedJavascriptGlobs)
  ) {
    return 'javascript'
  }
  if (kinds.isAstroUntyped && !canMatchOtherFile(subjects, glob, ['astro'])) {
    return 'astro'
  }
  return undefined
}

const UNTYPED_KIND_FIXES: Readonly<Record<UntypedKind, string | undefined>> = {
  codeBlock: undefined,
  scriptBlock: undefined,
  ignores: 'take the files out of `typeAware.ignores`',
  javascript: 'set `typeAware: { javascript: true }`',
  astro: 'add a tsconfig.json for the `.astro` files',
}

/**
 * A rule on only untyped files, where it would be off
 */
function checkUntypedOnlyRules(
  config: TypedConfig,
  source: UserConfigSource,
  plugins: ReadonlyMap<string, ESLint.Plugin>,
  original: TypedConfig | undefined,
  kinds: UntypedKinds,
): void {
  if (config.files === undefined || config.files.length === 0 || config.language !== undefined) {
    return
  }
  const subjects = [...describeUserConfig(config, source), '`files`']
  const basePath =
    typeof config.basePath === 'string' ? path.resolve(kinds.root, config.basePath) : kinds.root
  // A glob relative to another `basePath` is classified as the `root`-relative globs it stands for
  const kindOf = (rawGlob: string): UntypedKind | undefined => {
    const glob = withoutLeadingDotSlash(rawGlob)
    const rebased = basePath === kinds.root ? [glob] : rebaseGlob(glob, basePath, kinds.root)
    const rebasedKinds = rebased.map((item) => getUntypedKind(subjects, item, kinds))
    return rebasedKinds.every((kind) => kind !== undefined) ? rebasedKinds[0] : undefined
  }
  const found: Array<{ glob: string; kind: UntypedKind }> = []
  for (const entry of config.files) {
    const match = toArray(entry)
      .filter((glob): glob is string => typeof glob === 'string' && !glob.startsWith('!'))
      .map((glob) => ({ glob, kind: kindOf(glob) }))
      .find((item) => item.kind !== undefined)
    if (match?.kind === undefined) {
      return
    }
    found.push({ glob: match.glob, kind: match.kind })
  }
  const originalRules =
    original === undefined || !isDeepStrictEqual(config.files, original.files)
      ? undefined
      : (original.rules ?? {})
  const rule = Object.entries(config.rules ?? {}).find(
    ([name, entry]) =>
      isRuleOn(entry) &&
      (originalRules === undefined || !isRuleOn(Reflect.get(originalRules, name))) &&
      needsTypeInformation(name, plugins),
  )?.[0]
  if (rule === undefined) {
    return
  }
  const kindsFound = new Set(found.map(({ kind }) => kind))
  const fixes = [
    ...new Set(
      [...kindsFound].flatMap((kind) => {
        return UNTYPED_KIND_FIXES[kind] ?? []
      }),
    ),
    'remove the rule',
  ]
  const fix = joinList(fixes, 'or')
  const blocks =
    kindsFound.has('codeBlock') || kindsFound.has('scriptBlock')
      ? `, as ${kindsFound.has('codeBlock') ? 'code blocks' : 'Astro `<script>` blocks'}${kindsFound.has('codeBlock') && kindsFound.has('scriptBlock') ? ' and Astro `<script>` blocks' : ''} never get type information`
      : ''
  fail(
    [...describeUserConfig(config, source), formatNames([rule])],
    `needs type information, which ${formatNames([...new Set(found.map(({ glob }) => glob))], {
      conjunction: 'and',
    })} files don't get${blocks}. ${fix.charAt(0).toUpperCase()}${fix.slice(1)}`,
  )
}

function getStringGlobs(globs: TypedConfig['files'] | TypedConfig['ignores']): Array<string> {
  return (globs ?? []).flatMap((entry: unknown) =>
    toArray(entry).filter((glob: unknown) => typeof glob === 'string'),
  )
}

/**
 * A glob `original` has too passes, so a change isn't rejected for globs it didn't add
 */
function checkConfigGlobs(
  config: TypedConfig,
  source: UserConfigSource,
  original: TypedConfig | undefined,
  root: string | undefined,
): void {
  for (const key of ['files', 'ignores'] as const) {
    const kept = new Set(getStringGlobs(original?.[key]))
    checkRelativeGlobsAt(
      [...describeUserConfig(config, source), formatNames([key])],
      getStringGlobs(config[key]).filter((glob) => !kept.has(glob)),
      root,
    )
  }
}

type CheckUserConfigOptions = {
  isUnscoped?: boolean | undefined
  /**
   * The config the change applies to. What the change keeps passes
   */
  original?: TypedConfig | undefined
}

/**
 * Rule entries have a severity, alone or first in a non-empty array. A composer removal also allows
 * null
 */
export function checkRuleEntries(
  rules: object,
  subjects: ReadonlyArray<string>,
  allowsRemoval = false,
): void {
  for (const [rule, entry] of Object.entries(rules)) {
    if (entry === undefined || (allowsRemoval && entry === null)) {
      continue
    }
    const severity: unknown = Array.isArray(entry) ? entry[0] : entry
    if (
      severity !== 'off' &&
      severity !== 'warn' &&
      severity !== 'error' &&
      severity !== 0 &&
      severity !== 1 &&
      severity !== 2
    ) {
      fail(
        [...subjects, formatNames([rule])],
        `expected a severity ('off', 'warn', 'error', 0, 1 or 2) or a non-empty array starting with one, received ${describeValue(entry)}`,
      )
    }
  }
}

/**
 * Throws on what no config of yours may hold, through any composer method or callback.
 * {@link checkLoadedUserConfig} runs once the presets are in the context
 */
export function checkUserConfig(
  config: TypedConfig,
  source: UserConfigSource,
  {
    allowFormattingRules,
    presets,
    plugins,
    isTypeAware,
    untypedKinds,
    root,
  }: Omit<UserConfigContext, 'codeFiles'>,
  { isUnscoped = false, original }: CheckUserConfigOptions = {},
): void {
  checkConfigShape(config, source)
  if (original !== undefined) {
    checkGlobalIgnoresChange(config, source, original)
  }
  checkProtectedParserOptions(config, source, original)
  checkConfigGlobs(config, source, original, root)
  checkRuleEntries(config.rules ?? {}, describeUserConfig(config, source))
  checkMarkdownParseOptions(config, source, original)
  // Before the rules' languages, which give less specific errors
  if (original !== undefined) {
    checkCodeOnlyScope(config, source, original)
  }
  const rules = config.rules ?? {}
  const originalRules = original === undefined ? undefined : (original.rules ?? {})
  if (isUnscoped) {
    // Off rules apply everywhere, unless `languageOptions` or `processor` keeps them with the JS ones
    const hasOffPart = config.languageOptions === undefined && config.processor === undefined
    checkNonCodeRules(
      config,
      source,
      Object.entries(rules)
        .filter(([, entry]) => !hasOffPart || isRuleOn(entry))
        .map(([rule]) => rule),
      ", which a config of yours without `files` or `language` doesn't reach",
      (files) => `Give it ${files}`,
    )
  } else if (originalRules !== undefined && isCodeOnly(config, source)) {
    checkNonCodeRules(
      config,
      source,
      Object.entries(rules)
        .filter(([rule, entry]) => isRuleOn(entry) && !isRuleOn(Reflect.get(originalRules, rule)))
        .map(([rule]) => rule),
      ', and the config it changes applies to code files only',
      (files) => `Add it in a config of its own with ${files}`,
    )
  }
  if (presets !== undefined) {
    checkLoadedUserConfig(config, source, presets, plugins, original)
    const rulePlugins = new Map([
      ...(plugins ?? presets.plugins),
      ...Object.entries(config.plugins ?? {}),
    ])
    if (isTypeAware === false) {
      checkTypeAwareRules(config, source, rulePlugins, original)
    } else if (untypedKinds !== undefined) {
      checkUntypedOnlyRules(config, source, rulePlugins, original, untypedKinds)
    }
  }
  checkFormattingRules(
    describeUserConfig(config, source),
    Object.fromEntries(
      Object.entries(rules).filter(([rule]) => isChanged(rules, originalRules, rule)),
    ),
    allowFormattingRules,
    EXTENDED_CONFIGS.has(config) || config.plugins !== undefined
      ? " A plugin's preset that the config is or extends may turn on such rules: wrap it in `withoutFormattingRules`."
      : " To use a plugin's preset that turns on such rules, wrap it in `withoutFormattingRules`.",
  )
}

type Copier = (value: unknown) => unknown

function keep(value: unknown): unknown {
  return value
}

function copyEntries(record: object, copiers: ReadonlyMap<string, Copier>): object {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, (copiers.get(key) ?? clonePlain)(value)]),
  )
}

function copyPlainEntries(copiers: ReadonlyMap<string, Copier>): Copier {
  return (value) => (isPlainObject(value) ? copyEntries(value, copiers) : value)
}

function copyExtends(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => copyExtends(item))
  }
  return isPlainObject(value) ? cloneConfig(value) : value
}

/**
 * Keys holding objects that ESLint compares by identity
 */
const CONFIG_COPIERS: ReadonlyMap<string, Copier> = new Map([
  ['plugins', (plugins) => (isPlainObject(plugins) ? { ...plugins } : plugins)],
  ['extends', copyExtends],
  ['processor', keep],
  ['language', keep],
  [
    'languageOptions',
    copyPlainEntries(
      new Map([
        ['parser', keep],
        ['parserOptions', copyPlainEntries(new Map([['parser', keep]]))],
      ]),
    ),
  ],
])

/**
 * A deep copy, so a change in place reaches no other config, constant or frozen preset. Plugins,
 * parsers, processors, languages, functions and class instances stay the same objects
 */
export function cloneConfig(config: TypedConfig): TypedConfig {
  const copy: TypedConfig = copyEntries(config, CONFIG_COPIERS)
  keepSplitPart(config, copy)
  return copy
}

/**
 * Anything but a config, such as a promise, stays as it is for the checks or the composer
 */
export function copyUserConfigs<T>(items: ReadonlyArray<T>): Array<T> {
  return items.map((item) => copyUserConfigItem(item))
}

export function copyUserConfigItem<T>(item: T): T {
  if (Array.isArray(item)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The same array shape, copied
    return copyUserConfigs(item as Array<unknown>) as T
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- A config, copied
  return isPlainObject(item) ? (cloneConfig(item) as T) : item
}

/**
 * Flattened and checked. `scopeUserConfig` splits them once the presets are loaded
 *
 * @throws TypeError on an item that isn't a config, or a rule the checks reject
 */
export function normalizeUserConfigs(
  configs: ReadonlyArray<unknown>,
  source: AddedConfigSource,
  context: UserConfigContext,
): Array<TypedConfig> {
  return flattenUserConfigs(configs, source).map((config) =>
    normalizeUserConfig(config, source, context),
  )
}

function isUnscoped(config: TypedConfig): boolean {
  return (
    config.files === undefined &&
    config.language === undefined &&
    Object.keys(config.rules ?? {}).length > 0 &&
    !isAllOff(config)
  )
}

/**
 * Also for a config that an `onResolved` callback adds
 *
 * @throws TypeError on a rule the checks reject
 */
export function normalizeUserConfig(
  config: TypedConfig,
  source: UserConfigSource,
  context: UserConfigContext,
): TypedConfig {
  checkUserConfig(config, source, context, { isUnscoped: isUnscoped(config) })
  return config
}

/**
 * Splits a change of a split config of yours as `scopeUserConfig` splits `configs`. The change can
 * set any scope, since the parts keep only the files where their rules can run
 *
 * @throws TypeError on a change that the checks reject
 */
export function rescopeUserConfig(
  config: TypedConfig,
  source: UserConfigSource,
  original: TypedConfig,
  context: Pick<UserConfigContext, 'allowFormattingRules' | 'root'> & ScopeContext,
): Array<TypedConfig> {
  checkUserConfig(
    config,
    source,
    { allowFormattingRules: context.allowFormattingRules, root: context.root },
    { original, isUnscoped: isUnscoped(config) },
  )
  return scopeUserConfig(config, source, context)
}

/**
 * A negated glob doesn't narrow an entry
 */
function canMatchOtherThan(
  subjects: ReadonlyArray<string>,
  files: NonNullable<TypedConfig['files']>,
  extensions: ReadonlyArray<string>,
): boolean {
  return files.some((entry) =>
    toArray(entry).every(
      (glob) =>
        typeof glob !== 'string' ||
        glob.startsWith('!') ||
        canMatchOtherFile(subjects, glob, extensions),
    ),
  )
}

const CODE_GLOB_EXTNS = [...CODE_EXTNS, 'astro']

/**
 * As in `[['src/**', '**\/*.astro']]` for `['src/**']`, without entries that can't match code
 */
function intersectCodeFiles(
  subjects: ReadonlyArray<string>,
  files: NonNullable<TypedConfig['files']>,
  codeFiles: ReadonlyArray<string>,
): NonNullable<TypedConfig['files']> {
  return codeFiles.flatMap((codeGlob) => {
    const extensions = CODE_GLOB_EXTNS.filter((extension) =>
      canMatchFile(subjects, codeGlob, [extension]),
    )
    return files.flatMap((entry) => {
      const globs = toArray(entry)
      const canMatchCode = globs.every(
        (glob) =>
          typeof glob !== 'string' ||
          glob.startsWith('!') ||
          canMatchFile(subjects, glob, extensions),
      )
      return canMatchCode ? [[...globs, codeGlob]] : []
    })
  })
}

/**
 * The `plugins` part holds no rules, only the config's plugins for every file
 */
type PartRole = 'plugins' | 'off' | 'kept' | 'javascript' | 'typed'

/**
 * For a later `.override()` and `getSplitConfig`
 */
type Split = {
  classify: (
    rule: string,
    entry: unknown,
    plugins: ReadonlyMap<string, ESLint.Plugin>,
    languages: ReadonlyArray<LanguageSource>,
  ) => PartRole
  scope: Pick<TypedConfig, (typeof SCOPE_KEYS)[number]>
}

/**
 * Kept by `cloneConfig` and by a change that keeps a part's scope
 */
const SPLIT_PARTS = new WeakMap<TypedConfig, { role: PartRole; split: Split }>()

export function isPluginsPart(config: TypedConfig): boolean {
  return SPLIT_PARTS.get(config)?.role === 'plugins'
}

export function keepSplitPart(config: TypedConfig, changed: TypedConfig): void {
  const part = SPLIT_PARTS.get(config)
  if (
    part !== undefined &&
    SCOPE_KEYS.every((key) => isDeepStrictEqual(config[key], changed[key]))
  ) {
    SPLIT_PARTS.set(changed, part)
  }
}

/**
 * Routes each rule of a `.override()` without scope keys to the part the split gives it, removing
 * it from the others, so the parts match a re-split. A rule whose part doesn't exist goes to every
 * part. `undefined` for a config that isn't a split part
 */
export function routeSplitRules(
  config: TypedConfig,
  configs: ReadonlyArray<TypedConfig>,
  rules: object,
  { plugins, languages }: Pick<ScopeContext, 'plugins'> & Pick<Presets, 'languages'>,
): { rules: Record<string, unknown>; removed: Array<string> } | undefined {
  const part = SPLIT_PARTS.get(config)
  if (part === undefined) {
    return undefined
  }
  if (part.role === 'plugins') {
    return { rules: {}, removed: [] }
  }
  const roles = new Set(
    configs.flatMap((found) => {
      const sibling = SPLIT_PARTS.get(found)
      return sibling?.split === part.split ? sibling.role : []
    }),
  )
  const routed: Record<string, unknown> = {}
  const removed: Array<string> = []
  for (const [rule, entry] of Object.entries(rules)) {
    const role: PartRole =
      entry === undefined ? part.role : part.split.classify(rule, entry, plugins, languages)
    if (role === part.role || !roles.has(role)) {
      routed[rule] = entry
    } else if (Object.hasOwn(config.rules ?? {}, rule)) {
      removed.push(rule)
    }
  }
  return { rules: routed, removed }
}

function getScope(config: TypedConfig): Split['scope'] {
  return Object.fromEntries(
    SCOPE_KEYS.flatMap((key) => (Object.hasOwn(config, key) ? [[key, config[key]]] : [])),
  )
}

function markPart(config: TypedConfig, part: TypedConfig, split: Split, role: PartRole): void {
  SPLIT_PARTS.set(part, { role, split })
  copyItemMarks(config, part)
}

function copyItemMarks(config: TypedConfig, copy: TypedConfig): void {
  const indices = ITEM_INDICES.get(config)
  if (indices !== undefined) {
    ITEM_INDICES.set(copy, indices)
  }
  if (EXTENDED_CONFIGS.has(config)) {
    EXTENDED_CONFIGS.add(copy)
  }
}

/**
 * Keeps the config's other keys, so its rules see the config's plugins. None for no rules
 */
function toPart(
  config: TypedConfig,
  split: Split,
  role: PartRole,
  rules: ReadonlyArray<[string, unknown]>,
  scope: Pick<TypedConfig, 'files' | 'ignores'> = {},
): Array<TypedConfig> {
  if (rules.length === 0) {
    return []
  }
  const part: TypedConfig = { ...config, ...scope, rules: Object.fromEntries(rules) }
  markPart(config, part, split, role)
  return [part]
}

/**
 * Registers the plugins for every file first, so a directive comment that names a plugin's rule
 * finds it in a file no part's rules reach
 */
function withPluginsPart(
  config: TypedConfig,
  split: Split,
  parts: Array<TypedConfig>,
): Array<TypedConfig> {
  if (!isPlainObject(config.plugins) || Object.keys(config.plugins).length === 0) {
    return parts
  }
  const part: TypedConfig = {
    ...(config.name !== undefined && { name: config.name }),
    plugins: config.plugins,
  }
  markPart(config, part, split, 'plugins')
  return [part, ...parts]
}

/**
 * `undefined` for a config that isn't a split part
 */
export function getSplitConfig(
  config: TypedConfig,
  configs: ReadonlyArray<TypedConfig>,
): { parts: Array<TypedConfig>; config: TypedConfig } | undefined {
  const split = SPLIT_PARTS.get(config)?.split
  if (split === undefined) {
    return undefined
  }
  const parts = configs.filter((found) => SPLIT_PARTS.get(found)?.split === split)
  const base = parts.find((part) => SPLIT_PARTS.get(part)?.role !== 'plugins') ?? config
  const unsplit: TypedConfig = { ...base }
  for (const key of SCOPE_KEYS) {
    Reflect.deleteProperty(unsplit, key)
  }
  const rules = Object.fromEntries(parts.flatMap((part) => Object.entries(part.rules ?? {})))
  Object.assign(unsplit, split.scope, { rules })
  copyItemMarks(base, unsplit)
  return { parts, config: unsplit }
}

export type ScopeContext = {
  presets: Presets
  plugins: ReadonlyMap<string, ESLint.Plugin>
  codeFiles: ReadonlyArray<string>
  isTypeAware?: boolean | undefined
  untypedKinds?: UntypedKinds | undefined
}

function splitUnscoped(
  config: TypedConfig,
  { plugins, codeFiles }: ScopeContext,
  ignores: Array<string>,
): Array<TypedConfig> {
  const hasOffPart = config.languageOptions === undefined && config.processor === undefined
  const split: Split = {
    classify: (rule, entry, rulePlugins) => {
      if (!isRuleOn(entry)) {
        return hasOffPart ? 'off' : 'javascript'
      }
      return needsTypeInformation(rule, rulePlugins) ? 'typed' : 'javascript'
    },
    scope: getScope(config),
  }
  const entries = Object.entries(config.rules ?? {})
  const ofRole = (role: PartRole) =>
    entries.filter(([rule, entry]) => split.classify(rule, entry, plugins, []) === role)
  return withPluginsPart(config, split, [
    ...toPart(config, split, 'off', ofRole('off')),
    ...toPart(config, split, 'javascript', ofRole('javascript'), { ignores }),
    // The code globs match code blocks' virtual files, where the guards turn these rules off
    ...toPart(config, split, 'typed', ofRole('typed'), { files: [...codeFiles] }),
  ])
}

function splitScoped(
  config: TypedConfig,
  files: NonNullable<TypedConfig['files']>,
  source: UserConfigSource,
  { presets, plugins, codeFiles }: ScopeContext,
  ignores: Array<string>,
): Array<TypedConfig> {
  const unrunnable = getUnrunnableRules(config, source, plugins, presets.languages, undefined)
  if (unrunnable.length === 0) {
    return [config]
  }
  const subjects = [...describeUserConfig(config, source), '`files`']
  // Moving these rules would leave them doing nothing
  const failing =
    unrunnable.find(({ isNonCode, kinds }) => isNonCode || kinds.includes(CODE_KIND)) ??
    (canMatchOtherThan(subjects, files, NON_CODE_EXTNS) ? undefined : unrunnable[0])
  if (failing !== undefined) {
    failUnrunnable(config, source, failing)
  }
  const typedFiles = intersectCodeFiles(subjects, files, codeFiles)
  const firstTyped = unrunnable.find(({ isTyped }) => isTyped)
  if (firstTyped !== undefined && typedFiles.length === 0) {
    failUnrunnable(config, source, firstTyped)
  }
  const moved = new Map(unrunnable.map((found) => [found.rule, found]))
  // A rule for the other files stays, for the checks to reject
  const split: Split = {
    classify: (rule, entry, rulePlugins, languages) => {
      const [found] = getUnrunnableRules(
        { ...config, rules: { [rule]: entry } },
        source,
        rulePlugins,
        languages,
        undefined,
      )
      if (found === undefined || found.isNonCode) {
        return 'kept'
      }
      return found.isTyped ? 'typed' : 'javascript'
    },
    scope: getScope(config),
  }
  const entries = Object.entries(config.rules ?? {})
  return withPluginsPart(config, split, [
    ...toPart(
      config,
      split,
      'kept',
      entries.filter(([rule]) => !moved.has(rule)),
    ),
    ...toPart(
      config,
      split,
      'javascript',
      entries.filter(([rule]) => moved.get(rule)?.isTyped === false),
      { ignores },
    ),
    ...toPart(
      config,
      split,
      'typed',
      entries.filter(([rule]) => moved.get(rule)?.isTyped === true),
      { files: typedFiles },
    ),
  ])
}

/**
 * Splits a config of yours so each rule reaches only files where it can run. A config with
 * `language`, or with only off rules and no `languageOptions` or `processor`, stays as it is.
 *
 * - Without `files`: off rules apply to every file. JavaScript rules skip non-code files and files
 *   your configs give another language. Type-aware rules get the code files.
 * - With `files`: rules that can't run on every file it can match move to a part that skips those
 *   files, and typed rules to a part ANDed with the code files.
 *
 * @throws TypeError on a part the checks reject
 */
export function scopeUserConfig(
  config: TypedConfig,
  source: UserConfigSource,
  context: ScopeContext,
): Array<TypedConfig> {
  checkPresetPlugins(config, source, context.presets.plugins)
  if (context.isTypeAware === false) {
    checkTypeAwareRules(config, source, context.plugins, undefined)
  } else if (context.untypedKinds !== undefined) {
    checkUntypedOnlyRules(config, source, context.plugins, undefined, context.untypedKinds)
  }
  const ignores = [
    ...(config.ignores ?? []),
    NON_CODE_FILES,
    ...getLanguageIgnores(context.presets.languages),
  ]
  const { files } = config
  let parts = [config]
  if (isUnscoped(config)) {
    parts = splitUnscoped(config, context, ignores)
  } else if (files !== undefined && config.language === undefined) {
    parts = splitScoped(config, files, source, context, ignores)
  }
  // Rejects a rule that `language` can't run, a rule that can't run in code files in a config
  // without `files`, and a typed rule for files another config of yours gives a language. Any other
  // rejected part is a bug in the split
  for (const part of parts) {
    checkRuleLanguages(part, source, context.plugins, context.presets.languages, undefined)
  }
  return parts
}
