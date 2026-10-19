import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { types } from 'node:util'

// eslint-disable-next-line e18e/ban-dependencies -- Use Stylelint's data loaders to preserve its config formats and parsing behavior
import { defaultLoaders } from 'cosmiconfig'

import type { Config } from 'stylelint'

import { toArray } from '@gpahal/std/arrays'
import {
  describeValue,
  formatMessage,
  formatNames,
  getErrorMessage,
  getErrorReason,
} from '@gpahal/std/errors'
import { clonePlain, isPlainObject, omitUndefinedValues } from '@gpahal/std/objects'
import { escapeControls } from '@gpahal/std/strings'

import { isBaseConfigFile } from '@/internal/base-rules'
import { checkOverrideFiles, FIX_REJECTION, PREFIX } from '@/internal/options'
import { toOverride, toStylelintExtends } from '@/internal/overrides'
import { toOwnRules } from '@/internal/own-rules'
import {
  checkReferencePathsExist,
  isPathEntry,
  normalizeConfigPaths,
  overrideGlobs,
  ownConfig,
  resolveModulePath,
} from '@/internal/paths'
import {
  mergeDeepWith,
  type StylelintExtendedConfig,
  type StylelintExtends,
  type StylelintOverride,
} from '@/internal/rules'

export const REPORT_KEYS = [
  'reportNeedlessDisables',
  'reportInvalidScopeDisables',
  'reportDescriptionlessDisables',
  'reportUnscopedDisables',
] as const

type Reports = Pick<Config, (typeof REPORT_KEYS)[number]>

export type ExtendedOptions = {
  ignoreFiles?: Config['ignoreFiles'] | undefined
  referenceFiles?: Config['referenceFiles'] | undefined
  languageOptions?: Config['languageOptions'] | undefined
  reports?: Reports | undefined
  /**
   * The configs' top-level rules, later ones replacing earlier ones
   */
  rules?: Record<string, unknown> | undefined
}

/**
 * The base configs the preset builds on, already applied with its changes, so their rules aren't
 * applied again over the preset's
 */
const baseConfigs = new WeakSet<StylelintExtendedConfig>()

/**
 * Load each config once per call; keep normalized clones for Stylelint's rule and plugin merging
 */
export async function loadExtends(
  extended: StylelintExtends | undefined,
  root: string,
  userOverrides: ReadonlyArray<StylelintOverride> = [],
): Promise<{
  configs: Array<StylelintExtendedConfig>
  options: ExtendedOptions
  overrides: Array<StylelintOverride>
  overrideConfigs: Array<StylelintExtendedConfig>
}> {
  const modules = new Map<string, unknown>()
  const completed = new Map<
    StylelintExtendedConfig,
    Map<string, { config: StylelintExtendedConfig; height: number }>
  >()
  const heights = new Map<StylelintExtendedConfig, number>()
  const active = new Set<string | StylelintExtendedConfig>()
  // A call reads each file once, so all its uses see the same revision
  const loadModule = async (filename: string): Promise<unknown> => {
    if (modules.has(filename)) {
      return modules.get(filename)
    }
    const value = await loadConfigFile(filename)
    modules.set(filename, value)
    return value
  }
  const loadEntry = async (
    entry: string,
    base: string,
    fail: (description: string, cause?: unknown) => never,
  ): Promise<{ config: StylelintExtendedConfig; filename: string; directory: string }> => {
    const unsupported = unsupportedEntryProblem(entry)
    if (unsupported !== undefined) {
      return fail(unsupported)
    }
    let located: { filename: string; directory: string } | undefined
    try {
      located = locateConfig(entry, base)
    } catch (error) {
      return fail(`can't load ${formatNames([entry])}: ${loadErrorReason(error)}`, error)
    }
    if (located === undefined) {
      return fail(
        isPathEntry(entry)
          ? `can't find ${formatNames([entry])}. Pass a path to a file`
          : `can't find ${formatNames([entry])} in its package. Pass a file the package has`,
      )
    }
    let value: unknown
    try {
      value = await loadModule(located.filename)
    } catch (error) {
      return fail(`can't load ${formatNames([entry])}: ${loadErrorReason(error)}`, error)
    }
    if (!isPlainObject(value)) {
      return fail(`can't load ${formatNames([entry])}: ${notConfigProblem(value)}`)
    }
    return { config: value, ...located }
  }
  const visit = async (
    entry: string | StylelintExtendedConfig,
    base: string,
    subject: string,
    depth: number,
  ): Promise<StylelintExtendedConfig> => {
    const fail = (description: string, cause?: unknown): never => {
      throw new TypeError(
        formatMessage(PREFIX, [formatNames([subject])], description),
        cause === undefined ? undefined : { cause },
      )
    }
    if (depth > 32) {
      return fail('extends nests more than 32 deep')
    }
    let config: StylelintExtendedConfig
    let key: string | StylelintExtendedConfig = entry
    let directory = base
    if (typeof entry === 'string') {
      const loaded = await loadEntry(entry, base, fail)
      config = loaded.config
      key = loaded.filename
      directory = loaded.directory
    } else {
      const untypedEntry: unknown = entry
      if (!isPlainObject(untypedEntry)) {
        return fail(`expected a config object, received ${describeValue(entry)}`)
      }
      config = entry
    }
    if (active.has(key)) {
      return fail('extends contains a cycle')
    }
    const source = config
    const cached = completed.get(source)?.get(directory)
    if (cached !== undefined) {
      return depth + cached.height - 1 > 32
        ? fail('extends nests more than 32 deep')
        : cached.config
    }
    config = ownConfig(config)
    if (config.fix !== undefined) {
      throw new TypeError(formatMessage(PREFIX, [formatNames([`${subject}.fix`])], FIX_REJECTION))
    }
    active.add(key)
    try {
      const children: Array<StylelintExtendedConfig> = []
      let height = 1
      const childEntries = toArray(config.extends ?? [])
      for (const [index, child] of childEntries.entries()) {
        const prepared = await visit(child, directory, `${subject}.extends[${index}]`, depth + 1)
        children.push(prepared)
        height = Math.max(height, 1 + (heights.get(prepared) ?? 1))
      }
      const { extends: _extended, overrides: givenOverrides, ...own } = config
      const nestedOverrides = []
      const overrideEntries = givenOverrides ?? []
      const untypedOverrides: unknown = overrideEntries
      if (!Array.isArray(untypedOverrides)) {
        throw new TypeError(
          formatMessage(
            PREFIX,
            [formatNames([`${subject}.overrides`])],
            `expected an array of overrides, received ${describeValue(overrideEntries)}`,
          ),
        )
      }
      for (const [index, override] of overrideEntries.entries()) {
        const prepared = await visit(
          override,
          directory,
          `${subject}.overrides[${index}]`,
          depth + 1,
        )
        height = Math.max(height, 1 + (heights.get(prepared) ?? 1))
        checkOverrideFiles(override.files, `${subject}.overrides[${index}].files`)
        const { extends: overrideExtends, ...overrideKeys } = prepared
        nestedOverrides.push({
          ...omitUndefinedValues(overrideKeys),
          ...(overrideExtends !== undefined && { extends: toStylelintExtends(overrideExtends) }),
          // Stylelint matches every override's globs from the root config's folder
          files: overrideGlobs(override.files, root),
        })
      }
      const isBase = typeof key === 'string' && isBaseConfigFile(key)
      const { rules: ownRules, ...normalized } = normalizeLoadedConfig(own, directory, subject)
      const result = {
        ...normalized,
        // Under `defineConfig`, a stock rule's setting is the own rule's that replaces it
        ...(ownRules !== undefined && !isBase && { rules: toOwnRules(ownRules) }),
        ...(children.length > 0 && { extends: children }),
        ...(nestedOverrides.length > 0 && { overrides: nestedOverrides }),
      }
      const byDirectory =
        completed.get(source) ??
        new Map<string, { config: StylelintExtendedConfig; height: number }>()
      if (isBase) baseConfigs.add(result)
      byDirectory.set(directory, { config: result, height })
      completed.set(source, byDirectory)
      heights.set(result, height)
      return result
    } finally {
      active.delete(key)
    }
  }
  const configs: Array<StylelintExtendedConfig> = []
  const entries = toArray(extended ?? [])
  for (const [index, entry] of entries.entries()) {
    const config = await visit(entry, root, `extends[${index}]`, 1)
    configs.push(config)
  }
  const overrides: Array<StylelintOverride> = []
  const overrideConfigs: Array<StylelintExtendedConfig> = []
  for (const [index, override] of userOverrides.entries()) {
    const prepared = await visit(toOverride(override), root, `overrides[${index}]`, 1)
    overrideConfigs.push(prepared)
    // Stylelint applies an override's extended rules itself, and `extendedRulesOf` reads them as the
    // base its rules merge over
    const { reports, rules: _rules, ...keys } = collectOptions([prepared])
    overrides.push({
      ...prepared,
      ...omitUndefinedValues(keys),
      ...reports,
      files: override.files,
      ...(override.rules !== undefined && { rules: override.rules }),
    })
  }
  return { configs, options: collectOptions(configs), overrides, overrideConfigs }
}

/**
 * What's wrong with an `extends` entry that's a built-in module or a non-`file:` URL
 */
function unsupportedEntryProblem(entry: string): string | undefined {
  if (isBuiltin(entry)) {
    return `${formatNames([entry])} is a Node.js built-in module, not a config. Pass a path or a package name`
  }
  // A scheme of two or more characters, so a Windows path such as `C:\\a.json` isn't a URL
  if (/^[a-z][\d+.a-z-]+:/i.test(entry) && !entry.toLowerCase().startsWith('file:')) {
    return `${formatNames([entry])} is a URL, which configs can't load from. Pass a path or a package name`
  }
  return undefined
}

function notConfigProblem(value: unknown): string {
  return types.isModuleNamespaceObject(value)
    ? 'expected a config object as the default export, received a module with only named exports. Add a default export'
    : `expected a config object, received ${describeValue(value)}`
}

/**
 * The reason of a config load error, keeping the line breaks of a parse error's code frame, without
 * a nested `defineConfig`'s prefix
 */
function loadErrorReason(error: unknown): string {
  const message = getErrorMessage(error)
  const unprefixed = message.startsWith(`${PREFIX}: `) ? message.slice(PREFIX.length + 2) : message
  const lines = unprefixed.split('\n')
  const last = lines.pop() ?? ''
  return [
    ...lines.map((line) => escapeControls(line, { keepBackslashes: true })),
    getErrorReason(last),
  ].join('\n')
}

/**
 * A loaded config's own keys, without `extends` and `overrides`, with paths resolved from its folder
 *
 * @throws TypeError when a path doesn't resolve, or a `referenceFiles` path that isn't a glob
 *   doesn't exist.
 */
function normalizeLoadedConfig(
  own: Omit<StylelintExtendedConfig, 'extends' | 'overrides'>,
  directory: string,
  subject: string,
): Config {
  const normalized = normalizeConfigPaths(clonePlain(omitUndefinedValues(own)), directory, subject)
  if (own.referenceFiles !== undefined) {
    checkReferencePathsExist(own.referenceFiles, directory, `${subject}.referenceFiles`)
  }
  return normalized
}

/**
 * The latest loaded revision of each config file, by real path. A failed load is dropped, so the
 * next one tries again
 */
const configFiles = new Map<string, { hash: string; value: Promise<unknown> }>()

/**
 * The export of a config file, evaluated once per content revision. A changed ES module is
 * imported with its content hash in the URL, which Node caches for the process's lifetime, and a
 * changed CommonJS module leaves `require`'s cache first. The files a config imports aren't
 * tracked, so their changes need a new process
 */
async function loadConfigFile(filename: string): Promise<unknown> {
  const content = await fs.promises.readFile(filename)
  const hash = createHash('sha256').update(content).digest('hex')
  const cached = configFiles.get(filename)
  if (cached?.hash === hash) {
    return cached.value
  }
  const entry = { hash, value: evaluateConfigFile(filename, content.toString('utf8'), hash) }
  configFiles.set(filename, entry)
  try {
    return await entry.value
  } catch (error) {
    if (configFiles.get(filename) === entry) configFiles.delete(filename)
    throw error
  }
}

async function evaluateConfigFile(
  filename: string,
  content: string,
  hash: string,
): Promise<unknown> {
  const extension = path.extname(filename)
  const dataLoader = ['', '.yaml', '.yml'].includes(extension)
    ? defaultLoaders['.yaml']
    : extension === '.json'
      ? defaultLoaders['.json']
      : undefined
  if (dataLoader !== undefined) {
    return dataLoader(filename, content)
  }
  const require = createRequire(import.meta.url)
  const commonjs = require.cache[filename]
  const useRequire =
    filename.endsWith('.cjs') ||
    (commonjs !== undefined && !types.isModuleNamespaceObject(commonjs.exports))
  let imported: unknown
  if (useRequire) {
    Reflect.deleteProperty(require.cache, filename)
    imported = require(filename)
  } else {
    imported = await import(`${pathToFileURL(filename).href}?stylelint-config=${hash}`)
  }
  return imported !== null && typeof imported === 'object' && Object.hasOwn(imported, 'default')
    ? await Reflect.get(imported, 'default')
    : imported
}

/**
 * The real path of the config file `entry` names, the module and cycle key, with the folder its
 * paths resolve from. A path keeps `base` as given, so globs match through a symlinked root
 *
 * @throws Error when a package specifier can't be resolved, or a path can't be read.
 */
function locateConfig(
  entry: string,
  base: string,
): { filename: string; directory: string } | undefined {
  const resolved = resolveModulePath(entry, base)
  if (resolved === undefined) {
    return undefined
  }
  const filename = fs.realpathSync(resolved)
  return { filename, directory: path.dirname(isPathEntry(entry) ? resolved : filename) }
}

function collect(target: ExtendedOptions, config: StylelintExtendedConfig): void {
  config = ownConfig(config)
  if (config.ignoreFiles !== undefined) {
    target.ignoreFiles = [...toArray(target.ignoreFiles ?? []), ...toArray(config.ignoreFiles)]
  }
  if (config.referenceFiles !== undefined) {
    target.referenceFiles = [
      ...toArray(target.referenceFiles ?? []),
      ...toArray(config.referenceFiles),
    ]
  }
  target.languageOptions = mergeDeepWith(target.languageOptions, config.languageOptions)
  if (isPlainObject(config.rules)) {
    target.rules = { ...target.rules, ...config.rules }
  }
  target.reports = {
    ...target.reports,
    ...Object.fromEntries(
      REPORT_KEYS.filter((key) => config[key] !== undefined).map((key) => [key, config[key]]),
    ),
  }
}

/**
 * The rules an override's loaded `extends` configs set, later ones replacing earlier ones
 */
export function extendedRulesOf(
  extended: StylelintExtends | undefined,
): Readonly<Record<string, unknown>> {
  const configs = toArray(extended ?? []).filter((entry) => typeof entry !== 'string')
  return collectOptions(configs).rules ?? {}
}

/**
 * Shared nodes contribute once, at their last position, so a preset reused through a diamond
 * doesn't duplicate its reference loaders. Repeats within one node stay. Base configs contribute
 * nothing
 */
function collectOptions(configs: ReadonlyArray<StylelintExtendedConfig>): ExtendedOptions {
  const ordered: Array<StylelintExtendedConfig> = []
  const seen = new Set<StylelintExtendedConfig>()
  const visit = (config: StylelintExtendedConfig): void => {
    if (seen.has(config)) return
    seen.add(config)
    if (baseConfigs.has(config)) return
    ordered.push(config)
    const children = toArray(config.extends ?? []).toReversed()
    for (const child of children) {
      if (typeof child !== 'string') visit(child)
    }
  }
  for (const config of configs.toReversed()) visit(config)
  const options: ExtendedOptions = ownConfig<ExtendedOptions>({})
  for (const config of ordered.toReversed()) collect(options, config)
  return options
}
