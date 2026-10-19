import { isDeepStrictEqual } from 'node:util'

import type { Config, ConfigRuleSettings, CoreRules, Plugin, Problem, RuleMessage } from 'stylelint'

import { isArray, toArray, unique } from '@gpahal/std/arrays'
import { formatMessage, formatNames } from '@gpahal/std/errors'
import { isPlainObject, isRecord } from '@gpahal/std/objects'

import { PREFIX } from '@/internal/options'

/**
 * The secondary options every rule takes besides its own
 */
type CommonSecondaryOptions = {
  severity?: NonNullable<Problem['severity']> | undefined
  message?: RuleMessage | undefined
  url?: string | undefined
  reportDisables?: boolean | undefined
  disableFix?: boolean | undefined
}

/**
 * Private to the module, so no other object passes for a {@link replace} wrapper
 */
const REPLACE: unique symbol = Symbol('replace')

/**
 * A rule's setting wrapped by {@link replace}, which only `defineConfig` unwraps
 */
export type Replaced<T> = { readonly [REPLACE]: T }

/**
 * A rule's secondary options, each optional and taking `undefined`, which keeps the preset's value
 */
type SecondaryOptions<S extends object> = {
  [K in keyof S]?: S[K] | undefined
} & CommonSecondaryOptions

/**
 * A rule's setting, or `null` to turn it off, optionally wrapped by {@link replace}. An `undefined`
 * primary option keeps the preset's, so `[undefined, { disableFix: false }]` changes only the
 * secondary options
 */
type RuleSettings<P, S extends object> =
  | ConfigRuleSettings<P, SecondaryOptions<S>>
  | [undefined]
  | [undefined, SecondaryOptions<S>]
  | Replaced<ConfigRuleSettings<P, SecondaryOptions<S>>>

/**
 * Stylelint's own rules. `CoreRules` is marked internal, so `tests/rule-types.test-d.ts` fails if an
 * upgrade stops exporting it
 */
type CoreRuleSettings = {
  [K in keyof CoreRules]?: RuleSettings<
    Parameters<CoreRules[K]>[0],
    Extract<Parameters<CoreRules[K]>[1], object>
  >
}

type PrimaryOption = boolean | number | string | object

type PropertiesOrderGroup = {
  properties: Array<string>
  emptyLineBefore?: 'always' | 'never' | 'threshold' | undefined
  noEmptyLineBetween?: boolean | undefined
  groupName?: string | undefined
  order?: 'flexible' | undefined
}

/**
 * Typed by hand, since the plugins ship no types for them
 */
type PluginRuleSettings = {
  'order/properties-order'?: RuleSettings<
    Array<string | PropertiesOrderGroup>,
    {
      unspecified: 'top' | 'bottom' | 'bottomAlphabetical' | 'ignore'
      emptyLineBeforeUnspecified: 'always' | 'never' | 'threshold'
    }
  >
  'plugin/use-baseline'?: RuleSettings<
    true,
    {
      available: 'widely' | 'newly' | number
      ignoreSelectors: Array<string>
      ignoreProperties: Record<string, Array<string>>
      ignoreAtRules: Array<string>
      ignoreFunctions: Array<string>
      ignoreUnits: Array<string>
    }
  >
  '@gpahal/media-range-spacing'?: RuleSettings<true, object>
  '@gpahal/comment-layout'?: RuleSettings<true, object>
  '@gpahal/declaration-empty-line-before'?: CoreRuleSettings['declaration-empty-line-before']
  '@gpahal/custom-property-empty-line-before'?: CoreRuleSettings['custom-property-empty-line-before']
}

/**
 * Rules typed by name. Other plugin rules, whose names have a `/`, take any options. Any other name,
 * such as a misspelled one, is a type error
 */
export type StylelintRules = CoreRuleSettings &
  PluginRuleSettings &
  Partial<Record<`${string}/${string}`, RuleSettings<PrimaryOption, object>>>

/**
 * `T` with `undefined` allowed for each optional key, meaning unset
 */
type WithUndefined<T> = {
  [K in keyof T]: undefined extends T[K] ? T[K] | undefined : T[K]
}

type StylelintReferenceFileEntry = Exclude<
  NonNullable<Config['referenceFiles']>,
  string | Array<unknown>
>

export type StylelintReferenceFile = WithUndefined<Omit<StylelintReferenceFileEntry, 'files'>> & {
  files: string | ReadonlyArray<string>
}

/**
 * Stylelint's `referenceFiles`, taking readonly arrays
 */
export type StylelintReferenceFiles =
  string | StylelintReferenceFile | ReadonlyArray<string | StylelintReferenceFile>

/**
 * Stylelint's `plugins`, taking a readonly array
 */
export type StylelintPlugins = string | Plugin | ReadonlyArray<string | Plugin>

/**
 * A shared Stylelint config, with object entries and readonly lists in `extends`
 */
export type StylelintExtendedConfig = WithUndefined<Omit<Config, 'extends'>> & {
  extends?: StylelintExtends | undefined
}

export type StylelintExtends =
  string | StylelintExtendedConfig | ReadonlyArray<string | StylelintExtendedConfig>

type OverrideArrayKey =
  'files' | 'extends' | 'plugins' | 'ignoreFiles' | 'processors' | 'referenceFiles'

/**
 * The override keys that do nothing there: those Stylelint sets itself or reads once per run, and
 * `fix`, which hides problems without writing fixes
 */
type IgnoredOverrideKey =
  | '_pluginFunctions'
  | '_resolvedCustomSyntax'
  | '_processorFunctions'
  | '_resolvedReferenceFiles'
  | 'formatter'
  | 'maxWarnings'
  | 'allowEmptyInput'
  | 'cache'
  | 'fix'

/**
 * An override with typed `rules`, `undefined` for optional keys and readonly arrays
 */
export type StylelintOverride = WithUndefined<
  Omit<NonNullable<Config['overrides']>[number], OverrideArrayKey | IgnoredOverrideKey | 'rules'>
> & {
  files: string | ReadonlyArray<string>
  extends?: StylelintExtends | undefined
  plugins?: StylelintPlugins | undefined
  ignoreFiles?: string | ReadonlyArray<string> | undefined
  processors?: ReadonlyArray<string> | undefined
  referenceFiles?: StylelintReferenceFiles | undefined
  rules?: StylelintRules | undefined
}

/**
 * Wrap a rule's setting so `defineConfig` uses it as it is, keeping none of the preset's secondary
 * options. Only `defineConfig` unwraps it, so Stylelint's own config types reject it.
 *
 * @throws TypeError when `setting` is `undefined` or already wrapped.
 *
 * @example
 * ```ts
 * import { defineConfig, replace } from '@gpahal/stylelint-config'
 *
 * await defineConfig({
 *   root: import.meta.dirname,
 *   rules: { 'value-no-vendor-prefix': replace([true, { ignoreValues: ['box'] }]) },
 * })
 * ```
 */
export function replace<T>(setting: T): Replaced<T> {
  if (setting === undefined) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        ['`replace()`'],
        'expected a setting, received `undefined`. Use `null` to turn the rule off, or leave the key out to keep the setting of the preset or an extended config',
      ),
    )
  }
  if (isReplaced(setting)) {
    throw new TypeError(formatMessage(PREFIX, ['`replace()`'], 'the setting is wrapped already'))
  }
  return { [REPLACE]: setting }
}

function isReplaced(value: unknown): value is Replaced<unknown> {
  return isRecord(value) && Object.hasOwn(value, REPLACE)
}

/**
 * How {@link mergeDeepWith} merges a key's values, and values that aren't both plain objects
 */
type MergeDeepOptions = {
  mergeValue?: (preset: unknown, user: unknown) => unknown
  mergeOther?: (preset: unknown, user: unknown) => unknown
}

/**
 * `user` merged deeply over `preset`. Plain objects merge key by key with `mergeValue`, a merged
 * `undefined` keeping the preset's value. Other values merge with `mergeOther`, by default the
 * user's
 */
export function mergeDeepWith<T>(preset: T, user: T): T
export function mergeDeepWith(preset: unknown, user: unknown, options: MergeDeepOptions): unknown
export function mergeDeepWith(
  preset: unknown,
  user: unknown,
  { mergeValue, mergeOther = (_preset, value) => value }: MergeDeepOptions = {},
): unknown {
  if (user === undefined) {
    return preset
  }
  if (!isPlainObject(preset) || !isPlainObject(user)) {
    return mergeOther(preset, user)
  }
  const mergeKey =
    mergeValue ??
    ((presetValue: unknown, value: unknown) => mergeDeepWith(presetValue, value, { mergeOther }))
  const entries: Array<[string, unknown]> = []
  for (const [key, value] of Object.entries(user)) {
    const mergedValue = mergeKey(Object.hasOwn(preset, key) ? preset[key] : undefined, value)
    if (mergedValue !== undefined) {
      entries.push([key, mergedValue])
    }
  }
  return { ...preset, ...Object.fromEntries(entries) }
}

/**
 * The preset's and user's values of an `ignore*` option, an array or an object of arrays, joined.
 * The user's value replaces one of any other shape
 */
function mergeIgnoreOption(preset: unknown, user: unknown): unknown {
  return mergeDeepWith(preset, user, {
    mergeValue: (presetItems, items) => mergeIgnoreOption(presetItems ?? [], items),
    mergeOther: (presetValue, value) =>
      isArray(presetValue) ? unique([...presetValue, ...toArray(value)]) : value,
  })
}

/**
 * A rule's setting split into its primary and secondary options, as Stylelint splits it for a rule
 * whose primary option can be an array, such as `order/properties-order`
 */
function splitSetting(
  setting: unknown,
  isPrimaryArray: boolean,
): { primary: unknown; secondary: unknown } {
  if (!isArray(setting)) {
    return { primary: setting, secondary: undefined }
  }
  if (!isPrimaryArray) {
    return { primary: setting[0], secondary: setting[1] }
  }
  if (setting.length === 1 && isArray(setting[0])) {
    return { primary: setting[0], secondary: undefined }
  }
  return setting.length === 2 && !isPlainObject(setting[0]) && isPlainObject(setting[1])
    ? { primary: setting[0], secondary: setting[1] }
    : { primary: setting, secondary: undefined }
}

/**
 * A preset's setting split into its primary and secondary options, or `undefined` when it has no
 * secondary options
 */
function splitPresetSetting(
  preset: unknown,
): { primary: unknown; secondary: Record<PropertyKey, unknown> } | undefined {
  return isArray(preset) &&
    preset.length === 2 &&
    !isPlainObject(preset[0]) &&
    isPlainObject(preset[1])
    ? { primary: preset[0], secondary: preset[1] }
    : undefined
}

/**
 * The base's setting split as {@link splitPresetSetting} does. When the user keeps the primary
 * option, a lone primary option splits too, in Stylelint's one-item forms `[primary]` and
 * `[[...primary]]`
 */
function splitBaseSetting(
  base: unknown,
  keepsPrimary: boolean,
  preset: unknown,
): { primary: unknown; secondary: Record<PropertyKey, unknown> } | undefined {
  const split = splitPresetSetting(base)
  if (split !== undefined || !keepsPrimary || base == null) {
    return split
  }
  // As in `[[...primary]]` or `[[...primary], secondary]`
  const isPrimaryArray = isArray(preset) && isArray(preset[0])
  const { primary } = splitSetting(
    base,
    isPrimaryArray || !isArray(base) || base.length !== 1 || isArray(base[0]),
  )
  return primary == null ? undefined : { primary, secondary: {} }
}

/**
 * Whether `setting` is `null` or `[null]`
 */
function isOff(setting: unknown): boolean {
  return setting === null || (isArray(setting) && setting.length > 0 && setting[0] == null)
}

/**
 * The secondary options tied to the primary option: `message` and `url` describe it, and `except`
 * and `ignore` make exceptions to it
 */
const PRIMARY_BOUND_OPTIONS: ReadonlySet<string> = new Set(['message', 'url', 'except', 'ignore'])

/**
 * The options of `secondary` in {@link PRIMARY_BOUND_OPTIONS} when `isBound`, else the rest
 */
function boundOptionsOf(
  secondary: Record<PropertyKey, unknown>,
  isBound: boolean,
): Record<PropertyKey, unknown> {
  return Object.fromEntries(
    Object.entries(secondary).filter(([key]) => PRIMARY_BOUND_OPTIONS.has(key) === isBound),
  )
}

/**
 * The setting with `primary` and `secondary` options, or the primary option alone when neither side
 * gave secondary options. An array primary option goes in one, as Stylelint reads it
 */
function toSetting(
  primary: unknown,
  secondary: Readonly<Record<PropertyKey, unknown>>,
  isSecondaryGiven: boolean,
): unknown {
  if (!isSecondaryGiven && Reflect.ownKeys(secondary).length === 0) {
    return isArray(primary) ? [primary] : primary
  }
  return [primary, secondary]
}

/**
 * The user's setting split, with `basePrimary` as the primary option when the user keeps it
 */
function splitUserSetting(
  user: unknown,
  basePrimary: unknown,
  keepsPrimary: boolean,
): { primary: unknown; secondary: unknown } {
  return keepsPrimary && isArray(user)
    ? { primary: basePrimary, secondary: user[1] }
    : splitSetting(user, isArray(basePrimary))
}

/**
 * @throws TypeError when the user keeps the primary option and `split`, the setting it applies to,
 *   is `undefined`, since no config sets the rule.
 */
function checkPrimaryKept(keepsPrimary: boolean, split: unknown, subject: string): void {
  if (keepsPrimary && split === undefined) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [formatNames([subject])],
        "keeps the primary option of a setting that no config sets, so Stylelint would turn the rule off. Set the primary option, as in ['always', { … }]",
      ),
    )
  }
}

/**
 * The user's setting merged over `base`: the user's primary option, with the user's secondary
 * options over the base's and `ignore*` lists joined. The base's {@link PRIMARY_BOUND_OPTIONS} go
 * when the primary option differs, and come back from `preset` when the user returns to its primary
 * option, as an override can after your top-level rule. An `undefined` primary option keeps the
 * base's, and an off base stays off
 *
 * @throws TypeError when the user keeps the primary option of a rule that nothing sets, which
 *   Stylelint would read as off.
 */
function mergeRuleSetting(base: unknown, user: unknown, preset: unknown, subject: string): unknown {
  if (isReplaced(user)) {
    return user[REPLACE]
  }
  const keepsPrimary = isArray(user) && user.length > 0 && user[0] === undefined
  // A base that's off has no primary option to keep
  if (keepsPrimary && isOff(base)) {
    return null
  }
  const presetSplit = splitPresetSetting(preset)
  const baseSplit = splitBaseSetting(base, keepsPrimary, preset)
  const split = baseSplit ?? presetSplit
  checkPrimaryKept(keepsPrimary, split, subject)
  if (user === null || split === undefined) {
    return user
  }
  const { primary, secondary } = splitUserSetting(user, split.primary, keepsPrimary)
  // `[null]` turns the rule off, and secondary options that aren't an object are Stylelint's to
  // report
  if (primary == null || (secondary !== undefined && !isPlainObject(secondary))) {
    return user
  }
  const presetBound =
    presetSplit !== undefined && isDeepStrictEqual(primary, presetSplit.primary)
      ? boundOptionsOf(presetSplit.secondary, true)
      : {}
  let merged: Record<PropertyKey, unknown>
  if (baseSplit === undefined) {
    if (Object.keys(presetBound).length === 0) {
      return user
    }
    merged = presetBound
  } else {
    merged = isDeepStrictEqual(primary, baseSplit.primary)
      ? { ...baseSplit.secondary }
      : { ...presetBound, ...boundOptionsOf(baseSplit.secondary, false) }
  }
  const userSecondary: Record<PropertyKey, unknown> = secondary ?? {}
  const entries: Array<[string, unknown]> = []
  for (const [key, value] of Object.entries(userSecondary)) {
    if (value !== undefined) {
      entries.push([
        key,
        key.startsWith('ignore')
          ? mergeIgnoreOption(Object.hasOwn(merged, key) ? merged[key] : undefined, value)
          : value,
      ])
    }
  }
  return toSetting(primary, { ...merged, ...Object.fromEntries(entries) }, secondary !== undefined)
}

/**
 * The setting of `name` in `rules`, `null` included, or else in `fallback`
 */
export function settingIn(
  rules: Readonly<Record<string, unknown>>,
  name: string,
  fallback: Readonly<Record<string, unknown>> = {},
): unknown {
  if (Object.hasOwn(rules, name)) {
    return rules[name]
  }
  return Object.hasOwn(fallback, name) ? fallback[name] : undefined
}

/**
 * The user's rules merged over the settings `settingOf` gives, leaving out `undefined` ones.
 * `presetSettingOf` gives the preset's own settings where your top-level rules changed them
 */
export function mergeUserRules(
  user: StylelintRules,
  settingOf: (name: string) => unknown,
  presetSettingOf: (name: string) => unknown = settingOf,
  subject = 'rules',
): StylelintRules {
  const entries: Array<[string, unknown]> = []
  for (const [name, setting] of Object.entries(user)) {
    if (setting !== undefined) {
      entries.push([
        name,
        mergeRuleSetting(settingOf(name), setting, presetSettingOf(name), `${subject}.${name}`),
      ])
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Each merged setting is the user's, whose secondary options gain those of the preset's setting of the same rule
  return Object.fromEntries(entries) as StylelintRules
}

/**
 * The preset's rules with the user's merged over them, the preset falling back to `base`, the
 * configs it extends. With `presetOnly`, as for a file type override, only the rules the preset (or
 * the given rules) sets to something other than `null` are kept
 */
export function mergeRules(
  preset: StylelintRules,
  user: StylelintRules,
  {
    base = {},
    presetOnly = false,
  }: {
    base?: Readonly<Record<string, unknown>>
    presetOnly?: boolean | Readonly<Record<string, unknown>>
  } = {},
): StylelintRules {
  const presetRules: Readonly<Record<string, unknown>> = preset
  const onlyRules = presetOnly === true ? presetRules : presetOnly
  const userRules =
    onlyRules === false
      ? user
      : Object.fromEntries(
          Object.entries(user).filter(
            ([name]) => Object.hasOwn(onlyRules, name) && onlyRules[name] !== null,
          ),
        )
  return {
    ...preset,
    ...mergeUserRules(userRules, (name) => settingIn(presetRules, name, base)),
  }
}

/**
 * `rules` as a layer whose settings replace those below whole, leaving out `undefined` ones
 */
export function replaceLayer(rules: Readonly<Record<string, unknown>>): StylelintRules {
  return Object.fromEntries(
    Object.entries(rules)
      .filter(([, setting]) => setting !== undefined)
      .map(([name, setting]) => [name, replace(setting)]),
  )
}
