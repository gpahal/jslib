import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveListOption, type ListOption } from '@gpahal/internal/node/options'
import { resolveFromNodeModules } from '@gpahal/internal/node/resolve'
import { isRecord } from '@gpahal/std/objects'

import {
  GENERATED_FILES,
  IMPORT_ORDER,
  IMPORT_ORDER_PARSER_PLUGINS,
  JSONC_FILES,
  MARKDOWN_FILES,
  TAILWIND_FUNCTIONS,
} from '@/internal/defaults'
import {
  checkConfigsToMerge,
  copyOptions,
  copyOverride,
  inheritPlugins,
  mergeConfigList,
  NO_PLUGIN_NAMES,
  orderPlugins,
  pluginNamesOf,
  PREFIX,
  withPluginNames,
} from '@/internal/merge'
import {
  checkConfigOptions,
  checkImportOrder,
  checkSortImportsKeys,
  sorterOptionsOf,
  type CheckedConfigOptions,
} from '@/internal/options'
import {
  DEFAULT_PLUGIN_ENVIRONMENT,
  resolvePeerPlugin,
  resolvePeerPlugins,
  resolvePlugin,
  resolveSortImportsPlugin,
  resolveTailwindPlugin,
  warnOfPrettierVersion,
  type SortImportsPlugin,
} from '@/internal/plugins'
import type { Config, ConfigInput, PrettierConfigOptions } from '@/internal/types'

export type {
  Config,
  ConfigInput,
  FileOptions,
  ImportOrderOption,
  Override,
  PrettierConfigOptions,
  SortImportsOptions,
  TailwindcssOptions,
  TailwindcssPluginOptions,
} from '@/internal/types'

/**
 * The path of `internal/<name>` with this module's extension, so tests that import the source load
 * the `.ts` plugin
 */
function pluginModulePath(name: string): string {
  return fileURLToPath(
    new URL(`internal/${name}${path.extname(fileURLToPath(import.meta.url))}`, import.meta.url),
  )
}

/**
 * A path, so Prettier imports it, and its large Markdown plugin, only when it loads the plugins
 */
const GITHUB_ALERTS_PLUGIN = pluginModulePath('github-alerts')

/**
 * The import sorter without the parsers whose plugins don't resolve, used without the Tailwind plugin
 */
const SORT_IMPORTS_WRAPPER = pluginModulePath('sort-imports')

function resolveNames(
  name: string,
  option: ListOption | undefined,
  defaults: ReadonlyArray<string>,
): Array<string> {
  return resolveListOption(option, defaults, { prefix: PREFIX, name })
}

/**
 * Build the Prettier config, with the plugins that `options` turns on. An override's `plugins` add
 * to the config's, which Prettier would otherwise replace in the override's files.
 *
 * Spreading the result works for a scalar option, but a spread `plugins` or `overrides` replaces
 * the preset's, and a key that a preset override sets, such as `proseWrap`, keeps its value there.
 *
 * @throws TypeError on invalid options, a plugin that conflicts with the preset's, or with
 *   `tailwindcss` a Tailwind plugin or import sorter it can't use. See
 *   https://github.com/gpahal/jslib/tree/main/packages/prettier-config#reference
 * @throws Error when an optional plugin that `astro` or `tailwindcss` needs isn't installed or
 *   fails to resolve
 */
export function defineConfig(configOptions: PrettierConfigOptions): Config {
  const options = checkConfigOptions(configOptions)
  const preset = createConfig(options, options.root)
  // `mergeConfigs` leaves the preset's overrides as they are, so `markdown` and `astro` keep
  // winning over `options`
  const config =
    options.options === undefined
      ? preset
      : mergeConfigList([preset, options.options], NO_PLUGIN_NAMES)
  // Kept with the config, for `mergeConfigs` to match a path to a name that another config gives
  const pluginNames = new Map<string, string>()
  const plugins = orderPlugins(
    resolvePluginPaths(options.root, config.plugins ?? [], pluginNames),
    pluginNames,
  )
  if (config.plugins !== undefined) {
    config.plugins = plugins
  }
  const overrides = config.overrides ?? []
  for (const override of overrides) {
    if (override.options?.plugins !== undefined) {
      override.options.plugins = resolvePluginPaths(
        options.root,
        override.options.plugins,
        pluginNames,
      )
    }
  }
  // Again after resolving paths, so a plugin given by a relative and an absolute path is kept once
  inheritPlugins(plugins, overrides, pluginNames)
  return withPluginNames(config, pluginNames)
}

/**
 * Merge Prettier configs as Prettier would apply them one after another: a later config's option
 * wins, and every config's overrides are kept in order, so an override still wins in its files.
 *
 * Each plugin is kept once, in the order it first appears, with prettier-plugin-tailwindcss, then
 * prettier-plugin-classnames and prettier-plugin-merge, last. A path that `defineConfig` resolved
 * from a name counts as that name, in the config it returned and in merges of it, not in a copy. An
 * override's `plugins` add to the merged config's. An option that is `undefined` isn't set. The
 * configs are left unchanged.
 *
 * @throws TypeError when a config, plugin or override isn't valid, or on the plugin conflicts
 *   `defineConfig` rejects.
 */
export function mergeConfigs(...configs: Array<ConfigInput>): Config {
  const pluginNames = pluginNamesOf(configs)
  const checked = checkConfigsToMerge(configs, SORT_IMPORTS_WRAPPER, pluginNames)
  return withPluginNames(mergeConfigList(checked, pluginNames), pluginNames)
}

/**
 * Resolve dot-prefixed paths and package names from `root`, adding each resolved name to
 * `pluginNames` by its path. Prettier resolves them from the config file's folder or the working
 * directory, which may be outside `root`, as in a monorepo whose app installs a plugin. A name that
 * doesn't resolve from `root` is left to Prettier
 */
function resolvePluginPaths(
  root: string | undefined,
  plugins: NonNullable<Config['plugins']>,
  pluginNames: Map<string, string>,
): NonNullable<Config['plugins']> {
  if (root === undefined) {
    return plugins
  }
  return plugins.map((plugin) => {
    if (typeof plugin !== 'string') {
      return plugin
    }
    if (plugin.startsWith('.')) {
      return path.resolve(root, plugin)
    }
    if (!isPackageSpecifier(plugin)) {
      return plugin
    }
    const resolved = resolvePluginName(plugin, root)
    if (resolved === undefined) {
      return plugin
    }
    pluginNames.set(resolved, plugin)
    return resolved
  })
}

function isPackageSpecifier(plugin: string): boolean {
  return !path.isAbsolute(plugin) && !/^[a-z][\d+.a-z-]*:/i.test(plugin)
}

/**
 * Close to how Prettier imports a plugin name: through `exports` with the `node` and `import`
 * conditions, else `main`, never the bundlers' `module`. Unlike Node's ESM resolver, it tries the
 * extensions on a subpath or `exports` target without one
 */
function resolvePluginName(id: string, root: string): string | undefined {
  try {
    return resolveFromNodeModules(id, path.join(root, 'noop.js'), {
      prefix: PREFIX,
      conditions: ['node', 'import'],
      mainFields: ['main'],
      extensions: ['.js', '.json', '.node'],
    })?.path
  } catch {
    // Left for Prettier to resolve, and to report when it can't
    return undefined
  }
}

/**
 * The optional plugins that the options turn on, with every missing one reported at once. With the
 * Tailwind plugin, the sorter is the one it resolves, since it composes the sorter's parsers only
 * for that entry
 */
function resolveConfigPlugins(
  {
    isAstro,
    isTailwindcss,
    isSortImports,
  }: { isAstro: boolean; isTailwindcss: boolean; isSortImports: boolean },
  root: string | undefined,
): {
  astroPath: string | undefined
  tailwindPath: string | undefined
  sortImportsEntry: SortImportsPlugin['entry'] | undefined
  tailwindSorterPath: string | undefined
} {
  const [astroPath, tailwindPath] = resolvePeerPlugins([
    isAstro
      ? () => resolvePeerPlugin('astro', 'prettier-plugin-astro', DEFAULT_PLUGIN_ENVIRONMENT, root)
      : undefined,
    isTailwindcss ? () => resolveTailwindPlugin(DEFAULT_PLUGIN_ENVIRONMENT, root) : undefined,
  ])
  if (!isSortImports || tailwindPath === undefined) {
    return {
      astroPath,
      tailwindPath,
      sortImportsEntry: isSortImports ? SORT_IMPORTS_WRAPPER : undefined,
      tailwindSorterPath: undefined,
    }
  }
  const { entry, path: sorterPath } = resolveSortImportsPlugin(
    tailwindPath,
    DEFAULT_PLUGIN_ENVIRONMENT,
    root,
  )
  return { astroPath, tailwindPath, sortImportsEntry: entry, tailwindSorterPath: sorterPath }
}

/**
 * Both set, so a config can spread them
 */
type PresetConfig = Config & Required<Pick<Config, 'plugins' | 'overrides'>>

/**
 * The preset's config without `options`, which `defineConfig` merges after it. Needs no `root`, so
 * it also builds the static default
 */
function createConfig(
  configOptions: Omit<CheckedConfigOptions, 'root'>,
  root?: string,
): PresetConfig {
  const {
    astro = false,
    tailwindcss = false,
    sortImports = true,
    githubAlerts = true,
    packageJson = true,
    markdown,
    overrides = [],
    options,
  } = configOptions
  warnOfPrettierVersion(DEFAULT_PLUGIN_ENVIRONMENT, root)
  const isAstro = astro !== false
  const isSortImports = sortImports !== false
  const astroOptions = isRecord(astro) ? astro : undefined
  const tailwindcssOptions = isRecord(tailwindcss) ? tailwindcss : {}
  const sortImportsOptions = isRecord(sortImports) ? sortImports : {}
  const parserPlugins = sortImportsOptions.importOrderParserPlugins ?? IMPORT_ORDER_PARSER_PLUGINS
  const { astroPath, tailwindPath, sortImportsEntry, tailwindSorterPath } = resolveConfigPlugins(
    { isAstro, isTailwindcss: tailwindcss !== false, isSortImports },
    root,
  )
  if (isRecord(sortImports)) {
    checkSortImportsKeys(sortImports, tailwindSorterPath)
  }
  return {
    // Set although they're Prettier's defaults, so they win over a project's `.editorconfig`
    endOfLine: 'lf',
    tabWidth: 2,
    useTabs: false,

    printWidth: 100,
    semi: false,
    singleQuote: true,
    plugins: [
      ...(sortImportsEntry === undefined ? [] : [sortImportsEntry]),
      ...(githubAlerts ? [GITHUB_ALERTS_PLUGIN] : []),
      ...(astroPath === undefined ? [] : [astroPath]),
      ...(packageJson ? [resolvePlugin('prettier-plugin-packagejson')] : []),
      // Last, so it wraps the parsers of the plugins before it
      ...(tailwindPath === undefined ? [] : [tailwindPath]),
    ],
    ...(isSortImports && {
      importOrder: checkImportOrder(
        resolveNames('sortImports.importOrder', sortImportsOptions.importOrder, IMPORT_ORDER),
      ),
      ...(sortImportsOptions.importOrderCaseSensitive !== undefined && {
        importOrderCaseSensitive: sortImportsOptions.importOrderCaseSensitive,
      }),
      // Merges `import type { A } from 'a'` and `import { b } from 'a'` into
      // `import { b, type A } from 'a'`, as `@gpahal/eslint-config` writes them
      importOrderTypeScriptVersion: '5.0.0',
      importOrderParserPlugins: [...parserPlugins],
      ...sorterOptionsOf(sortImportsOptions),
    }),
    ...(tailwindPath !== undefined && {
      ...(tailwindcssOptions.entryPoint !== undefined && {
        tailwindStylesheet: tailwindcssOptions.entryPoint,
      }),
      tailwindFunctions: resolveNames(
        'tailwindcss.functions',
        tailwindcssOptions.functions,
        TAILWIND_FUNCTIONS,
      ),
      // The plugin adds its own attributes, such as `class` and `className`, to the ones given
      ...(tailwindcssOptions.attributes !== undefined && {
        tailwindAttributes: resolveNames(
          'tailwindcss.attributes',
          tailwindcssOptions.attributes,
          [],
        ),
      }),
      ...(tailwindcssOptions.preserveWhitespace !== undefined && {
        tailwindPreserveWhitespace: tailwindcssOptions.preserveWhitespace,
      }),
    }),
    overrides: [
      ...(isAstro
        ? [
            {
              files: '*.astro',
              // Its parser wins over a `parser` in `options`, which can't read `.astro` files
              options: { parser: 'astro', ...(astroOptions && copyOptions(astroOptions)) },
            },
          ]
        : []),
      {
        files: [...MARKDOWN_FILES],
        options: {
          // Only `proseWrap` from `options`, which the override would otherwise replace
          proseWrap: options?.proseWrap ?? 'never',
          ...(markdown && copyOptions(markdown)),
        },
      },
      { files: [...JSONC_FILES], options: { trailingComma: 'none' } },
      // Tools rewrite these on their next run. Without a pragma, Prettier leaves them alone
      { files: [...GENERATED_FILES], options: { requirePragma: true } },
      // ESLint rewrites it without a final newline. Prettier's JSON parsers ignore `requirePragma`,
      // so an empty range leaves it as it is
      { files: '**/eslint-suppressions.json', options: { rangeEnd: 0 } },
      // Prettier's MDX parser reads MDX 1, and its output can render differently in MDX 2 and 3
      { files: '*.mdx', options: { requirePragma: true } },
      // The sorter would parse `<T>x` assertions as JSX and abort
      ...(isSortImports
        ? [
            {
              files: ['*.mts', '*.cts'],
              options: { importOrderParserPlugins: parserPlugins.filter((name) => name !== 'jsx') },
            },
          ]
        : []),
      ...overrides.map((override) => copyOverride(override)),
    ],
  }
}

/**
 * The preset with no options, for `"prettier": "@gpahal/prettier-config"` in `package.json`
 */
const defaultConfig: PresetConfig = createConfig({})

export default defaultConfig
