import fs from 'node:fs'
import path from 'node:path'

import type { ESLint, Linter } from 'eslint'
import * as z from 'zod/mini'

import {
  booleanOr,
  deferred,
  optionsObject,
  required,
  resolveSubOptions,
  type OptionsShape,
} from '@gpahal/internal/node/options'
import { PATH_OR_FILE_URL_EXPECTED } from '@gpahal/internal/node/paths'
import { checkRoot } from '@gpahal/internal/node/root'
import {
  assertValid,
  expectedError,
  plainObject,
  strictObject,
  typeCheck,
} from '@gpahal/internal/node/zod'
import { toArray } from '@gpahal/std/arrays'
import { describeValue, formatNames } from '@gpahal/std/errors'
import { isRecord } from '@gpahal/std/objects'
import { trimEnd } from '@gpahal/std/strings'

import { AREAS, getEnabledAreas, mapAreas, type AreaDefinition } from '@/internal/areas'
import { GLOB_LIST } from '@/internal/checks'
import { E18E_RULE_SET_DEFAULTS } from '@/internal/configs/constants'
import { getCoreRule } from '@/internal/core-rules'
import { CODE_EXTNS } from '@/internal/files'
import { checkFormattingRules, FORMATTING_RULES, KEPT_RULES } from '@/internal/formatting'
import { findUp } from '@/internal/fs'
import { canMatchFile } from '@/internal/glob-match'
import { hasGlobMagic } from '@/internal/globs'
import { AREA_RULE_PREFIXES, hasRulePrefix, PLUGIN_AREAS, type AreaName } from '@/internal/names'
import { resolveEntryPoint } from '@/internal/presets/tailwindcss'
import { checkRelativeGlobs } from '@/internal/relative-globs'
import { getPlugins, isRuleOn, parseRuleId } from '@/internal/rules'
import type {
  CommonjsOptions,
  ConfigsElement,
  EslintConfigOptions,
  TailwindcssOptions,
  TypeAwareOptions,
  TypedConfig,
  WarningsOptions,
} from '@/internal/types'
import { describeUserConfig } from '@/internal/user-configs'
import { fail, PREFIX, WARNING_CODES } from '@/internal/utils'

export { checkRelativeGlobs } from '@/internal/relative-globs'

/**
 * Only an object for an area that can't be turned off
 */
function areaCheck({
  keys,
  isObjectOnly,
  isFalseAllowed,
  expected,
  hint,
}: AreaDefinition): z.ZodMiniType {
  const shape = { rules: deferred(plainObject()), ...keys } as OptionsShape<Record<string, unknown>>
  const object = optionsObject<Record<string, unknown>>(shape, { expected, hint })
  if (isObjectOnly !== true) {
    return booleanOr(object, { expected, hint })
  }
  return isFalseAllowed === true
    ? z.union([z.literal(false), object], {
        error: expectedError(expected ?? 'an object or `false`', hint),
      })
    : object
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `AREAS` checks each area's keys against its option type, and `areaCheck` adds `rules` and the boolean its definition allows
const AREA_CHECKS = mapAreas(areaCheck) as {
  [A in AreaName]: OptionsShape<EslintConfigOptions>[A]
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0
}

const OPTION_CHECKS = {
  root: required(
    typeCheck<string>((value) => typeof value === 'string' && path.isAbsolute(value), {
      expected: 'an absolute path, such as `import.meta.dirname`',
    }),
  ),
  isInEditor: z.boolean(),
  gitignore: booleanOr(
    optionsObject<{ files?: ReadonlyArray<string> | undefined }>({ files: z.array(z.string()) }),
  ),
  ignores: GLOB_LIST,
  testFiles: GLOB_LIST,
  commonjs: booleanOr(optionsObject<CommonjsOptions>({ files: GLOB_LIST })),
  typeAware: booleanOr(
    optionsObject<TypeAwareOptions>({
      javascript: z.boolean(),
      allowDefaultProject: GLOB_LIST,
      ignores: GLOB_LIST,
    }),
  ),
  ...AREA_CHECKS,
  allowFormattingRules: z.array(z.string()),
  configs: z.array(deferred<ConfigsElement>()),
  warnings: strictObject(
    Object.fromEntries(WARNING_CODES.map((code) => [code, z.optional(z.boolean())])),
    { noun: 'warning code' },
  ) as z.ZodMiniType<WarningsOptions, WarningsOptions>,
} satisfies OptionsShape<EslintConfigOptions>

const OPTIONS_SCHEMA = optionsObject<EslintConfigOptions>(OPTION_CHECKS, {
  expected: 'an object of options',
})

type AreaRulesEntry = {
  area: string
  name: string
  rules: object
  prefixes: ReadonlyArray<string>
}

function getAreaRules(options: EslintConfigOptions): Array<AreaRulesEntry> {
  return Object.entries(AREAS).flatMap(([area, { prefixes }]) => {
    const value: unknown = Reflect.get(options, area)
    if (!isRecord(value)) {
      return []
    }
    const { rules, rulesTypeAware } = value
    return (
      [
        ['rules', rules],
        ['rulesTypeAware', rulesTypeAware],
      ] as const
    ).flatMap(([key, keyRules]) =>
      isRecord(keyRules) ? { area, name: `${area}.${key}`, rules: keyRules, prefixes } : [],
    )
  })
}

/**
 * Throws on an `allowFormattingRules` entry that eslint-config-prettier doesn't turn off, or a
 * formatting rule in an area's `rules` that it doesn't list. `normalizeUserConfigs` checks `configs`
 */
function checkAreaFormattingRules(options: EslintConfigOptions): void {
  const allowed = options.allowFormattingRules ?? []
  for (const rule of allowed) {
    if (!FORMATTING_RULES.has(rule)) {
      fail(
        ['`allowFormattingRules`', formatNames([rule])],
        KEPT_RULES.has(rule)
          ? 'stays on already; this package keeps it on'
          : "eslint-config-prettier doesn't turn this rule off",
      )
    }
  }
  for (const { name, rules } of getAreaRules(options)) {
    checkFormattingRules([formatNames([name])], rules, allowed)
  }
}

function describePrefixes(prefixes: ReadonlyArray<string>): string {
  const names = prefixes.filter((prefix) => prefix !== '')
  if (!prefixes.includes('')) {
    return formatNames(names, { conjunction: 'and' })
  }
  return names.length === 0 ? 'core rules' : `${formatNames(names)} and core rules`
}

/**
 * The `rules` of the first area that takes the rule, or `configs`
 */
function suggestRulesOption(rule: string): string {
  const area = Object.entries(AREA_RULE_PREFIXES).find(([, prefixes]) =>
    hasRulePrefix(rule, prefixes),
  )?.[0]
  return area === undefined ? 'configs' : `${area}.rules`
}

/**
 * Such a rule is likely meant for another area or `configs`
 */
function checkRulePrefixes(options: EslintConfigOptions): void {
  for (const { area, name, rules, prefixes } of getAreaRules(options)) {
    const rule = Object.keys(rules).find((ruleName) => !hasRulePrefix(ruleName, prefixes))
    if (rule !== undefined) {
      fail(
        [formatNames([name]), formatNames([rule])],
        `isn't a rule of the \`${area}\` area, which takes ${describePrefixes(prefixes)}. Put it in \`${suggestRulesOption(rule)}\``,
      )
    }
  }
}

/**
 * The options that leave out a plugin of an area that's on, as `antislop.slop: false`, by plugin
 * name. sonarjs is left out only when `sonarjs: false` and `antislop` doesn't register it
 */
export type PluginOffOptions = ReadonlyMap<string, PluginOffReason>

type PluginOffReason = ReadonlyArray<string> | { area: string } | { hint: string }

export function getPluginOffOptions(
  options: EslintConfigOptions,
  isJavascriptOnly = false,
): PluginOffOptions {
  const offOptions = new Map<string, ReadonlyArray<string>>()
  const antislopOptions = resolveSubOptions(options.antislop)
  if (antislopOptions?.slop === false) {
    offOptions.set('slop', ['antislop.slop: false'])
  }
  if (options.sonarjs === false) {
    offOptions.set(
      'sonarjs',
      antislopOptions?.sonarjs === false
        ? ['sonarjs: false', 'antislop.sonarjs: false']
        : ['sonarjs: false'],
    )
  }
  if (resolveSubOptions(options.react)?.refresh === false) {
    offOptions.set('react-refresh', ['react.refresh: false'])
  }
  const reasons = new Map<string, PluginOffReason>(offOptions)
  if (isJavascriptOnly) {
    reasons.set('@typescript-eslint', {
      hint: '. A JavaScript-only project is linted without typescript-eslint. Name the rule in `configs` or `typescript.rules`, which keep it',
    })
  }
  const isOn: Readonly<Record<string, boolean>> = getEnabledAreas(options)
  for (const [plugin, area] of PLUGIN_AREAS) {
    if (isOn[area] === false && !reasons.has(plugin)) {
      reasons.set(plugin, { area })
    }
  }
  return reasons
}

function describePluginOffReason(reason: PluginOffReason | undefined): string {
  if (reason === undefined) {
    return ''
  }
  if ('hint' in reason) {
    return reason.hint
  }
  if ('area' in reason) {
    return `. Turn on the \`${reason.area}\` option, which registers it`
  }
  return reason.length === 0
    ? ''
    : `, which ${formatNames(reason, { conjunction: 'and' })} ${reason.length === 1 ? 'turns' : 'turn'} off`
}

/**
 * ESLint only checks the rules that are on, so a misspelled rule turned off would silently leave
 * the real one on
 */
export function checkRuleNames(
  subjects: ReadonlyArray<string>,
  rules: Iterable<string>,
  plugins: ReadonlyMap<string, ESLint.Plugin>,
  pluginOffOptions: PluginOffOptions = new Map(),
): void {
  for (const rule of rules) {
    const { pluginName, ruleName } = parseRuleId(rule)
    if (pluginName === undefined) {
      if (getCoreRule(ruleName) === undefined) {
        fail([...subjects, formatNames([rule])], "isn't a rule that ESLint has")
      }
      continue
    }
    const plugin = plugins.get(pluginName)
    if (plugin === undefined) {
      const hint = describePluginOffReason(pluginOffOptions.get(pluginName))
      fail(
        [...subjects, formatNames([rule])],
        `no config registers its plugin \`${pluginName}\`${hint}`,
      )
    }
    if (!Object.hasOwn(plugin.rules ?? {}, ruleName)) {
      fail(
        [...subjects, formatNames([rule])],
        `isn't a rule that the \`${pluginName}\` plugin this config loads has`,
      )
    }
  }
}

/**
 * Run once the presets' plugins are loaded
 */
export function checkAreaRuleNames(
  options: EslintConfigOptions,
  configs: ReadonlyArray<Pick<Linter.Config, 'plugins'>>,
): void {
  const plugins = getPlugins(configs)
  const pluginOffOptions = getPluginOffOptions(options)
  for (const { name, rules } of getAreaRules(options)) {
    checkRuleNames([formatNames([name])], Object.keys(rules), plugins, pluginOffOptions)
  }
}

/**
 * Run once the presets' plugins are loaded
 */
export function checkUserConfigRuleNames(
  userConfigs: ReadonlyArray<TypedConfig>,
  configs: ReadonlyArray<Pick<Linter.Config, 'plugins'>>,
  pluginOffOptions: PluginOffOptions,
): void {
  const plugins = getPlugins(configs)
  for (const config of userConfigs) {
    checkRuleNames(
      describeUserConfig(config, 'configs'),
      Object.keys(config.rules ?? {}),
      plugins,
      pluginOffOptions,
    )
  }
}

/**
 * Extensions without the dot, and a description for the error
 */
export type GlobTarget = {
  extensions: ReadonlyArray<string>
  description: string
}

export const CODE_FILE_TARGET: GlobTarget = {
  extensions: CODE_EXTNS,
  description: 'JavaScript or TypeScript file',
}

/**
 * A folder glob gets `/**`, and one with another extension a TypeScript one. A glob with braces
 * gets a generic example
 */
function suggestCodeGlob(glob: string, target: GlobTarget): string {
  const extension = target.extensions.includes('ts') ? 'ts' : (target.extensions[0] ?? 'ts')
  if (glob.includes('{')) {
    return `**/*.${extension}`
  }
  const lastSegment = glob.slice(glob.lastIndexOf('/') + 1)
  const dotIndex = lastSegment.lastIndexOf('.')
  return dotIndex > 0
    ? `${glob.slice(0, glob.length - lastSegment.length + dotIndex)}.${extension}`
    : `${trimEnd(glob, '/')}/**`
}

/**
 * A list option is checked once resolved. `hasDefault` is whether leaving the option out gives it
 * defaults, which the error for no globs suggests
 */
export function checkCodeGlobs(
  name: string,
  globs: ReadonlyArray<string>,
  target: GlobTarget = CODE_FILE_TARGET,
  hasDefault = true,
): void {
  if (globs.length === 0) {
    fail(
      [formatNames([name])],
      `lists no globs, so it would match no file. ${hasDefault ? 'Leave it out for the default' : 'List at least one glob'}`,
    )
  }
  checkRelativeGlobs(name, globs)
  if (globs.every((glob) => glob.startsWith('!'))) {
    fail(
      [formatNames([name])],
      "lists only negated globs, so it would match no file. Add the globs of the files to match, as in `['src/**', '!src/legacy/**']`",
    )
  }
  for (const glob of globs) {
    if (!glob.startsWith('!') && !canMatchFile([formatNames([name])], glob, target.extensions)) {
      fail(
        [formatNames([name])],
        `glob \`${glob}\` matches no ${target.description}. End it in \`*\` or an extension of one, as in \`${suggestCodeGlob(glob, target)}\``,
      )
    }
  }
}

/**
 * Once resolved
 */
export function checkDefaultProjectGlobs(globs: ReadonlyArray<string>): void {
  // typescript-eslint matches without a leading `./`, and throws on a bare `*`
  const starIndex = globs.findIndex((glob) => glob.replace(/^(?:\.\/)+/, '') === '*')
  if (starIndex !== -1) {
    fail(
      [formatNames([`typeAware.allowDefaultProject[${String(starIndex)}]`])],
      `glob \`${globs[starIndex] ?? ''}\` matches every file in the root, which typescript-eslint rejects. List the files`,
    )
  }
  const negatedGlob = globs.find((glob) => glob.startsWith('!'))
  if (negatedGlob !== undefined) {
    fail(
      ['`typeAware.allowDefaultProject`'],
      `glob \`${negatedGlob}\` starts with \`!\`, but typescript-eslint takes only the globs of files to add. Leave the file out of the list`,
    )
  }
  const doubleStarGlob = globs.find((glob) => glob.includes('**'))
  if (doubleStarGlob !== undefined) {
    fail(
      ['`typeAware.allowDefaultProject`'],
      `glob \`${doubleStarGlob}\` has \`**\`, which typescript-eslint rejects, since it would let the default project take too many files. List the files, as in \`*.config.ts\``,
    )
  }
}

/**
 * So every ignore file is under `root`
 */
function checkGitignoreFiles(options: EslintConfigOptions): void {
  const files = resolveSubOptions(options.gitignore)?.files ?? []
  for (const file of files) {
    if (path.isAbsolute(file) || file.startsWith('/')) {
      fail(['`gitignore.files`'], `path \`${file}\` is absolute. Make it relative to \`root\``)
    }
    if (file.split(/[/\\]/).includes('..')) {
      fail(
        ['`gitignore.files`'],
        `path \`${file}\` has a \`..\` segment, but the files are under \`root\`, relative to it`,
      )
    }
  }
}

function checkNextjsRootDirs(options: EslintConfigOptions): void {
  const option = resolveSubOptions(options.nextjs)?.rootDir
  if (Array.isArray(option) && option.length === 0) {
    fail(['`nextjs.rootDir`'], "lists no folders. Leave it out for `'.'`")
  }
  const rootDirs = toArray(option ?? [])
  for (const rootDir of rootDirs) {
    if (path.isAbsolute(rootDir)) {
      fail(['`nextjs.rootDir`'], `path \`${rootDir}\` is absolute. Make it relative to \`root\``)
    }
    const resolved = path.resolve(options.root, rootDir)
    const relative = path.relative(options.root, resolved)
    const isUnder = relative !== '..' && !relative.startsWith(`..${path.sep}`)
    const stats = isUnder ? fs.statSync(resolved, { throwIfNoEntry: false }) : undefined
    // eslint-plugin-next takes globs, which a folder of that name may still match
    if (stats?.isDirectory() !== true && hasGlobMagic(rootDir)) {
      fail(
        ['`nextjs.rootDir`'],
        `path \`${rootDir}\` is a glob, but this option lists folders, not globs. List each app, as in \`['apps/web', 'apps/docs']\``,
      )
    }
    if (stats?.isDirectory() !== true) {
      fail(['`nextjs.rootDir`'], `path \`${rootDir}\` isn't a folder under \`root\``)
    }
  }
}

/**
 * The plugin needs `entryPoint` to know Tailwind CSS v4's classes
 */
function checkTailwindcssEntryPoint(options: EslintConfigOptions): void {
  // Partial, since JavaScript callers can leave out what the type requires
  const tailwindcss: Partial<TailwindcssOptions> | undefined = resolveSubOptions(
    options.tailwindcss,
  )
  if (tailwindcss === undefined) {
    return
  }
  if (tailwindcss.settings !== undefined && Object.hasOwn(tailwindcss.settings, 'entryPoint')) {
    fail(['`tailwindcss.settings.entryPoint`'], 'is now `tailwindcss.entryPoint`. Move it')
  }
  const { entryPoint } = tailwindcss
  if (typeof entryPoint !== 'string' && !(entryPoint instanceof URL)) {
    fail(
      ['`tailwindcss.entryPoint`'],
      `expected ${PATH_OR_FILE_URL_EXPECTED}, received ${describeValue(entryPoint)}. Set it, as in \`{ entryPoint: 'src/styles.css' }\``,
    )
  }
  const entryPath = resolveEntryPoint(entryPoint, options.root)
  if (fs.statSync(entryPath, { throwIfNoEntry: false })?.isFile() !== true) {
    fail(['`tailwindcss.entryPoint`'], `${formatNames([entryPath])} isn't a file`)
  }
}

const AREA_RULE_SETS = [
  ['antislop', { slop: true, sonarjs: true }],
  ['e18e', E18E_RULE_SET_DEFAULTS],
] as const

/**
 * The area would lint nothing
 */
function checkEmptyAreas(options: EslintConfigOptions): void {
  for (const [area, keys] of AREA_RULE_SETS) {
    const value: unknown = options[area]
    if (
      !isRecord(value) ||
      Object.entries(keys).some(
        ([key, isOnByDefault]) => value[key] === true || (isOnByDefault && value[key] !== false),
      )
    ) {
      continue
    }
    const { rules } = value
    if (isRecord(rules) && Object.values(rules).some((entry) => isRuleOn(entry))) {
      continue
    }
    fail([formatNames([area])], `turns off every rule of the area. Use \`${area}: false\``)
  }
}

const TYPE_AWARE_TYPESCRIPT_OPTIONS = [
  'rulesTypeAware',
  'exhaustiveSwitch',
  'strictBooleanExpressions',
] as const

/**
 * Throws a `TypeError` on options that would silently do nothing or not what they say. Returns a
 * copy of the options' own keys, which is what to read
 */
export function validateOptions(givenOptions: EslintConfigOptions): EslintConfigOptions {
  // For JavaScript callers
  const untypedOptions: unknown = givenOptions
  const options = assertValid(OPTIONS_SCHEMA, untypedOptions, {
    prefix: PREFIX,
    rootSubject: 'options',
  })
  // Before anything reads it, which would fail with a raw filesystem error
  checkRoot(PREFIX, options.root)
  if (
    options.pnpm !== undefined &&
    options.pnpm !== false &&
    findUp('pnpm-workspace.yaml', options.root) === undefined
  ) {
    fail(['`pnpm`'], 'no `pnpm-workspace.yaml` at or above `root`. Remove the `pnpm` option')
  }

  checkRulePrefixes(options)
  if (options.nextjs !== undefined && options.nextjs !== false && options.react === false) {
    fail(
      ['`nextjs`'],
      'needs the `react` preset, which `react: false` turns off. Remove `react: false`',
    )
  }
  if (options.typeAware === false) {
    const typescript = resolveSubOptions(options.typescript) ?? {}
    const option = TYPE_AWARE_TYPESCRIPT_OPTIONS.find((key) => typescript[key] !== undefined)
    if (option !== undefined) {
      fail(
        [`\`typescript.${option}\``],
        'is for the files linted with type information, and `typeAware: false` lints without it. Remove one of them',
      )
    }
  }
  const antislop = resolveSubOptions(options.antislop)
  if (antislop?.sonarjs === false && antislop.cognitiveComplexity !== undefined) {
    fail(
      ['`antislop.cognitiveComplexity`'],
      'is for the eslint-plugin-sonarjs rules, and `antislop.sonarjs: false` turns them off. Remove one of them',
    )
  }
  checkEmptyAreas(options)
  checkGitignoreFiles(options)
  checkNextjsRootDirs(options)
  checkTailwindcssEntryPoint(options)
  for (const [name, example] of [
    ['browser', 'src/client/**'],
    ['server', 'src/server/**'],
  ] as const) {
    const option = resolveSubOptions(options[name])
    const files: unknown = option?.files
    if (option !== undefined && (files === undefined || isEmptyArray(files))) {
      fail(
        [formatNames([`${name}.files`])],
        `${files === undefined ? 'is missing' : 'lists no globs'}. List the ${name} code files, as in \`{ files: ['${example}'] }\``,
      )
    }
  }
  checkAreaFormattingRules(options)
  return options
}
