import type { Linter } from 'eslint'

import { describeValue, formatNames } from '@gpahal/std/errors'
import { clonePlain, isPlainObject } from '@gpahal/std/objects'
import { isPromiseLike } from '@gpahal/std/promises'

import { CONFIG_NAMES } from '@/internal/config-names.gen'
import { disableRulesFixConfig } from '@/internal/fixes'
import { FORMATTING_RULES } from '@/internal/formatting'
import { getPlugins, isRuleOn, parseRuleId } from '@/internal/rules'
import type { ConfigNames, ConfigsElement, TypedConfig, TypedRules } from '@/internal/types'
import {
  checkRuleEntries,
  checkUserConfig,
  cloneConfig,
  copyUserConfigItem,
  describeUserConfig,
  getPresets,
  getSplitConfig,
  isPluginsPart,
  keepSplitPart,
  nameUserConfig,
  normalizeUserConfig,
  normalizeUserConfigs,
  rescopeUserConfig,
  routeSplitRules,
  SCOPE_KEYS,
  scopeUserConfig,
} from '@/internal/user-configs'
import type { Presets, UntypedKinds, UserConfigContext } from '@/internal/user-configs'
import { fail, formatErrorMessage } from '@/internal/utils'
import { checkRuleNames } from '@/internal/validate'
import type { PluginOffOptions } from '@/internal/validate'

type Awaitable<T> = T | Promise<T>

type ComposerItem = Awaitable<ConfigsElement>

/**
 * Checked once the configs resolve, when every plugin is loaded
 */
type NamedRules = Array<{
  subjects: Array<string>
  rules: Array<string>
  /**
   * Checked after the names, so a misspelled rule gets the message about its name
   */
  unmatched?: Array<string>
}>

/**
 * `removed` holds the names `.remove()` removed so far, for a later method's error
 */
type Operation = (
  configs: Array<TypedConfig>,
  named: NamedRules,
  removed: Set<string>,
  context: LoadedComposerContext,
  removedPlugins: RemovedPlugins,
) => Awaitable<Array<TypedConfig>>

/**
 * Checked once the configs resolve
 */
type RemovedPlugins = Map<string, ReadonlySet<string>>

export type ComposerContext = UserConfigContext & {
  /**
   * Where `.disableRulesFix()` finds the core rules ESLint runs
   */
  root: string
  isOn: Readonly<Record<string, boolean>>
  isTypeAware: boolean
  untypedKinds?: UntypedKinds | undefined
  isJavascriptOnly?: boolean | undefined
  pluginOffOptions: PluginOffOptions
}

type LoadedComposerContext = ComposerContext & { presets: Presets }

/**
 * Observes promised inputs at the call, so a rejection isn't unhandled while resolution waits. A
 * rejected input still rejects the composer when its operation runs
 */
// eslint-disable-next-line @typescript-eslint/promise-function-async -- An async wrapper would return another unobserved promise
function observeItems(items: ReadonlyArray<ComposerItem>): Promise<Array<ConfigsElement>> {
  // Copied now, or once resolved, so later changes don't reach the configs, and naming them doesn't
  // write to the caller's objects, which may be frozen or shared
  const pending = Promise.all(
    items.map(async (item) => copyUserConfigItem(isPromiseLike(item) ? await item : item)),
  )
  pending.catch(() => undefined)
  return pending
}

/**
 * Normalized and scoped as `configs` is, each a copy, with their rule names added to `named`
 */
async function resolveItems(
  items: Promise<Array<ConfigsElement>>,
  method: 'append' | 'insertBefore' | 'insertAfter',
  named: NamedRules,
  context: LoadedComposerContext,
  configs: ReadonlyArray<TypedConfig>,
): Promise<Array<TypedConfig>> {
  const normalized = normalizeUserConfigs(await items, method, context)
  const plugins = getPlugins([...configs, ...normalized])
  return normalized.flatMap((config) => {
    named.push({
      subjects: describeUserConfig(config, method),
      rules: Object.keys(config.rules ?? {}),
    })
    return scopeUserConfig(config, method, { ...context, plugins }).map((part) => cloneConfig(part))
  })
}

/**
 * Runtime checks for JavaScript callers
 */
function checkConfigName(subjects: ReadonlyArray<string>, name: unknown): void {
  if (typeof name !== 'string') {
    fail(subjects, `expected a config name, received ${describeValue(name)}`)
  }
}

function checkRuleNameArguments(subject: string, rules: ReadonlyArray<unknown>): void {
  const index = rules.findIndex((rule) => typeof rule !== 'string')
  if (index !== -1) {
    fail(
      [subject, `argument ${String(index + 1)}`],
      `expected a rule name, received ${describeValue(rules[index])}`,
    )
  }
}

function checkOverrideResult(value: unknown, name: string): TypedConfig {
  if (!isPlainObject(value)) {
    fail(
      [formatNames([`.override('${name}')`])],
      `expected the function to return a config object, received ${describeValue(value)}`,
    )
  }

  return value
}

function checkResolvedResult(value: unknown): Array<TypedConfig> | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    fail(
      ['`.onResolved()`'],
      `expected the callback to return an array of configs or \`undefined\`, received ${describeValue(value)}`,
    )
  }
  const index = value.findIndex((config) => !isPlainObject(config))
  if (index !== -1) {
    fail(
      ['`.onResolved()`', `returned item \`[${String(index)}]\``],
      `expected a config object, received ${describeValue(value[index])}`,
    )
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Configs, which ESLint checks
  return value as Array<TypedConfig>
}

type Match = [index: number, config: TypedConfig]

/**
 * A name can be shared, such as `gpahal/ignores/gitignore`, one per `.gitignore` file
 *
 * @throws TypeError when no config has the name
 */
function findAll(
  configs: ReadonlyArray<TypedConfig>,
  name: ConfigNames,
  subject: string,
  context: ComposerContext,
  removed: ReadonlySet<string>,
): [Match, ...Array<Match>] {
  const matches = configs.flatMap((config, index): Array<Match> =>
    config.name === name ? [[index, config]] : [],
  )
  const [first, ...rest] = matches
  if (first === undefined) {
    const hint = describeMissingName(name, context, removed)
    fail(
      [subject],
      `no config has the name ${formatNames([name])}${hint === undefined ? '' : `. ${hint}`}`,
    )
  }
  return [first, ...rest]
}

const TYPE_AWARE_NAME_REGEX =
  /\/(?:type-aware(?:[/-]|$)|typecheck$|strict-boolean-expressions$)|-type-checked$/

const FINAL_GUARD_NAME_REGEX =
  /^gpahal\/(?:formatting\/off|json\/jsonc-language|disable-type-checked\/.+|root-spelling(?:\/[^/]+)?)$/

/**
 * Why a name this package can add is missing: removed, its option off, needing type information or
 * typescript-eslint, or needing another setting. `undefined` for an unknown name
 */
function describeMissingName(
  name: string,
  { isOn, isTypeAware, isJavascriptOnly = false }: ComposerContext,
  removed: ReadonlySet<string>,
): string | undefined {
  if (removed.has(name)) {
    return 'An earlier `.remove()` removed it'
  }
  if (FINAL_GUARD_NAME_REGEX.test(name)) {
    return `\`${name}\` is a guard that the composer adds after every method's change and \`onResolved\` callback, so none of them can reach it. ${name === 'gpahal/formatting/off' ? 'To keep a formatting rule on, list it in `allowFormattingRules`' : 'Change the configs before it instead'}`
  }
  if (!CONFIG_NAMES.has(name)) {
    return undefined
  }
  const segment = /^gpahal\/([^/]+)\//.exec(name)?.[1] ?? ''
  const option = segment.replaceAll(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
  const isOption = Object.hasOwn(isOn, option)
  if (isOption && isOn[option] !== true) {
    return `\`${name}\` comes from the \`${option}\` option, which is off`
  }
  if (isJavascriptOnly && (name.includes('typescript') || TYPE_AWARE_NAME_REGEX.test(name))) {
    return `\`${name}\` needs typescript-eslint or type information, which a JavaScript-only project, one without TypeScript files or a tsconfig.json or jsconfig.json at \`root\`, is linted without`
  }
  if (!isTypeAware && TYPE_AWARE_NAME_REGEX.test(name)) {
    return `\`${name}\` needs type information, which \`typeAware: false\` turns off`
  }
  return isOption
    ? `\`${name}\` comes from the \`${option}\` option, which is on; it needs ${describeNeededSetting(name, option)}`
    : 'Is the option that adds it turned on?'
}

/**
 * A `user-rules` config holds the area's `rules`, or `typescript.rulesTypeAware`
 */
function describeNeededSetting(name: string, option: string): string {
  if (name === 'gpahal/typescript/type-aware/user-rules') {
    return '`typescript.rulesTypeAware`'
  }
  return name.endsWith('/user-rules') ? `\`${option}.rules\`` : 'another of its settings'
}

type MergedKeys = { readonly [key: string]: MergedKeys }

/**
 * `parserOptions` merges so an override keeps the project service's options, `globals` so an added
 * global keeps the others, and `settings` so one plugin's setting keeps the others
 */
const MERGED_KEYS: MergedKeys = {
  rules: {},
  plugins: {},
  settings: {},
  linterOptions: {},
  languageOptions: { parserOptions: {}, globals: {} },
}

/**
 * `undefined` values are skipped, so `{ files: undefined }` keeps the config's files
 */
function mergeObjects(
  base: unknown,
  override: object,
  merged: MergedKeys,
): Record<string, unknown> {
  const result: Record<string, unknown> = isPlainObject(base) ? { ...base } : {}
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue
    }
    const nested = Object.hasOwn(merged, key) ? merged[key] : undefined
    // Assignment would invoke the inherited setter for a JSON-derived `__proto__` key
    Object.defineProperty(result, key, {
      value:
        nested !== undefined && isPlainObject(value)
          ? mergeObjects(Object.hasOwn(result, key) ? result[key] : undefined, value, nested)
          : value,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  }
  return result
}

function mergeConfig(config: TypedConfig, override: TypedConfig): TypedConfig {
  return cloneConfig(mergeObjects(config, override, MERGED_KEYS))
}

/**
 * A split part gets only the rules `routeSplitRules` routes to it, unless `override` changes the
 * scope, and the plugins part gets only `plugins`
 */
function mergeSplitOverride(
  config: TypedConfig,
  override: TypedConfig,
  configs: ReadonlyArray<TypedConfig>,
  { presets, plugins = presets.plugins }: LoadedComposerContext,
): TypedConfig {
  if (isPluginsPart(config)) {
    return mergeConfig(config, override.plugins === undefined ? {} : { plugins: override.plugins })
  }
  const isScoped = SCOPE_KEYS.some((key) => override[key] !== undefined)
  const routed =
    isScoped || !isPlainObject(override.rules)
      ? undefined
      : routeSplitRules(config, configs, override.rules, {
          plugins,
          languages: presets.languages,
        })
  if (routed === undefined) {
    return mergeConfig(config, override)
  }
  const merged = mergeConfig(config, { ...override, rules: routed.rules })
  for (const rule of routed.removed) {
    Reflect.deleteProperty(merged.rules ?? {}, rule)
  }
  return merged
}

/**
 * A severity alone keeps `previous`'s options
 */
function withPreviousOptions(entry: unknown, previous: unknown): unknown {
  const isSeverityOnly = !Array.isArray(entry) || entry.length === 1
  if (!isSeverityOnly || !Array.isArray(previous) || previous.length <= 1) {
    return clonePlain(entry)
  }
  const severity: unknown = Array.isArray(entry) ? entry[0] : entry
  const options: Array<unknown> = previous.slice(1)
  return [severity, ...clonePlain(options)]
}

/**
 * ESLint would fail on a removed plugin's rules without naming the call. A config that registers
 * the plugin again is fine
 */
function checkRemovedPlugins(
  configs: ReadonlyArray<TypedConfig>,
  removedPlugins: RemovedPlugins,
): void {
  const plugins = getPlugins(configs)
  const onRules = configs.flatMap((config) =>
    Object.entries(config.rules ?? {})
      .filter(([, entry]) => isRuleOn(entry))
      .map(([rule]) => rule),
  )
  for (const [name, removed] of removedPlugins) {
    for (const plugin of removed) {
      if (plugins.has(plugin)) {
        continue
      }
      const rules = [...new Set(onRules.filter((rule) => parseRuleId(rule).pluginName === plugin))]
      if (rules.length > 0) {
        fail(
          [formatNames([`.remove('${name}')`])],
          `removes the plugin ${formatNames([plugin])} that rules of the other configs turn on, such as ${formatNames(rules.slice(0, 3))}. Remove or turn off those rules, or keep the config`,
        )
      }
    }
  }
}

/**
 * So that ESLint's error on a composer used as a config object names the fix
 */
const UNAWAITED_KEY = formatErrorMessage(
  ['`defineConfig()`'],
  'returns a composer, which ESLint reads as a config object. Await it before using it in an array or `extends`',
)

/**
 * The configs that `defineConfig` returns, which ESLint awaits, and methods that queue changes to
 * them. On each await, the changes run in order on a copy of the configs, then the `onResolved`
 * callbacks, then the finalizer. Added configs are scoped and checked as `configs` is, and changed
 * ones in their existing scope. The finalizer's guards, such as `gpahal/formatting/off`, come last,
 * so no method or callback sees them.
 *
 * @throws TypeError when the configs resolve, on an unknown config name or rule, a config that
 *   `configs` would reject, an argument or callback result of the wrong type, or a `.remove()` of
 *   the only configs registering a plugin whose rules stay on. Methods also throw on invalid
 *   arguments when called
 * @example
 * ```ts
 * import { defineConfig } from '@gpahal/eslint-config'
 *
 * export default defineConfig({ root: import.meta.dirname })
 *   .overrideRules({ 'no-console': ['error', { allow: ['info'] }] })
 *   .remove('gpahal/fixes/report-only')
 * ```
 */
export class Composer implements PromiseLike<Array<Linter.Config>> {
  readonly #base: Promise<Array<TypedConfig>>
  readonly #context: ComposerContext
  readonly #operations: Array<Operation> = []
  readonly #resolved: Array<
    (configs: Array<TypedConfig>) => Awaitable<Array<TypedConfig> | undefined>
  > = []
  readonly #finalize: (configs: Array<TypedConfig>) => Awaitable<Array<TypedConfig>>

  /**
   * `finalize` runs after every change and callback, so they can't reach the configs it adds
   */
  constructor(
    base: Promise<Array<TypedConfig>>,
    context: ComposerContext,
    finalize: (configs: Array<TypedConfig>) => Awaitable<Array<TypedConfig>>,
  ) {
    this.#base = base
    this.#context = context
    this.#finalize = finalize
    // ESLint reads an unawaited composer as a config object and names an unknown key in its error,
    // so this key's name says what to do. Symbol keys would be ignored
    Reflect.defineProperty(this, UNAWAITED_KEY, { value: true, enumerable: true })
    // ESLint checks a config's keys only when its non-universal `files` match the file. None of
    // its defaults matches `.ts`, so a TypeScript file would pass as ignored
    Reflect.defineProperty(this, 'files', { value: ['**/*.*'], enumerable: true })
    // Spreading an unawaited composer would throw that it isn't iterable. Left out of the declared
    // type, so TypeScript reports the spread too
    Reflect.defineProperty(this, Symbol.iterator, {
      value: () =>
        fail(
          ['`defineConfig()`'],
          'returns a composer, which is iterable only once awaited. Await it, as in `export default await defineConfig(...)` or `...(await defineConfig(...))`',
        ),
    })
    // A method that throws when called leaves the composer unawaited, so a rejection of the
    // presets would be unhandled. Awaiting the composer still rejects with it
    base.catch(() => undefined)
  }

  /**
   * Merges `config` into each config named `name`: `rules`, `plugins`, `settings`,
   * `languageOptions` and `linterOptions` merge one level deep, as do
   * `languageOptions.parserOptions` and `languageOptions.globals`, and other keys replace. A key set
   * to `undefined` changes nothing. In a split config of yours, each rule goes to its part. A
   * change of `files`, `ignores` or `language`, or a function, goes to the config before the split,
   * which splits again. A function gets each config and returns its replacement
   */
  override(
    name: ConfigNames,
    config: TypedConfig | ((config: TypedConfig) => Awaitable<TypedConfig>),
  ): this {
    checkConfigName(['`.override()`'], name)
    // For JavaScript callers
    const untypedConfig: unknown = config
    this.#operations.push(async (configs, named, removed, context) => {
      const subject = formatNames([`.override('${name}')`])
      if (typeof untypedConfig !== 'function' && !isPlainObject(untypedConfig)) {
        fail(
          [subject],
          `expected a config object or a function that returns one, received ${describeValue(untypedConfig)}`,
        )
      }
      const source = { method: 'override', name } as const
      // A copy, so a change in place is checked against the original
      const change = async (original: TypedConfig): Promise<TypedConfig> =>
        typeof config === 'function'
          ? cloneConfig(checkOverrideResult(await config(cloneConfig(original)), name))
          : mergeConfig(original, config)
      const isRescoped =
        typeof config === 'function' || SCOPE_KEYS.some((key) => config[key] !== undefined)
      const replaced = new Map<TypedConfig, Array<TypedConfig>>()
      for (const [, original] of findAll(configs, name, subject, context, removed)) {
        if (replaced.has(original)) {
          continue
        }
        const split = isRescoped ? getSplitConfig(original, configs) : undefined
        if (split !== undefined) {
          const result = await change(split.config)
          const parts = rescopeUserConfig(result, source, split.config, {
            ...context,
            plugins: new Map([
              ...(context.plugins ?? context.presets.plugins),
              ...Object.entries(result.plugins ?? {}),
            ]),
          }).map((part) => cloneConfig(part))
          for (const [index, part] of split.parts.entries()) {
            replaced.set(part, index === 0 ? parts : [])
          }
          named.push({ subjects: [subject], rules: Object.keys(result.rules ?? {}) })
          continue
        }
        const result =
          typeof config === 'function'
            ? await change(original)
            : mergeSplitOverride(original, config, configs, context)
        keepSplitPart(original, result)
        // The result keeps the config's scope
        checkUserConfig(result, source, context, { original })
        named.push({
          subjects: [subject],
          rules: Object.keys((typeof config === 'function' ? result : config).rules ?? {}),
        })
        replaced.set(original, [result])
      }
      return configs.flatMap((found) => replaced.get(found) ?? [found])
    })
    return this
  }

  /**
   * Sets each rule in every config that sets it, but not where it's off, such as an exemption. A
   * severity alone keeps the config's options, and an entry with options replaces them. `null`
   * removes a rule, and `undefined` leaves it. Turning on a rule that no config turns on rejects
   * when awaited; use `configs` or `.append()`
   */
  overrideRules(rules: { [K in keyof TypedRules]?: TypedRules[K] | null | undefined }): this {
    // For JavaScript callers
    const untypedRules: unknown = rules
    if (!isPlainObject(untypedRules)) {
      fail(
        ['`.overrideRules()`'],
        `expected an object of rule entries, received ${describeValue(untypedRules)}`,
      )
    }
    const entries: Array<[string, unknown]> = Object.entries(rules)
    checkRuleEntries(rules, ['`.overrideRules()`'], true)
    this.#operations.push((configs, named, _removed, context) => {
      const matched = new Set<string>()
      for (const config of configs) {
        const { rules: configRules } = config
        const previous = new Map<string, unknown>()
        for (const [rule, entry] of entries) {
          if (
            entry === undefined ||
            configRules === undefined ||
            !Object.hasOwn(configRules, rule)
          ) {
            continue
          }
          if (entry === null) {
            Reflect.deleteProperty(configRules, rule)
          } else if (isRuleOn(Reflect.get(configRules, rule))) {
            const before: unknown = Reflect.get(configRules, rule)
            previous.set(rule, before)
            Reflect.set(configRules, rule, withPreviousOptions(entry, before))
            matched.add(rule)
          }
        }
        if (previous.size > 0) {
          checkUserConfig(config, 'overrideRules', context, {
            original: { ...config, rules: { ...configRules, ...Object.fromEntries(previous) } },
          })
        }
      }
      named.push({
        subjects: ['`.overrideRules()`'],
        rules: entries.map(([rule]) => rule),
        unmatched: entries
          .filter(
            ([rule, entry]) =>
              entry !== undefined && entry !== null && isRuleOn(entry) && !matched.has(rule),
          )
          .map(([rule]) => rule),
      })
      return configs
    })
    return this
  }

  /**
   * Removes each rule from every config that sets it
   */
  removeRules(...rules: Array<keyof TypedRules>): this {
    checkRuleNameArguments('`.removeRules()`', rules)
    this.#operations.push((configs, named) => {
      named.push({ subjects: ['`.removeRules()`'], rules })
      for (const { rules: configRules } of configs) {
        for (const rule of rules) {
          if (configRules !== undefined) {
            Reflect.deleteProperty(configRules, rule)
          }
        }
      }
      return configs
    })
    return this
  }

  /**
   * Makes each rule report without fixing in every file, in a config named `user/disable-rules-fix`
   * after the configs as they stand. Suggestions stay
   *
   * @throws TypeError when called with an argument that isn't a rule name. A rule that no plugin
   *   has rejects when awaited
   */
  disableRulesFix(...rules: Array<keyof TypedRules>): this {
    checkRuleNameArguments('`.disableRulesFix()`', rules)
    this.#operations.push((configs, named) => {
      named.push({ subjects: ['`.disableRulesFix()`'], rules })
      return [
        ...configs,
        disableRulesFixConfig({
          name: 'user/disable-rules-fix',
          rules,
          configs,
          root: this.#context.root,
        }),
      ]
    })
    return this
  }

  /**
   * A new composer with a copy of the changes queued so far, so two configs can diverge
   */
  clone(): Composer {
    const clone = new Composer(this.#base, this.#context, this.#finalize)
    clone.#operations.push(...this.#operations)
    clone.#resolved.push(...this.#resolved)
    return clone
  }

  /**
   * Removes every config named by one of `names`, each of which some config must have. Removing the
   * only configs that register a plugin rejects when awaited if a rule of that plugin stays on
   *
   * @throws TypeError when called without a name, with a name that isn't a string, or with a name
   *   twice
   */
  remove(...names: Array<ConfigNames>): this {
    if (names.length === 0) {
      fail(['`.remove()`'], 'names no config. Pass at least one config name')
    }
    for (const [index, name] of names.entries()) {
      checkConfigName(['`.remove()`', `argument ${String(index + 1)}`], name)
    }
    const duplicate = names.find((name, index) => names.indexOf(name) !== index)
    if (duplicate !== undefined) {
      fail(['`.remove()`'], `names ${formatNames([duplicate])} twice`)
    }
    this.#operations.push((configs, _named, removed, context, removedPlugins) => {
      let remaining = configs
      for (const name of names) {
        const matched = new Set(
          findAll(remaining, name, '`.remove()`', context, removed).map(([, config]) => config),
        )
        removed.add(name)
        remaining = remaining.filter((config) => !matched.has(config))
        const plugins = getPlugins(remaining)
        removedPlugins.set(
          name,
          new Set(
            getPlugins([...matched])
              .keys()
              .filter((plugin) => !plugins.has(plugin)),
          ),
        )
      }
      return remaining
    })
    return this
  }

  /**
   * Adds `items` before the first config named `name`, scoped and checked as `configs` is
   */
  insertBefore(name: ConfigNames, ...items: Array<ComposerItem>): this {
    // Observed first, so a rejected input isn't unhandled when the name check throws
    const pending = observeItems(items)
    checkConfigName(['`.insertBefore()`'], name)
    this.#operations.push(async (configs, named, removed, context) => {
      const added = await resolveItems(pending, 'insertBefore', named, context, configs)
      const [[first]] = findAll(
        configs,
        name,
        formatNames([`.insertBefore('${name}')`]),
        context,
        removed,
      )
      configs.splice(first, 0, ...added)
      return configs
    })
    return this
  }

  /**
   * Adds `items` after the last config named `name`, scoped and checked as `configs` is
   */
  insertAfter(name: ConfigNames, ...items: Array<ComposerItem>): this {
    // Observed first, so a rejected input isn't unhandled when the name check throws
    const pending = observeItems(items)
    checkConfigName(['`.insertAfter()`'], name)
    this.#operations.push(async (configs, named, removed, context) => {
      const added = await resolveItems(pending, 'insertAfter', named, context, configs)
      const [first, ...rest] = findAll(
        configs,
        name,
        formatNames([`.insertAfter('${name}')`]),
        context,
        removed,
      )
      const [last] = rest.at(-1) ?? first
      configs.splice(last + 1, 0, ...added)
      return configs
    })
    return this
  }

  /**
   * Adds `items` after the configs, before the final guards, scoped and checked as `configs` is
   */
  append(...items: Array<ComposerItem>): this {
    const pending = observeItems(items)
    this.#operations.push(async (configs, named, _removed, context) => [
      ...configs,
      ...(await resolveItems(pending, 'append', named, context, configs)),
    ])
    return this
  }

  /**
   * Calls `callback` with every config after the other changes, and uses the configs it returns,
   * if any. A config it returns that it didn't get is checked as `.append()`'s are
   */
  onResolved(
    callback: (configs: Array<TypedConfig>) => Awaitable<Array<TypedConfig> | undefined>,
  ): this {
    this.#resolved.push(callback)
    return this
  }

  // eslint-disable-next-line unicorn/no-thenable -- ESLint awaits the composer for the configs
  async then<TResult1 = Array<Linter.Config>, TResult2 = never>(
    onFulfilled?: ((value: Array<Linter.Config>) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    // eslint-disable-next-line unicorn/prefer-then-catch -- It's the composer's own `then`, with both callbacks
    return this.#resolve().then(onFulfilled, onRejected)
  }

  async #resolve(): Promise<Array<Linter.Config>> {
    const named: NamedRules = []
    const removed = new Set<string>()
    const removedPlugins: RemovedPlugins = new Map()
    let configs = (await this.#base).map((config) => cloneConfig(config))
    // As the configs stand at each change, so a removed preset's plugin can be registered again
    const getContext = (): LoadedComposerContext => ({
      ...this.#context,
      presets: getPresets(configs),
      plugins: getPlugins(configs),
    })
    for (const operation of this.#operations) {
      configs = await operation(configs, named, removed, getContext(), removedPlugins)
    }
    for (const callback of this.#resolved) {
      // A config the callback keeps is checked against the snapshot of the same object, or else of
      // the only config with its name, and isn't scoped again. An added one is scoped as `configs`
      const snapshots = new Map(configs.map((config) => [config, cloneConfig(config)]))
      const snapshotsByName = new Map<string, TypedConfig | undefined>()
      for (const [config, snapshot] of snapshots) {
        if (config.name !== undefined) {
          snapshotsByName.set(config.name, snapshotsByName.has(config.name) ? undefined : snapshot)
        }
      }
      const context = getContext()
      const result = checkResolvedResult(await callback(configs)) ?? configs
      const plugins = getPlugins(result)
      let added = 0
      configs = result.flatMap((config) => {
        const original =
          snapshots.get(config) ??
          (typeof config.name === 'string' ? snapshotsByName.get(config.name) : undefined)
        named.push({
          subjects: ['`.onResolved()`'],
          rules: Object.keys(config.rules ?? {}).filter(
            (rule) => !Object.hasOwn(original?.rules ?? {}, rule),
          ),
        })
        if (original === undefined) {
          const copy = cloneConfig(config)
          nameUserConfig(copy, 'onResolved', [added])
          added += 1
          normalizeUserConfig(copy, 'onResolved', context)
          return scopeUserConfig(copy, 'onResolved', { ...context, plugins })
        }
        checkUserConfig(config, 'onResolved', { ...context, plugins }, { original })
        return [config]
      })
    }
    configs = await this.#finalize(configs)
    checkRemovedPlugins(configs, removedPlugins)
    const plugins = getPlugins(configs)
    for (const { subjects, rules } of named) {
      checkRuleNames(subjects, rules, plugins, this.#context.pluginOffOptions)
    }
    for (const { subjects, unmatched = [] } of named) {
      const [rule] = unmatched
      if (rule === undefined) {
        continue
      }
      if (FORMATTING_RULES.has(rule) && !this.#context.allowFormattingRules.includes(rule)) {
        fail(
          [...subjects, formatNames([rule])],
          'is a formatting rule, which the configs leave out unless `allowFormattingRules` lists it, so this changes nothing. List it in `allowFormattingRules`, and turn it on with `configs` or `.append()` if no preset does',
        )
      }
      fail(
        [...subjects, formatNames([rule])],
        'turns on a rule that no config turns on, so it changes nothing. Turn it on with `configs` or `.append()`',
      )
    }
    // ESLint awaits a composer in an array and reads the configs as one config object, named by
    // `name` in its error. Not enumerable, so neither is a key of the configs
    Object.defineProperties(configs, {
      name: { value: UNAWAITED_KEY },
      files: { value: ['**/*.*'] },
    })
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- A `TypedConfig` only types `rules` more narrowly, as `undefined` when absent, which ESLint takes
    return configs as Array<Linter.Config>
  }
}
