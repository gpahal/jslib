// Compiled by `typecheck` with `exactOptionalPropertyTypes`: every optional option also takes
// `undefined`, as code that forwards an optional value of its own passes it

import type { Config as PrettierConfig } from 'prettier'

import { defineConfig, mergeConfigs } from '@gpahal/prettier-config'

const ROOT = import.meta.dirname

export const withUndefinedOptions = defineConfig({
  root: ROOT,
  astro: { printWidth: undefined },
  tailwindcss: {
    entryPoint: undefined,
    functions: undefined,
    attributes: undefined,
    preserveWhitespace: undefined,
  },
  sortImports: { importOrder: undefined, importOrderCaseSensitive: undefined },
  githubAlerts: undefined,
  packageJson: undefined,
  markdown: undefined,
  overrides: undefined,
  options: { tailwindStylesheet: undefined, tailwindFunctions: undefined },
})

export const withNoOptions = defineConfig({
  root: ROOT,
  astro: undefined,
  tailwindcss: undefined,
  sortImports: undefined,
})

export const withUndefinedPrettierOptions = defineConfig({
  root: ROOT,
  astro: { printWidth: undefined },
  markdown: { proseWrap: undefined },
  overrides: [{ files: '*.ts', excludeFiles: undefined, options: { semi: undefined } }],
  options: { printWidth: undefined, importOrderCaseSensitive: undefined },
})

/**
 * The result is a config Prettier takes, without `undefined` options
 */
export const merged: PrettierConfig = mergeConfigs(withNoOptions, {
  semi: undefined,
  plugins: undefined,
  overrides: [{ files: '*.ts', options: { semi: undefined } }],
})

const NAMES: ReadonlyArray<string> = ['tw']

export const withListOptions = defineConfig({
  root: ROOT,
  tailwindcss: { functions: NAMES, attributes: [] },
  sortImports: { importOrder: (defaults) => defaults },
})
