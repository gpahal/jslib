import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Config as PrettierConfig } from 'prettier'

import { readJsonFile } from '@gpahal/internal/node/json'
import { optionsObject, required } from '@gpahal/internal/node/options'
import { assertValid, plainObject, typeCheck } from '@gpahal/internal/node/zod'
import { isArrayOf, uniqueBy } from '@gpahal/std/arrays'
import { describeValue, formatMessage, formatNames, getErrorCode } from '@gpahal/std/errors'
import { once } from '@gpahal/std/functions'
import { isPlainObject, isRecord, omitUndefinedValues } from '@gpahal/std/objects'
import type { OmitUndefinedValues } from '@gpahal/std/objects'

import type { Config, ConfigInput, Override } from '@/internal/types'

export const PREFIX = '@gpahal/prettier-config'

const PACKAGE_NAME = '@gpahal/prettier-config'

export const TAILWIND_PLUGIN = 'prettier-plugin-tailwindcss'

type PluginEntry = NonNullable<PrettierConfig['plugins']>[number]
type PrettierOverride = NonNullable<PrettierConfig['overrides']>[number]

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * Rejects empty globs, which match no file. Built lazily, so the default config loads no Zod
 */
const getOverrideSchema = once(() => {
  // Not `stringOrStrings`, whose error for a bad item names only the item
  const globsCheck = typeCheck<Override['files']>(
    (value) => isNonEmptyString(value) || (isArrayOf(value, isNonEmptyString) && value.length > 0),
    { expected: 'a non-empty string or a non-empty array of non-empty strings' },
  )
  return optionsObject<Override>(
    {
      files: required(globsCheck),
      excludeFiles: globsCheck,
      options: plainObject({ expected: 'an object of Prettier options' }),
    },
    { expected: 'an object with `files`' },
  )
})

/**
 * The subjects of an error about a config's key, outer first
 */
export type KeySubjects = (key: string) => ReadonlyArray<string>

/**
 * Check each override. Any unknown key throws, since an override is copied with only its known
 * keys. Returns copies, which is what to read.
 *
 * @throws TypeError naming the override's index as `subjectsOf` gives it, then the key.
 */
export function checkOverrides(
  overrides: ReadonlyArray<unknown>,
  subjectsOf: KeySubjects,
): Array<Override> {
  return overrides.map((override, i) => {
    const checked = assertValid(getOverrideSchema(), override, {
      prefix: PREFIX,
      subject: subjectsOf(`overrides[${i}]`).join(': '),
    })
    if (checked.options !== undefined) {
      const optionSubjectsOf: KeySubjects = (key) => subjectsOf(`overrides[${i}].options.${key}`)
      // The type rules it out, but a JavaScript config can still set it
      const options: Readonly<Record<string, unknown>> = checked.options
      if (options['overrides'] !== undefined) {
        throw new TypeError(
          formatMessage(
            PREFIX,
            optionSubjectsOf('overrides'),
            "isn't taken, since Prettier ignores an override's own overrides. Add them to the list this override is in",
          ),
        )
      }
      checkPlugins(checked.options.plugins, optionSubjectsOf)
    }
    return checked
  })
}

/**
 * A string would otherwise be read as a list of characters
 */
function checkPlugins(plugins: unknown, subjectsOf: KeySubjects): void {
  checkList(plugins, 'an array of plugins', () => subjectsOf('plugins'))
  if (!Array.isArray(plugins)) {
    return
  }
  const index = plugins.findIndex(
    (plugin: unknown) => typeof plugin !== 'string' && !isRecord(plugin),
  )
  if (index !== -1) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        subjectsOf(`plugins[${index}]`),
        `expected a plugin's name or path, a URL or a plugin object, received ${describeValue(plugins[index])}`,
      ),
    )
  }
}

function checkList(value: unknown, expected: string, subjects: () => ReadonlyArray<string>): void {
  if (value !== undefined && !Array.isArray(value)) {
    throw new TypeError(
      formatMessage(PREFIX, subjects(), `expected ${expected}, received ${describeValue(value)}`),
    )
  }
}

/**
 * Check a config's `plugins` and `overrides`. Returns a copy with the checked overrides, which is
 * what to read.
 *
 * @throws TypeError naming the key as `subjectsOf` gives it.
 */
export function checkConfigLists<T extends ConfigInput>(config: T, subjectsOf: KeySubjects): T {
  const { plugins, overrides }: { plugins?: unknown; overrides?: unknown } = config
  checkPlugins(plugins, subjectsOf)
  checkList(overrides, 'an array of overrides', () => subjectsOf('overrides'))
  // Without a prototype, so a list left out reads as `undefined`, not as an inherited value. Not
  // returned as a literal, whose type would reject `__proto__` as an unknown key
  const copy = {
    __proto__: null,
    ...config,
    ...(Array.isArray(overrides) && { overrides: checkOverrides(overrides, subjectsOf) }),
  }
  return copy
}

/**
 * A copy without `undefined` values, which mean an option isn't set, and with lists copied, so
 * configs don't share them
 */
export function copyOptions<T extends object>(options: T): OmitUndefinedValues<T> {
  // Checked options have no prototype; a config's options get `Object.prototype`, as a literal's
  // do. A spread defines each key, so a JSON `__proto__` key stays an own key
  const copy = { ...omitUndefinedValues<object>(options) }
  for (const [key, value] of Object.entries(copy)) {
    if (Array.isArray(value)) {
      Object.assign(copy, { [key]: [...(value as ReadonlyArray<unknown>)] })
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Only arrays changed, each to a copy
  return copy as OmitUndefinedValues<T>
}

export function copyOverride({ files, excludeFiles, options }: Override): PrettierOverride {
  return {
    files: copyFiles(files),
    ...(excludeFiles !== undefined && { excludeFiles: copyFiles(excludeFiles) }),
    ...(options !== undefined && { options: copyOptions(options) }),
  }
}

function copyFiles(files: string | ReadonlyArray<string>): string | Array<string> {
  return typeof files === 'string' ? files : [...files]
}

/**
 * By the folder a lookup starts from, since each plugin is looked up per scope and per override on
 * every config load
 */
const packageNamesByFolder = new Map<string, string | undefined>()

/**
 * The `name` in the nearest `package.json` above `filePath`. Never throws
 */
function packageNameOf(filePath: string): string | undefined {
  const folder = path.dirname(filePath)
  if (!packageNamesByFolder.has(folder)) {
    packageNamesByFolder.set(folder, readPackageName(folder))
  }
  return packageNamesByFolder.get(folder)
}

/**
 * Walks up only past a missing `package.json`. One that can't be read or parsed, or has no `name`,
 * gives `undefined`, since a folder above it isn't the plugin's package
 */
function readPackageName(folder: string): string | undefined {
  for (let dir = folder; ; dir = path.dirname(dir)) {
    let manifest: unknown
    try {
      manifest = readJsonFile(path.join(dir, 'package.json'))
    } catch (error) {
      if (getErrorCode(error) === 'ENOENT' && path.dirname(dir) !== dir) {
        continue
      }
      return undefined
    }
    return isRecord(manifest) && typeof manifest['name'] === 'string' ? manifest['name'] : undefined
  }
}

/**
 * The package that a specifier or path names or points into. An absolute path without a
 * `node_modules` segment, as a linked install gives, uses its nearest `package.json`
 */
function packageOfSpecifier(specifier: string): string | undefined {
  const segments = specifier.split(/[\\/]/)
  const index = segments.lastIndexOf('node_modules')
  if (index !== -1) {
    return packageAt(segments, index + 1)
  }
  return path.isAbsolute(specifier) ? packageNameOf(specifier) : packageAt(segments, 0)
}

function packageAt(segments: ReadonlyArray<string>, index: number): string | undefined {
  const first = segments[index]
  const second = segments[index + 1]
  return second !== undefined && first?.startsWith('@') === true ? `${first}/${second}` : first
}

/**
 * `undefined` for a plugin object
 */
export function packageOfPlugin(plugin: PluginEntry): string | undefined {
  if (typeof plugin === 'string') {
    const url = plugin.startsWith('file:') ? URL.parse(plugin) : null
    return packageOfSpecifier(url === null ? plugin : pathOfUrl(url))
  }
  return plugin instanceof URL ? packageOfSpecifier(pathOfUrl(plugin)) : undefined
}

/**
 * The path of a `file:` URL, or else, as for one with a host on POSIX, the URL's path
 */
function pathOfUrl(url: URL): string {
  if (url.protocol === 'file:') {
    try {
      return fileURLToPath(url)
    } catch {
      // A URL that isn't a local path, matched by its segments alone
    }
  }
  return url.pathname
}

/**
 * A plugin object counts by the Tailwind options it declares, so the plugin needn't be loaded to
 * tell
 */
export function isTailwindPlugin(plugin: PluginEntry): boolean {
  return isTailwindPluginOf(plugin, packageOfPlugin(plugin))
}

function isTailwindPluginOf(plugin: PluginEntry, packageName: string | undefined): boolean {
  return typeof plugin === 'string' || plugin instanceof URL
    ? packageName === TAILWIND_PLUGIN
    : isRecord(plugin.options) && Object.hasOwn(plugin.options, 'tailwindFunctions')
}

/**
 * The plugins that must follow prettier-plugin-tailwindcss, in their required order. Before it,
 * Prettier formats with the Tailwind plugin's parsers, so they do nothing. prettier-plugin-classnames
 * documents this order:
 * https://github.com/ony3000/prettier-plugin-classnames#compatibility-with-other-prettier-plugins
 */
const AFTER_TAILWIND_PLUGINS: ReadonlyArray<string> = [
  'prettier-plugin-classnames',
  'prettier-plugin-merge',
]

/**
 * Each plugin once, in the order it first appears, with prettier-plugin-tailwindcss after the
 * others, since it wraps the parsers of the plugins before it, and {@link AFTER_TAILWIND_PLUGINS}
 * after it. Plugin objects aren't matched to them. A path in `pluginNames` counts as its name
 */
export function orderPlugins(
  plugins: ReadonlyArray<PluginEntry>,
  pluginNames: PluginNames,
): Array<PluginEntry> {
  const unique = uniqueBy(plugins, (plugin) => pluginKey(plugin, pluginNames))
  // 0 for the other plugins, 1 for the Tailwind plugin, and 2 on for the after-Tailwind plugins
  const ranked = unique.map((plugin) => {
    const packageName = packageOfPlugin(plugin)
    if (isTailwindPluginOf(plugin, packageName)) {
      return { plugin, rank: 1 }
    }
    const index = packageName === undefined ? -1 : AFTER_TAILWIND_PLUGINS.indexOf(packageName)
    return { plugin, rank: index === -1 ? 0 : 2 + index }
  })
  // Without the Tailwind plugin, the after-Tailwind plugins keep their place
  if (ranked.every(({ rank }) => rank !== 1)) {
    return unique
  }
  return ranked.toSorted((a, b) => a.rank - b.rank).map(({ plugin }) => plugin)
}

/**
 * The package names that `defineConfig` resolved from `root`, by path, so a plugin counts once with
 * a config that names it, as Prettier would otherwise load both
 */
export type PluginNames = ReadonlyMap<string, string>

export const NO_PLUGIN_NAMES: PluginNames = new Map()

/**
 * The plugin names of each config that `defineConfig` or `mergeConfigs` returned, so a merge
 * depends only on the configs it's given
 */
const pluginNamesByConfig = new WeakMap<object, PluginNames>()

/**
 * Returns `config`
 */
export function withPluginNames<T extends Config>(config: T, pluginNames: PluginNames): T {
  if (pluginNames.size > 0) {
    pluginNamesByConfig.set(config, pluginNames)
  }
  return config
}

/**
 * The plugin names of all `configs`, a later config's winning for a path
 */
export function pluginNamesOf(configs: ReadonlyArray<ConfigInput>): PluginNames {
  const names = new Map<string, string>()
  for (const config of configs) {
    // `WeakMap#get` gives `undefined` for a value that isn't an object, which the checks reject
    const configNames = pluginNamesByConfig.get(config) ?? NO_PLUGIN_NAMES
    for (const [pluginPath, name] of configNames) {
      names.set(pluginPath, name)
    }
  }
  return names
}

/**
 * What {@link orderPlugins} keeps a plugin once by
 */
function pluginKey(plugin: PluginEntry, pluginNames: PluginNames): unknown {
  if (plugin instanceof URL) {
    return plugin.href
  }
  return typeof plugin === 'string' ? (pluginNames.get(plugin) ?? plugin) : plugin
}

/**
 * Add a config's `plugins` to each override's, which Prettier would otherwise apply in place of the
 * config's. Changes the overrides, which must be copies
 */
export function inheritPlugins(
  plugins: ReadonlyArray<PluginEntry>,
  overrides: ReadonlyArray<PrettierOverride>,
  pluginNames: PluginNames,
): void {
  for (const override of overrides) {
    if (override.options?.plugins !== undefined) {
      override.options.plugins = orderPlugins(
        [...plugins, ...override.options.plugins],
        pluginNames,
      )
    }
  }
}

export const SORT_IMPORTS_PLUGIN = '@ianvs/prettier-plugin-sort-imports'

const CLASSNAMES_PLUGIN = 'prettier-plugin-classnames'
const MERGE_PLUGIN = 'prettier-plugin-merge'
const OXC_PLUGIN = '@prettier/plugin-oxc'
const ORGANIZE_IMPORTS_PLUGIN = 'prettier-plugin-organize-imports'

export const TAILWIND_PLUGIN_TAKEN: string = `\`${TAILWIND_PLUGIN}\` isn't taken in \`options\` or overrides. Turn it on with \`tailwindcss\`, which checks that it can load the import sorter`

function tailwindWithWrapper(wrapperConfig: number, config: number): string {
  const fix =
    'Turn the Tailwind plugin on with `tailwindcss` in the `defineConfig` call that sorts imports'
  return wrapperConfig === config
    ? `this config's import sorter is the wrapper that \`defineConfig\` adds without \`tailwindcss\`, which \`${TAILWIND_PLUGIN}\` can't compose, so imports would stay unsorted. ${fix}`
    : `\`${TAILWIND_PLUGIN}\` can't compose the import sorter's wrapper of config ${wrapperConfig + 1}, which \`defineConfig\` built without \`tailwindcss\`, so imports would stay unsorted. ${fix}`
}

/**
 * Plugins with parsers for the languages whose imports the sorter sorts. Prettier formats with the
 * parser of the last plugin that defines it, so in either order, one of them replaces the other's
 */
const SORTER_PARSER_PLUGINS: ReadonlySet<string> = new Set([
  'prettier-plugin-jsdoc',
  OXC_PLUGIN,
  ORGANIZE_IMPORTS_PLUGIN,
  CLASSNAMES_PLUGIN,
])

/**
 * The wrapper leaves out the parsers whose plugins don't resolve. The Tailwind plugin composes only
 * the sorter itself
 */
export type SorterEntry = 'none' | 'wrapper' | 'sorter'

/**
 * The sorter itself wins over the wrapper. `mergeConfigs` throws on a sorter given by name next to
 * the wrapper, so both are there only for a sorter given by path or as a plugin object. A wrapper
 * counts from any installed copy of this package, since a shared config may be built by another
 */
function sorterOf(plugins: ReadonlyArray<PluginEntry>, sorterWrapper: string): SorterEntry {
  const isSorter = (plugin: PluginEntry) =>
    (typeof plugin === 'string' || plugin instanceof URL
      ? packageOfPlugin(plugin)
      : Reflect.get(plugin, 'name')) === SORT_IMPORTS_PLUGIN
  if (plugins.some(isSorter)) {
    return 'sorter'
  }
  return plugins.some((plugin) => isSorterWrapper(plugin, sorterWrapper)) ? 'wrapper' : 'none'
}

function isSorterWrapper(plugin: PluginEntry, sorterWrapper: string): boolean {
  return plugin === sorterWrapper || isOwnPluginModule(plugin, 'sort-imports')
}

/**
 * A path or URL of the plugin module `internal/<name>` of any installed copy of this package
 */
function isOwnPluginModule(plugin: PluginEntry, name: string): boolean {
  let pluginPath: string
  if (plugin instanceof URL) {
    pluginPath = pathOfUrl(plugin)
  } else if (typeof plugin === 'string') {
    const url = plugin.startsWith('file:') ? URL.parse(plugin) : null
    pluginPath = url === null ? plugin : pathOfUrl(url)
  } else {
    return false
  }
  const [folder, file] = pluginPath.split(/[\\/]/).slice(-2)
  return (
    folder === 'internal' &&
    /^(.+)\.[cm]?[jt]s$/.exec(file ?? '')?.[1] === name &&
    packageOfSpecifier(pluginPath) === PACKAGE_NAME
  )
}

/**
 * The configs that `defineConfig` returned
 */
const presetConfigs = new WeakSet<object>()

/**
 * Returns `config`
 */
export function withPreset<T extends Config>(config: T): T {
  presetConfigs.add(config)
  return config
}

/**
 * Whether `plugins` have a plugin module that only `defineConfig` adds, the import sorter's wrapper
 * or the GitHub alerts plugin, as a copy or merge of a config it returned does
 */
function hasPresetModule(plugins: ReadonlyArray<PluginEntry>, sorterWrapper: string): boolean {
  return plugins.some(
    (plugin) =>
      isSorterWrapper(plugin, sorterWrapper) || isOwnPluginModule(plugin, 'github-alerts'),
  )
}

/**
 * The plugins that `defineConfig` adds by path, or for the import sorter by its wrapper's path
 */
const PRESET_PLUGINS: ReadonlySet<string> = new Set([
  SORT_IMPORTS_PLUGIN,
  'prettier-plugin-packagejson',
  'prettier-plugin-astro',
  TAILWIND_PLUGIN,
])

/**
 * The package of {@link PRESET_PLUGINS} that a plugin given by path or URL loads, as `defineConfig`
 * adds them, or `undefined`
 */
function presetPluginOf(plugin: PluginEntry, sorterWrapper: string): string | undefined {
  if (isSorterWrapper(plugin, sorterWrapper)) {
    return SORT_IMPORTS_PLUGIN
  }
  if (typeof plugin === 'string' && isPackageSpecifier(plugin)) {
    return undefined
  }
  const name = packageOfPlugin(plugin)
  return name !== undefined && PRESET_PLUGINS.has(name) ? name : undefined
}

/**
 * A plugin given by its package name, or a path relative to it, which Prettier resolves itself
 */
export function isPackageSpecifier(plugin: string): boolean {
  return !path.isAbsolute(plugin) && !/^[a-z][\d+.a-z-]*:/i.test(plugin)
}

/**
 * A list of the config at `config`, and with `preset` its top-level `plugins` of a config that
 * `defineConfig` built
 */
type IndexedPluginList = PluginList & { config: number; preset?: boolean }

/**
 * Each of {@link PRESET_PLUGINS} that the `plugins` of a list with `preset` add, by its first
 * config and its key
 */
function presetPluginsOf(
  lists: ReadonlyArray<IndexedPluginList>,
  sorterWrapper: string,
  pluginNames: PluginNames,
): Map<string, { config: number; key: unknown }> {
  const presets = new Map<string, { config: number; key: unknown }>()
  for (const { plugins = [], config, preset = false } of lists) {
    if (!preset) {
      continue
    }
    for (const plugin of plugins) {
      const name = presetPluginOf(plugin, sorterWrapper)
      if (name !== undefined && !presets.has(name)) {
        presets.set(name, { config, key: pluginKey(plugin, pluginNames) })
      }
    }
  }
  return presets
}

/**
 * Prettier would load a plugin given by name next to the copy that a preset adds, and the plain
 * one would replace the preset's, such as the import sorter's wrapper. The preset's plugins are
 * those of the `plugins` of a list with `preset`. A name that `defineConfig` resolved to the
 * preset's path counts as that path
 *
 * @throws TypeError naming the plugin given by name, as its list's `subjectsOf` gives it.
 */
function checkPresetDuplicates(
  lists: ReadonlyArray<IndexedPluginList>,
  sorterWrapper: string,
  pluginNames: PluginNames,
): void {
  const presets = presetPluginsOf(lists, sorterWrapper, pluginNames)
  for (const { plugins = [], subjectsOf, config } of lists) {
    for (const [index, plugin] of plugins.entries()) {
      const name =
        typeof plugin === 'string' && isPackageSpecifier(plugin)
          ? packageOfPlugin(plugin)
          : undefined
      const preset = name === undefined ? undefined : presets.get(name)
      if (
        name !== undefined &&
        preset !== undefined &&
        preset.key !== pluginKey(plugin, pluginNames)
      ) {
        const owner = preset.config === config ? 'this config' : `config ${preset.config + 1}`
        throw new TypeError(
          formatMessage(
            PREFIX,
            subjectsOf(index),
            `${formatNames([name])} is added by ${owner}'s preset. Remove it`,
          ),
        )
      }
    }
  }
}

export type PluginList = {
  plugins: ReadonlyArray<PluginEntry> | undefined
  subjectsOf: (index: number) => ReadonlyArray<string>
}

/**
 * Check that no plugin silently turns off import sorting or Tailwind class sorting:
 *
 * - With the import sorter on, the plugins of {@link SORTER_PARSER_PLUGINS} replace its parsers,
 *   unless prettier-plugin-merge comes after them and runs each, which works with the wrapper.
 * - prettier-plugin-merge formats with each plugin as a range, by passing `originalText`, which
 *   prettier-plugin-organize-imports skips, so it never runs before prettier-plugin-merge.
 * - With the Tailwind plugin, prettier-plugin-classnames, which goes after it, replaces its
 *   parsers, unless prettier-plugin-merge runs both.
 * - prettier-plugin-merge reads every parser of the plugins before it, and fails on the sorter's
 *   parsers for plugins that aren't installed. The wrapper leaves them out, but the Tailwind plugin
 *   loads the sorter itself.
 *
 * The plugins of all `configLists` count together, and an override's follow them in its files,
 * each list judged as {@link orderPlugins} orders it, as the config gets it. `tailwindcss` says the
 * config adds the Tailwind plugin; one in the lists counts too. Plugin objects aren't matched.
 *
 * @throws TypeError naming the plugin as its list's `subjectsOf` gives it.
 */
export function checkPluginConflicts(
  { sorter, tailwindcss }: { sorter: SorterEntry; tailwindcss: boolean },
  configLists: ReadonlyArray<PluginList>,
  overrideLists: ReadonlyArray<PluginList>,
  pluginNames: PluginNames,
): void {
  // The Tailwind plugin that `tailwindcss` adds, which moves the after-Tailwind plugins after it
  const configPlugins = [
    ...(tailwindcss ? [TAILWIND_PLUGIN] : []),
    ...configLists.flatMap(({ plugins }) => plugins ?? []),
  ]
  const configScope = orderPlugins(configPlugins, pluginNames)
  const scopes = [
    ...configLists.map((list) => ({ list, scope: configScope })),
    ...overrideLists.map((list) => ({
      list,
      scope: orderPlugins([...configScope, ...(list.plugins ?? [])], pluginNames),
    })),
  ]
  for (const { list, scope } of scopes) {
    const packages = scope.map((plugin) => packageOfPlugin(plugin))
    const hasTailwind = scope.some((plugin) => isTailwindPlugin(plugin))
    const lastMerge = packages.lastIndexOf(MERGE_PLUGIN)
    const keys = scope.map((plugin) => pluginKey(plugin, pluginNames))
    const plugins = list.plugins ?? []
    for (const [index, plugin] of plugins.entries()) {
      // A repeated plugin takes the place of its first appearance
      const position = keys.indexOf(pluginKey(plugin, pluginNames))
      const description = conflictOf(packages[position], {
        sorter,
        hasTailwind,
        hasMerge: lastMerge !== -1,
        hasMergeAfter: lastMerge > position,
      })
      if (description !== undefined) {
        throw new TypeError(formatMessage(PREFIX, list.subjectsOf(index), description))
      }
    }
  }
}

function conflictOf(
  name: string | undefined,
  {
    sorter,
    hasTailwind,
    hasMerge,
    hasMergeAfter,
  }: { sorter: SorterEntry; hasTailwind: boolean; hasMerge: boolean; hasMergeAfter: boolean },
): string | undefined {
  if (name === undefined) {
    return undefined
  }
  if (name === ORGANIZE_IMPORTS_PLUGIN) {
    return organizeImportsConflict({ sorter, hasMergeAfter })
  }
  if (
    sorter !== 'none' &&
    SORTER_PARSER_PLUGINS.has(name) &&
    !(sorter === 'wrapper' && hasMergeAfter)
  ) {
    const fixes = [
      ...(name === OXC_PLUGIN
        ? [
            "leave it out of `plugins` and set `parser: 'oxc-ts'` in an override for the sorter to load it",
          ]
        : []),
      ...(sorter === 'wrapper' ? [`add \`${MERGE_PLUGIN}\` after it to run both`] : []),
      'set `sortImports: false`',
    ]
    const fix =
      fixes.length === 1
        ? 'Set `sortImports: false` to use it'
        : `To use it, ${new Intl.ListFormat('en', { type: 'disjunction' }).format(fixes)}`
    return `\`${name}\` replaces the import sorter's parsers, so imports would stay unsorted. ${fix}`
  }
  if (hasTailwind && name === CLASSNAMES_PLUGIN && !hasMerge) {
    return `\`${CLASSNAMES_PLUGIN}\` replaces \`${TAILWIND_PLUGIN}\`'s parsers, so classes would stay unsorted. Add \`${MERGE_PLUGIN}\`, which runs both`
  }
  if (sorter === 'sorter' && name === MERGE_PLUGIN) {
    return `\`${MERGE_PLUGIN}\` fails with the import sorter that \`${TAILWIND_PLUGIN}\` loads, which has parsers for plugins that may not be installed. Set \`sortImports: false\` to use it`
  }
  return undefined
}

function organizeImportsConflict({
  sorter,
  hasMergeAfter,
}: {
  sorter: SorterEntry
  hasMergeAfter: boolean
}): string | undefined {
  if (sorter !== 'none') {
    const fix = `Set \`sortImports: false\` to use \`${ORGANIZE_IMPORTS_PLUGIN}\``
    return `\`${ORGANIZE_IMPORTS_PLUGIN}\` replaces the import sorter's parsers, so imports would stay unsorted. ${hasMergeAfter ? `${fix}, without \`${MERGE_PLUGIN}\` after it, which keeps it from running` : fix}`
  }
  return hasMergeAfter
    ? `\`${MERGE_PLUGIN}\`, after it, formats with it as a range, which it skips, so imports would stay as they are. Remove \`${MERGE_PLUGIN}\` to use \`${ORGANIZE_IMPORTS_PLUGIN}\``
    : undefined
}

/**
 * Merge Prettier configs as `mergeConfigs` describes, without checking them
 */
export function mergeConfigList(
  configs: ReadonlyArray<ConfigInput>,
  pluginNames: PluginNames,
): Config {
  let merged: Config = {}
  const configPlugins: Array<PluginEntry> = []
  const overrides: Array<PrettierOverride> = []
  for (const { plugins: pluginList, overrides: overrideList, ...options } of configs) {
    // A spread, not `Object.assign`, whose setter would read a JSON `__proto__` key as the
    // prototype
    merged = { ...merged, ...copyOptions(options) }
    configPlugins.push(...(pluginList ?? []))
    overrides.push(...(overrideList ?? []).map((override) => copyOverride(override)))
  }
  const plugins = orderPlugins(configPlugins, pluginNames)
  inheritPlugins(plugins, overrides, pluginNames)
  return {
    ...merged,
    ...(plugins.length > 0 && { plugins }),
    ...(overrides.length > 0 && { overrides }),
  }
}

/**
 * A namespace has no prototype, so it would pass as a plain object
 */
function isModuleNamespace(value: unknown): boolean {
  return (
    isRecord(value) &&
    (Reflect.get(value, Symbol.toStringTag) === 'Module' || Object.hasOwn(value, '__esModule'))
  )
}

function mergedConfigSubject(i: number): string {
  return `config ${i + 1} given to \`mergeConfigs\``
}

/**
 * Check the configs that `mergeConfigs` merges. Returns the copies to merge.
 *
 * @throws TypeError on an invalid config, plugin or override, a plugin given by name that a
 *   config's preset adds, a plugin conflict, or the Tailwind plugin with the import sorter's
 *   wrapper, which it can't compose.
 */
export function checkConfigsToMerge(
  configs: ReadonlyArray<ConfigInput>,
  sorterWrapper: string,
  pluginNames: PluginNames,
): Array<ConfigInput> {
  const built = configs.map((config) => presetConfigs.has(config))
  const checked = configs.map((config, i) => {
    const untypedConfig: unknown = config
    const subject = mergedConfigSubject(i)
    if (isModuleNamespace(untypedConfig)) {
      throw new TypeError(
        formatMessage(
          PREFIX,
          [subject],
          'expected a config, received a module namespace. Pass its default export',
        ),
      )
    }
    if (!isPlainObject(untypedConfig)) {
      throw new TypeError(
        formatMessage(
          PREFIX,
          [subject],
          `expected a plain object of Prettier options, received ${describeValue(untypedConfig)}`,
        ),
      )
    }
    return checkConfigLists(config, (key) => [subject, formatNames([key])])
  })
  const configLists = checked.map(({ plugins }, i) => ({
    plugins,
    config: i,
    preset: built[i] === true || hasPresetModule(plugins ?? [], sorterWrapper),
    subjectsOf: (index: number) => [mergedConfigSubject(i), formatNames([`plugins[${index}]`])],
  }))
  const overrideLists = checked.flatMap(({ overrides }, i) =>
    (overrides ?? []).map(({ options }, j) => ({
      plugins: options?.plugins,
      config: i,
      subjectsOf: (index: number) => [
        mergedConfigSubject(i),
        formatNames([`overrides[${j}].options.plugins[${index}]`]),
      ],
    })),
  )
  const lists = [...configLists, ...overrideLists]
  checkPresetDuplicates(lists, sorterWrapper, pluginNames)
  const sorter = sorterOf(
    configLists.flatMap(({ plugins }) => plugins ?? []),
    sorterWrapper,
  )
  if (sorter === 'wrapper') {
    const wrapperConfig = configLists.findIndex(
      ({ plugins }) => sorterOf(plugins ?? [], sorterWrapper) === 'wrapper',
    )
    for (const { plugins, subjectsOf, config } of lists) {
      const index = (plugins ?? []).findIndex((plugin) => isTailwindPlugin(plugin))
      if (index !== -1) {
        throw new TypeError(
          formatMessage(PREFIX, subjectsOf(index), tailwindWithWrapper(wrapperConfig, config)),
        )
      }
    }
  }
  checkPluginConflicts({ sorter, tailwindcss: false }, configLists, overrideLists, pluginNames)
  return checked
}
