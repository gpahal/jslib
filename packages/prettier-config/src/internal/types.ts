import type { PluginConfig } from '@ianvs/prettier-plugin-sort-imports'
import type { Options, Config as PrettierConfig } from 'prettier'

import type { ListOption } from '@gpahal/internal/node/options'

/**
 * prettier-plugin-tailwindcss's options, declared here since it's an optional peer dependency
 */
export type TailwindcssPluginOptions = {
  tailwindConfig?: string | undefined
  tailwindStylesheet?: string | undefined
  /**
   * @deprecated Use `tailwindStylesheet`
   */
  tailwindEntryPoint?: string | undefined
  tailwindFunctions?: Array<string> | undefined
  tailwindAttributes?: Array<string> | undefined
  tailwindPreserveWhitespace?: boolean | undefined
  tailwindPreserveDuplicates?: boolean | undefined
}

/**
 * A Prettier config, as `defineConfig` and `mergeConfigs` return it
 */
export type Config = PrettierConfig & PluginConfig & TailwindcssPluginOptions

/**
 * `undefined` means the option isn't set
 */
type WithUndefined<T> = { [K in keyof T]?: T[K] | undefined }

/**
 * An override's options, without `overrides`, which Prettier ignores there
 */
type OverrideOptions = WithUndefined<Options & TailwindcssPluginOptions> & { overrides?: undefined }

/**
 * An override of a Prettier config: options for the files that match `files`
 */
export type Override = {
  files: string | ReadonlyArray<string>
  excludeFiles?: string | ReadonlyArray<string> | undefined
  options?: OverrideOptions | undefined
}

/**
 * An override as `defineConfig` takes it, which can't set the preset's own options
 */
type PresetOverride = Override & {
  options?: Partial<Record<PresetOptionKey, undefined>> | undefined
}

/**
 * A Prettier config, as `mergeConfigs` and the `options` option take it. An option that is
 * `undefined` isn't set
 */
export type ConfigInput = {
  [K in keyof Config as K extends 'plugins' | 'overrides' ? never : K]?: Config[K] | undefined
} & {
  plugins?: ReadonlyArray<NonNullable<Config['plugins']>[number]> | undefined
  overrides?: ReadonlyArray<Override> | undefined
}

/**
 * The Tailwind plugin's options that the `tailwindcss` option sets
 */
export type TailwindcssManagedKey =
  | 'tailwindFunctions'
  | 'tailwindAttributes'
  | 'tailwindStylesheet'
  | 'tailwindEntryPoint'
  | 'tailwindPreserveWhitespace'

/**
 * The preset's own options but `overrides`, which Prettier ignores among its options
 */
export type PresetOptionKey =
  | 'root'
  | 'astro'
  | 'tailwindcss'
  | 'sortImports'
  | 'githubAlerts'
  | 'packageJson'
  | 'markdown'
  | 'options'

/**
 * A config without the keys that `sortImports`, `tailwindcss` and the preset's own options set. Not
 * `Omit`, which would reduce Prettier's options to their index signature. The index signature still
 * takes any key, so the last three types limit these keys to `undefined`
 */
type GlobalOptions = {
  [
    K in keyof ConfigInput as K extends `importOrder${string}` | TailwindcssManagedKey | 'overrides'
      ? never
      : K
  ]: ConfigInput[K]
} & { overrides?: ReadonlyArray<PresetOverride> | undefined } & Record<
    `importOrder${string}`,
    undefined
  > &
  Partial<Record<TailwindcssManagedKey, undefined>> &
  Partial<Record<PresetOptionKey, undefined>>

/**
 * Prettier's options for some files, without whole-config and override keys and, as in `options`,
 * the keys that `sortImports`, `tailwindcss` and the preset's own options set
 */
export type FileOptions = OverrideOptions & {
  plugins?: undefined
  overrides?: undefined
  files?: undefined
  excludeFiles?: undefined
} & Record<`importOrder${string}`, undefined> &
  Partial<Record<TailwindcssManagedKey, undefined>> &
  Partial<Record<PresetOptionKey, undefined>>

/**
 * The order to use, or a function of the preset's order that returns it
 */
export type ImportOrderOption = ListOption

/**
 * The keys of the `sortImports` object that `defineConfig` checks itself
 */
export type SortImportsKeys = {
  importOrder?: ImportOrderOption | undefined
  importOrderCaseSensitive?: boolean | undefined
}

/**
 * The import sorter's other exported options, passed through
 */
type SortImportsPluginOptions = WithUndefined<Omit<PluginConfig, keyof SortImportsKeys>>

/**
 * The object form of the `sortImports` option
 */
export type SortImportsOptions = SortImportsKeys & SortImportsPluginOptions

export type TailwindcssOptions = {
  /**
   * Your Tailwind CSS v4 entry stylesheet, the plugin's `tailwindStylesheet`: a path relative to
   * `root`, an absolute path, or a `file:` URL. The file must exist. Without `root`, the plugin
   * resolves a relative path from the folder of the config file Prettier finds from the formatted
   * file, not one given with `--config`
   */
  entryPoint?: string | URL | undefined
  /**
   * The plugin's `tailwindFunctions`. The defaults are the class-name helpers that
   * eslint-plugin-better-tailwindcss checks, such as `cn` and `twMerge`. An array replaces them,
   * and a function gets a copy of them and returns the names to use
   */
  functions?: ListOption | undefined
  /**
   * The plugin's `tailwindAttributes`, added to its own, such as `class`. No defaults, so a function
   * gets `[]`
   */
  attributes?: ListOption | undefined
  /**
   * The plugin's `tailwindPreserveWhitespace`
   */
  preserveWhitespace?: boolean | undefined
}

export type PrettierConfigOptions = {
  /**
   * Absolute path of an existing folder, such as `import.meta.dirname`. Relative Tailwind entry
   * points, dot-prefixed plugin paths and plugin package names resolve from it; a name that isn't
   * installed there is left as it is. Without it, Prettier and the Tailwind plugin resolve them.
   * Override globs always resolve from the config file's folder
   */
  root?: string | undefined
  /**
   * Formats `.astro` files with prettier-plugin-astro, with options for them when an object is
   * given. `astroAllowShorthand` is left unset, so `{title}` keeps the form it's written in
   */
  astro?: boolean | FileOptions | undefined
  /**
   * Sorts Tailwind CSS classes with prettier-plugin-tailwindcss, except in `.astro` files. Set its
   * other options, such as `tailwindPreserveDuplicates`, in `options`
   */
  tailwindcss?: boolean | TailwindcssOptions | undefined
  /**
   * Sorts imports with @ianvs/prettier-plugin-sort-imports. The sorter's other exported options,
   * such as `importOrderSafeSideEffects`, pass through to it. Unknown keys throw. On by default.
   *
   * Sorting changes the order modules run in. A bare side-effect import and an import under
   * `// prettier-ignore` are barriers it doesn't cross, and without `tailwindcss`, so is an import
   * under a directive such as `// @ts-expect-error`
   */
  sortImports?: boolean | SortImportsOptions | undefined
  /**
   * Keeps a GitHub alert's marker, such as `> [!NOTE]`, on its own line in Markdown. It replaces
   * the printer of Prettier's `markdown` parser, so it can clash with other Markdown plugins. On by
   * default
   */
  githubAlerts?: boolean | undefined
  /**
   * Sorts the keys of `package.json` files with prettier-plugin-packagejson. On by default
   */
  packageJson?: boolean | undefined
  /**
   * Options for the files of Prettier's `markdown` language, such as `.md` and `README`.
   * `proseWrap` is `never` by default. Files you map to the `markdown` parser yourself get neither.
   * `.mdx` files are formatted only with a pragma, since Prettier's MDX parser predates MDX 2
   */
  markdown?: FileOptions | undefined
  /**
   * Your own overrides, after the preset's, so they win
   */
  overrides?: ReadonlyArray<PresetOverride> | undefined
  /**
   * Options for every file, which win over the preset's. `markdown` and `astro` win over them.
   * Their `plugins` add to the preset's. See
   * https://github.com/gpahal/jslib/tree/main/packages/prettier-config#change-an-option
   */
  options?: GlobalOptions | undefined
}
