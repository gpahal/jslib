// Compiled by the package's `typecheck`, not run

import {
  defineConfig,
  mergeConfigs,
  type SortImportsOptions,
  type TailwindcssOptions,
} from '@/index'

const ROOT = import.meta.dirname

const NAMES: ReadonlyArray<string> = ['tw']

export const configs = [
  // Each list option takes a readonly array, which replaces its defaults, or a function of them
  defineConfig({
    root: ROOT,
    tailwindcss: { functions: NAMES, attributes: (defaults) => [...defaults, ...NAMES] },
    sortImports: { importOrder: NAMES },
  }),
  // @ts-expect-error - A list option takes strings
  defineConfig({ root: ROOT, tailwindcss: { functions: [1] } }),
  // @ts-expect-error - A list option's function returns strings
  defineConfig({ root: ROOT, tailwindcss: { attributes: () => [1] } }),
  // @ts-expect-error - The options object is required
  defineConfig(),
  defineConfig({}),
  // @ts-expect-error - Unknown import sorter options are rejected
  defineConfig({ root: ROOT, sortImports: { importOrderFutureOption: 1 } }),
  // @ts-expect-error - Only a whole config has plugins
  defineConfig({ root: ROOT, markdown: { plugins: [] } }),
  // @ts-expect-error - The `sortImports` option sets it
  defineConfig({ root: ROOT, markdown: { importOrder: [] } }),
  // @ts-expect-error - The `sortImports` option sets it
  defineConfig({ root: ROOT, options: { importOrder: [] } }),
  // @ts-expect-error - The `tailwindcss` option's `functions` sets it
  defineConfig({ root: ROOT, options: { tailwindFunctions: [] } }),
  // @ts-expect-error - The preset's own options go at the top level
  defineConfig({ root: ROOT, options: { tailwindcss: true } }),
  defineConfig({
    root: ROOT,
    // @ts-expect-error - The preset's own options go at the top level
    options: { overrides: [{ files: '*.astro', options: { astro: true } }] },
  }),
  // @ts-expect-error - Prettier ignores an override's own overrides
  mergeConfigs({ overrides: [{ files: '*.md', options: { overrides: [] } }] }),
  mergeConfigs({ overrides: [{ files: '*.md', options: { githubAlerts: false } }] }),
  // @ts-expect-error - Prettier's options keep their types
  defineConfig({ root: ROOT, options: { printWidth: 'wide' } }),
  // @ts-expect-error - `entryPoint` sets the plugin's `tailwindStylesheet`
  defineConfig({ root: ROOT, tailwindcss: { stylesheet: 'a.css' } }),
  // @ts-expect-error - The sorter's known options keep their types
  defineConfig({ root: ROOT, sortImports: { importOrderSafeSideEffects: 'server-only' } }),
  defineConfig({ root: ROOT, tailwindcss: { entryPoint: new URL('file:///a.css') } }),
  defineConfig({ root: ROOT, astro: { printWidth: 120, tailwindPreserveDuplicates: true } }),
  defineConfig({ root: ROOT, options: { plugins: [], printWidth: 80, importOrder: undefined } }),
  // The sorter's other exported options
  defineConfig({
    root: ROOT,
    sortImports: {
      importOrderSafeSideEffects: ['^server-only$'],
      importOrderTypeScriptVersion: '5.0.0',
    },
    options: {
      importOrderParserPlugins: undefined,
      tailwindFunctions: undefined,
      tailwindPreserveDuplicates: true,
      tailwindConfig: 'tailwind.config.js',
      overrides: [],
    },
  }),
]

const files = ['*.ts'] as const
const plugins = ['prettier-plugin-other'] as const
const overrides = [{ files, excludeFiles: files, options: { semi: true } }] as const

/**
 * Readonly lists, such as `as const` arrays, are taken wherever the config reads a list
 */
export const readonlyLists = [
  defineConfig({
    root: ROOT,
    sortImports: { importOrder: ['^[./]'] as const },
    tailwindcss: { functions: () => ['tw'] as const },
    overrides,
    options: { plugins, overrides },
  }),
  mergeConfigs({ plugins, overrides }),
]

const tailwindcss: TailwindcssOptions = { entryPoint: 'a.css', functions: (defaults) => defaults }
const sortImports: SortImportsOptions = {
  importOrder: ['^[./]'],
  importOrderSafeSideEffects: ['^server-only$'],
}

/**
 * The exported option types are the object forms of `tailwindcss` and `sortImports`
 */
export const namedOptions = defineConfig({ root: ROOT, tailwindcss, sortImports })
