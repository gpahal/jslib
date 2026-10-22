import fs from 'node:fs'
import path from 'node:path'

import type { Config as PrettierConfig } from 'prettier'
import type * as z from 'zod/mini'

import {
  booleanOr,
  deferred,
  listOption,
  optionsObject,
  type OptionsShape,
} from '@gpahal/internal/node/options'
import {
  isRelativePath,
  PATH_OR_FILE_URL_EXPECTED,
  PATH_OR_FILE_URL_WITHOUT_ROOT_EXPECTED,
  resolvePathOrFileUrl,
} from '@gpahal/internal/node/paths'
import { checkRoot } from '@gpahal/internal/node/root'
import { assertValid, loadZod, plainObject, typeCheck } from '@gpahal/internal/node/zod'
import { formatMessage, formatNames, getErrorReason } from '@gpahal/std/errors'
import { once } from '@gpahal/std/functions'
import { isRecord } from '@gpahal/std/objects'

import {
  checkConfigLists,
  checkOverrides,
  checkPluginConflicts,
  copyOptions,
  isNonEmptyString,
  isTailwindPlugin,
  NO_PLUGIN_NAMES,
  packageOfPlugin,
  PREFIX,
  SORT_IMPORTS_PLUGIN,
  TAILWIND_PLUGIN_TAKEN,
  type PluginList,
  type SorterEntry,
} from '@/internal/merge'
import { loadSorter } from '@/internal/plugins'
import type {
  ConfigInput,
  FileOptions,
  Override,
  PresetOptionKey,
  PrettierConfigOptions,
  SortImportsKeys,
  SortImportsOptions,
  TailwindcssManagedKey,
  TailwindcssOptions,
} from '@/internal/types'

/**
 * The option names that @ianvs/prettier-plugin-sort-imports exports, so these keys are checked
 * without loading the sorter, which loads Babel. `tests/index.test.ts` checks them against it
 */
export const SORTER_OPTION_NAMES: ReadonlyArray<string> = [
  'importOrder',
  'importOrderParserPlugins',
  'importOrderTypeScriptVersion',
  'importOrderCaseSensitive',
  'importOrderSafeSideEffects',
]

function isKnownSorterKey(key: PropertyKey): boolean {
  return typeof key === 'string' && SORTER_OPTION_NAMES.includes(key)
}

function sorterKeys(sorterPath?: string): Array<string> {
  const { options } = loadSorter(sorterPath)
  return isRecord(options) ? Object.keys(options) : []
}

function editDistance(left: string, right: string): number {
  let row = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1]
    for (let j = 0; j < right.length; j++) {
      next.push(
        Math.min(
          (next[j] ?? 0) + 1,
          (row[j + 1] ?? 0) + 1,
          (row[j] ?? 0) + (left[i] === right[j] ? 0 : 1),
        ),
      )
    }
    row = next
  }
  return row.at(-1) ?? 0
}

/**
 * Suggests a name at most two edits away and fewer than half the key's length, so a short key
 * isn't matched to an unrelated name
 */
function unknownKey(key: PropertyKey, known: ReadonlyArray<string>): string {
  const closest =
    typeof key === 'string'
      ? known
          .map((name) => ({ name, distance: editDistance(key, name) }))
          .toSorted((a, b) => a.distance - b.distance)[0]
      : undefined
  return closest !== undefined && closest.distance <= 2 && closest.distance < String(key).length / 2
    ? `unknown option. Did you mean \`${closest.name}\`?`
    : `unknown option. Known options: ${formatNames(known)}`
}

/**
 * Check `sortImports`' keys against the sorter at `sorterPath`, or this package's copy without one.
 * With `tailwindcss`, Prettier loads the sorter that the Tailwind plugin finds, which can be a
 * newer copy.
 *
 * @throws TypeError on an unknown key.
 * @throws Error when the sorter fails to load.
 */
export function checkSortImportsKeys(sortImports: object, sorterPath: string | undefined): void {
  if (Reflect.ownKeys(sortImports).every((key) => isKnownSorterKey(key))) {
    return
  }
  const z = loadZod()
  const known = sorterKeys(sorterPath)
  const keysSchema = plainObject().check(
    z.superRefine((value, context) => {
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !known.includes(key)) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: unknownKey(key, known),
            input: value,
          })
        }
      }
    }),
  )
  assertValid(z.object({ sortImports: keysSchema }), { sortImports }, { prefix: PREFIX })
}

/**
 * By the `tailwindcss` key that sets each. In `options`, they'd replace the default functions or
 * win over the `tailwindcss` keys
 */
const TAILWINDCSS_KEYS_BY_OPTION: Readonly<
  Record<TailwindcssManagedKey, keyof TailwindcssOptions>
> = {
  tailwindFunctions: 'functions',
  tailwindAttributes: 'attributes',
  tailwindStylesheet: 'entryPoint',
  tailwindEntryPoint: 'entryPoint',
  tailwindPreserveWhitespace: 'preserveWhitespace',
}

/**
 * The Tailwind plugin is left to `tailwindcss`, which checks that it can load the import sorter
 */
function checkTailwindPlugin(name: string, plugins: ConfigInput['plugins']): void {
  const pluginIndex = (plugins ?? []).findIndex((plugin) => isTailwindPlugin(plugin))
  if (pluginIndex !== -1) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [formatNames([`${name}.plugins[${pluginIndex}]`])],
        TAILWIND_PLUGIN_TAKEN,
      ),
    )
  }
}

function checkOverridePlugins(name: string, overrides: ReadonlyArray<Override> | undefined): void {
  const list = overrides ?? []
  for (const [i, override] of list.entries()) {
    checkTailwindPlugin(`${name}[${i}].options`, override.options?.plugins)
  }
}

function presetPluginPackages({
  sortImports,
  packageJson,
  astro,
}: PrettierConfigOptions): ReadonlyArray<string> {
  return [
    ...(sortImports === false ? [] : [SORT_IMPORTS_PLUGIN]),
    ...(packageJson === false ? [] : ['prettier-plugin-packagejson']),
    ...(astro === undefined || astro === false ? [] : ['prettier-plugin-astro']),
  ]
}

/**
 * A second copy of a preset plugin fails to load under pnpm, which doesn't hoist it, takes over the
 * import sorter's wrapper under npm, or loads the Astro plugin twice
 */
function checkPresetPlugins(
  presetPackages: ReadonlyArray<string>,
  pluginLists: ReadonlyArray<PluginList>,
): void {
  for (const { plugins = [], subjectsOf } of pluginLists) {
    for (const [index, plugin] of plugins.entries()) {
      const name = packageOfPlugin(plugin)
      if (name !== undefined && presetPackages.includes(name)) {
        throw new TypeError(
          formatMessage(
            PREFIX,
            subjectsOf(index),
            `${formatNames([name])} is added by the preset. Remove it`,
          ),
        )
      }
    }
  }
}

/**
 * The preset's own options but `overrides`, which Prettier would ignore among its options. Typed so
 * a new option can't be left out
 */
const PRESET_KEYS: ReadonlyArray<string> = Object.keys({
  root: true,
  astro: true,
  tailwindcss: true,
  sortImports: true,
  githubAlerts: true,
  packageJson: true,
  markdown: true,
  options: true,
} satisfies Record<PresetOptionKey, true> &
  Record<Exclude<keyof PrettierConfigOptions, 'overrides'>, true>)

function checkPresetKeys(name: string, options: Readonly<Record<string, unknown>>): void {
  const key = PRESET_KEYS.find((presetKey) => options[presetKey] !== undefined)
  if (key !== undefined) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [formatNames([`${name}.${key}`])],
        "isn't taken. Pass it at the top level",
      ),
    )
  }
}

function checkOverrideKeys(name: string, overrides: ReadonlyArray<Override> | undefined): void {
  const list = overrides ?? []
  for (const [i, override] of list.entries()) {
    if (override.options !== undefined) {
      checkPresetKeys(`${name}[${i}].options`, override.options)
    }
  }
}

/**
 * Leave the preset's keys, the Tailwind keys and the `importOrder*` keys to their options. An
 * `importOrder*` key here would replace the resolved order, lose to the `.mts` and `.cts` override
 * or set the sorter's options in two places
 */
function checkManagedKeys(name: string, options: Readonly<Record<string, unknown>>): void {
  checkPresetKeys(name, options)
  for (const [key, tailwindcssKey] of Object.entries(TAILWINDCSS_KEYS_BY_OPTION)) {
    if (options[key] !== undefined) {
      throw new TypeError(
        formatMessage(
          PREFIX,
          [formatNames([`${name}.${key}`])],
          `isn't taken. Pass \`tailwindcss: { ${tailwindcssKey} }\``,
        ),
      )
    }
  }
  const sorterKey = Object.entries(options).find(
    ([key, value]) => key.startsWith('importOrder') && value !== undefined,
  )?.[0]
  if (sorterKey === undefined) {
    return
  }
  // `sortImports` sets the key for every file, so `markdown` and `astro` get an override
  const fileOverride = FILE_OVERRIDES[name]
  const fix =
    fileOverride === undefined
      ? `Pass \`sortImports: { ${sorterKey} }\``
      : `To set it in ${fileOverride.files} only, pass \`overrides: [{ files: '${fileOverride.glob}', options: { ${sorterKey} } }]\``
  throw new TypeError(
    formatMessage(PREFIX, [formatNames([`${name}.${sorterKey}`])], `isn't taken. ${fix}`),
  )
}

const FILE_OVERRIDES: Readonly<Partial<Record<string, { files: string; glob: string }>>> = {
  markdown: { files: 'Markdown files', glob: '*.md' },
  astro: { files: 'Astro files', glob: '*.astro' },
}

function presetKeyFix(key: string): string | undefined {
  if (key.startsWith('importOrder')) {
    return `Pass \`sortImports: { ${key} }\``
  }
  const tailwindcssKey = Object.entries(TAILWINDCSS_KEYS_BY_OPTION).find(
    ([option]) => option === key,
  )?.[1]
  return tailwindcssKey === undefined ? undefined : `Pass \`tailwindcss: { ${tailwindcssKey} }\``
}

const CONFIG_KEYS: ReadonlyArray<string> = ['plugins', 'overrides', 'files', 'excludeFiles']

/**
 * Other keys of `markdown` and `astro` are left for Prettier and the plugins to check
 */
function checkFileOptions({ markdown, astro }: PrettierConfigOptions): void {
  const fileOptionsByName = Object.entries({ markdown, astro })
  for (const [name, fileOptions] of fileOptionsByName) {
    if (!isRecord(fileOptions)) {
      continue
    }
    const key = CONFIG_KEYS.find((configKey) => fileOptions[configKey] !== undefined)
    if (key !== undefined) {
      throw new TypeError(
        formatMessage(
          PREFIX,
          [formatNames([`${name}.${key}`])],
          `isn't taken, since \`${name}\` takes options for the preset's files. Pass plugins in \`options\` and options for other files in \`overrides\``,
        ),
      )
    }
    checkManagedKeys(name, fileOptions)
  }
}

/**
 * For the hint that Prettier's options go in `options`
 */
const PRETTIER_OPTIONS_KEYS: ReadonlySet<string> = new Set([
  'arrowParens',
  'bracketSameLine',
  'bracketSpacing',
  'checkIgnorePragma',
  'embeddedLanguageFormatting',
  'endOfLine',
  'experimentalOperatorPosition',
  'experimentalTernaries',
  'filepath',
  'htmlWhitespaceSensitivity',
  'insertPragma',
  'jsxSingleQuote',
  'objectWrap',
  'parser',
  'plugins',
  'printWidth',
  'proseWrap',
  'quoteProps',
  'rangeEnd',
  'rangeStart',
  'requirePragma',
  'semi',
  'singleAttributePerLine',
  'singleQuote',
  'tabWidth',
  'trailingComma',
  'useTabs',
  'vueIndentScriptAndStyle',
])

/**
 * The keys of `sortImports` that the preset reads itself
 */
const SORT_IMPORTS_KEYS: ReadonlySet<string> = new Set(
  Object.keys({
    importOrder: true,
    importOrderCaseSensitive: true,
    importOrderParserPlugins: true,
  } satisfies Record<keyof SortImportsKeys | 'importOrderParserPlugins', true>),
)

/**
 * Built lazily, so the default config loads no Zod
 */
const getConfigOptionsSchema = once(
  (): z.ZodMiniType<PrettierConfigOptions, PrettierConfigOptions> => {
    const z = loadZod()
    const PRETTIER_OPTIONS = plainObject({ expected: 'an object of Prettier options' })

    const FILE_OPTIONS = deferred<FileOptions>(PRETTIER_OPTIONS)

    const TAILWINDCSS_CHECKS: OptionsShape<TailwindcssOptions> = {
      entryPoint: typeCheck<string | URL>(
        (value) => isNonEmptyString(value) || value instanceof URL,
        {
          expected: 'a non-empty string or a URL',
        },
      ),
      functions: listOption(z.string(), 'strings'),
      attributes: listOption(z.string(), 'strings'),
      preserveWhitespace: z.boolean(),
    }
    const SORT_IMPORTS_CHECKS: OptionsShape<SortImportsKeys> = {
      importOrder: listOption(z.string(), 'strings'),
      importOrderCaseSensitive: z.boolean(),
    }

    // The sorter checks the values of its other options
    const SORTER_KEY_CHECKS = {
      // The `.mts` and `.cts` override calls `.filter` on it
      importOrderParserPlugins: z.array(z.string()),
    }

    // Keeps keys set to `undefined` for `checkSortImportsKeys` to see; `sorterOptionsOf` drops them
    const sortImportsObject: z.ZodMiniType = z.pipe(
      z.pipe(
        // The output drops symbol keys, which `checkSortImportsKeys` would then miss
        plainObject().check(
          z.superRefine((value, context) => {
            for (const key of Object.getOwnPropertySymbols(value)) {
              context.addIssue({
                code: 'custom',
                path: [key],
                message: unknownKey(key, SORTER_OPTION_NAMES),
                input: value,
              })
            }
          }),
        ),
        z.looseObject(
          Object.fromEntries(
            Object.entries<z.ZodMiniType>({ ...SORT_IMPORTS_CHECKS, ...SORTER_KEY_CHECKS }).map(
              ([key, schema]) => [key, z.optional(schema)],
            ),
          ),
        ),
      ),
      z.transform((value) => ({ __proto__: null, ...value })),
    )
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The schema checks exported option names and the values this preset reads; the sorter checks other values
    const SORT_IMPORTS_OBJECT = sortImportsObject as z.ZodMiniType<
      SortImportsOptions,
      SortImportsOptions
    >

    // Typed so a key added to the options can't be left out
    const OPTION_SCHEMAS: OptionsShape<PrettierConfigOptions> = {
      root: typeCheck<string>((value) => typeof value === 'string' && path.isAbsolute(value), {
        expected: 'an absolute path, such as `import.meta.dirname`',
      }),
      astro: booleanOr(FILE_OPTIONS, { expected: 'a boolean or an object of Prettier options' }),
      tailwindcss: booleanOr(optionsObject<TailwindcssOptions>(TAILWINDCSS_CHECKS)),
      sortImports: booleanOr(SORT_IMPORTS_OBJECT),
      githubAlerts: z.boolean(),
      packageJson: z.boolean(),
      // `markdown: false` reads as turning Markdown formatting off, which `.prettierignore` does
      markdown: z.pipe(
        typeCheck<unknown>((value) => typeof value !== 'boolean', {
          expected: 'an object of Prettier options',
          hint: 'To leave Markdown files unformatted, list them in `.prettierignore`',
        }),
        FILE_OPTIONS,
      ),
      overrides: typeCheck<ReadonlyArray<Override>>(Array.isArray, {
        expected: 'an array of overrides',
      }),
      options: deferred(PRETTIER_OPTIONS),
    }

    function unknownOptionKeys(options: Readonly<Record<string, unknown>>): Array<string> {
      return Object.keys(options).filter((key) => !Object.hasOwn(OPTION_SCHEMAS, key))
    }

    // Each unknown key gets a hint and is then dropped, so the object's other issues are reported
    // with it
    const configOptionsSchema: z.ZodMiniType = z.pipe(
      z.pipe(
        plainObject({ expected: 'an object of options' }).check(
          z.superRefine((value, context) => {
            const known = Object.keys(OPTION_SCHEMAS)
            for (const key of unknownOptionKeys(value)) {
              const fix = presetKeyFix(key)
              let message: string
              if (PRETTIER_OPTIONS_KEYS.has(key)) {
                message = 'unknown option. Prettier options go under `options`'
              } else {
                message = fix === undefined ? unknownKey(key, known) : `unknown option. ${fix}`
              }
              // `unrecognized_keys`, which `z.pipe` goes on after, unlike other issues
              context.addIssue({
                code: 'unrecognized_keys',
                keys: [key],
                message,
                input: value,
              })
            }
          }),
        ),
        z.transform((value: Record<string, unknown>) => {
          // `plainObject`'s copy, which keeps symbol keys for the options object to reject
          for (const key of unknownOptionKeys(value)) {
            Reflect.deleteProperty(value, key)
          }
          return value
        }),
      ),
      optionsObject<PrettierConfigOptions>(OPTION_SCHEMAS, { expected: 'an object of options' }),
    )
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The last stage is the options object, whose type is `PrettierConfigOptions`
    return configOptionsSchema as z.ZodMiniType<PrettierConfigOptions, PrettierConfigOptions>
  },
)

function statPath(name: string, file: string): fs.Stats | undefined {
  try {
    return fs.statSync(file, { throwIfNoEntry: false })
  } catch (error) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [formatNames([name])],
        `reading ${formatNames([file])} failed: ${getErrorReason(error)}`,
      ),
      { cause: error },
    )
  }
}

/**
 * Without `root`, a relative path is returned as it is, for the Tailwind plugin to resolve from
 * the config file's folder, which isn't known here
 *
 * @throws TypeError when `entryPoint` isn't a path or URL of a file.
 */
function resolveEntryPoint(root: string | undefined, entryPoint: string | URL): string {
  if (root === undefined && typeof entryPoint === 'string' && isRelativePath(entryPoint)) {
    return entryPoint
  }
  const file = resolvePathOrFileUrl(entryPoint, root, (cause) => {
    // The whole value, not `describeValue`, which cuts a long path short and gives only the class
    // of a `URL`
    throw new TypeError(
      formatMessage(
        PREFIX,
        ['`tailwindcss.entryPoint`'],
        `expected ${root === undefined ? PATH_OR_FILE_URL_WITHOUT_ROOT_EXPECTED : PATH_OR_FILE_URL_EXPECTED}, received ${formatNames([String(entryPoint)])}`,
      ),
      cause === undefined ? undefined : { cause },
    )
  })
  if (statPath('tailwindcss.entryPoint', file)?.isFile() !== true) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        ['`tailwindcss.entryPoint`'],
        `path ${formatNames([file])} isn't a file`,
      ),
    )
  }
  return file
}

/**
 * With `tailwindcss.entryPoint` resolved to a path
 */
export type CheckedConfigOptions = Omit<PrettierConfigOptions, 'tailwindcss'> & {
  tailwindcss?: boolean | CheckedTailwindcssOptions | undefined
}

type CheckedTailwindcssOptions = Omit<TailwindcssOptions, 'entryPoint'> & {
  entryPoint?: string | undefined
}

function checkTailwindcss(
  root: string | undefined,
  tailwindcss: boolean | TailwindcssOptions | undefined,
): boolean | CheckedTailwindcssOptions | undefined {
  if (typeof tailwindcss !== 'object') {
    return tailwindcss
  }
  const { entryPoint } = tailwindcss
  return {
    ...tailwindcss,
    entryPoint: entryPoint === undefined ? undefined : resolveEntryPoint(root, entryPoint),
  }
}

/**
 * Check `defineConfig`'s options, and return a copy, which is what to read. Resolving the plugins
 * and the list options throws its own errors later
 *
 * @throws TypeError on an invalid option.
 */
export function checkConfigOptions(givenOptions: PrettierConfigOptions): CheckedConfigOptions {
  // The check is for what JavaScript callers can pass, which the types rule out
  const untypedOptions: unknown = givenOptions
  const valid = assertValid(getConfigOptionsSchema(), untypedOptions, {
    prefix: PREFIX,
    rootSubject: 'options',
  })
  if (valid.root !== undefined) {
    checkRoot(PREFIX, valid.root)
  }
  // Without a prototype, as `assertValid` returns it, so a key left out reads as `undefined`. Not
  // annotated, which would reject `__proto__` as an unknown key
  const configOptions = {
    __proto__: null,
    ...valid,
    tailwindcss: checkTailwindcss(valid.root, valid.tailwindcss),
    ...(valid.overrides !== undefined && {
      overrides: checkOverrides(valid.overrides, (key) => [formatNames([key])]),
    }),
    ...(valid.options !== undefined && {
      options: checkConfigLists(valid.options, (key) => [formatNames([`options.${key}`])]),
    }),
  }
  checkFileOptions(configOptions)
  checkOverridePlugins('overrides', configOptions.overrides)
  checkOverrideKeys('overrides', configOptions.overrides)
  if (configOptions.options !== undefined) {
    checkTailwindPlugin('options', configOptions.options.plugins)
    checkOverridePlugins('options.overrides', configOptions.options.overrides)
    checkOverrideKeys('options.overrides', configOptions.options.overrides)
    checkManagedKeys('options', configOptions.options)
  }
  const isTailwindcss =
    configOptions.tailwindcss !== undefined && configOptions.tailwindcss !== false
  let sorter: SorterEntry = 'none'
  if (configOptions.sortImports !== false) {
    sorter = isTailwindcss ? 'sorter' : 'wrapper'
  }
  const configLists: Array<PluginList> = [
    {
      plugins: configOptions.options?.plugins,
      subjectsOf: (index) => [formatNames([`options.plugins[${index}]`])],
    },
  ]
  const overrideLists = [
    ...overridePluginLists('overrides', configOptions.overrides),
    ...overridePluginLists('options.overrides', configOptions.options?.overrides),
  ]
  checkPresetPlugins(presetPluginPackages(configOptions), [...configLists, ...overrideLists])
  // The plugins aren't resolved yet, so no path stands for a name
  checkPluginConflicts(
    { sorter, tailwindcss: isTailwindcss },
    configLists,
    overrideLists,
    NO_PLUGIN_NAMES,
  )
  return configOptions
}

function overridePluginLists(
  name: string,
  overrides: ReadonlyArray<Override> | undefined,
): Array<PluginList> {
  return (overrides ?? []).map(({ options }, i) => ({
    plugins: options?.plugins,
    subjectsOf: (index) => [formatNames([`${name}[${i}].options.plugins[${index}]`])],
  }))
}

export function sorterOptionsOf(options: object): PrettierConfig {
  return copyOptions(
    Object.fromEntries(Object.entries(options).filter(([key]) => !SORT_IMPORTS_KEYS.has(key))),
  )
}

/**
 * Compile each pattern as the sorter does, so a bad one fails when the config loads rather than on
 * every file. Returns `importOrder`.
 *
 * @throws TypeError naming the entry, with the `SyntaxError` as the `cause`.
 */
export function checkImportOrder(importOrder: Array<string>): Array<string> {
  for (const [i, entry] of importOrder.entries()) {
    if (entry !== '' && !/^<[A-Z_]+>$/.test(entry)) {
      compileImportGroup(entry, `sortImports.importOrder[${i}]`)
    }
  }
  return importOrder
}

function compileImportGroup(entry: string, name: string): RegExp {
  try {
    return new RegExp(entry.replace('<TYPES>', ''))
  } catch (error) {
    throw new TypeError(
      formatMessage(
        PREFIX,
        [formatNames([name])],
        `compiling ${formatNames([entry])} as a regular expression failed: ${getErrorReason(error)}`,
      ),
      { cause: error },
    )
  }
}
