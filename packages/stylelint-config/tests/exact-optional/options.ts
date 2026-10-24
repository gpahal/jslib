import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

// Compiled by `typecheck` with `exactOptionalPropertyTypes`: every optional option also takes
// `undefined`, as code that forwards an optional value of its own passes it. `undefined` means not
// set. `tests/rules.test.ts` imports this module, so every config here must build, but it checks
// only `withUndefinedOptions` and the copies of `withReadonlyArrays`

import { defineConfig, replace } from '@gpahal/stylelint-config'

export const withUndefinedOptions = await defineConfig({
  root: process.cwd(),
  tailwindcss: {
    functions: undefined,
    atRules: undefined,
    entryPoint: undefined,
    validateApply: undefined,
  },
  astro: undefined,
  html: undefined,
  markdown: undefined,
  commentLayout: undefined,
  logical: undefined,
  plugins: undefined,
  rules: {
    // Leaves the preset's setting on
    'property-no-unknown': undefined,
    'foo/bar': undefined,
    // Keeps the preset's severity, and leaves `ignoreFunctions` unset
    'plugin/use-baseline': [true, { severity: undefined, ignoreFunctions: undefined }],
    'selector-no-deprecated': replace([true, { severity: undefined, disableFix: undefined }]),
    // A rule's own secondary options take `undefined` too, which keeps the preset's value, or
    // with `replace()` passes as given
    'function-no-unknown': [true, { ignoreFunctions: undefined }],
    'value-no-vendor-prefix': replace([true, { ignoreValues: undefined }]),
  },
  overrides: [
    {
      files: '*.scss',
      rules: undefined,
      customSyntax: undefined,
      name: undefined,
      computeEditInfo: undefined,
      validate: undefined,
    },
  ],
  ignoreFiles: undefined,
  referenceFiles: undefined,
  extends: undefined,
  languageOptions: undefined,
  defaultSeverity: undefined,
  customSyntax: undefined,
  quiet: undefined,
  formatter: undefined,
  ignoreDisables: undefined,
  reportNeedlessDisables: undefined,
  reportInvalidScopeDisables: undefined,
  reportDescriptionlessDisables: undefined,
  reportUnscopedDisables: undefined,
  maxWarnings: undefined,
  computeEditInfo: undefined,
  configurationComment: undefined,
  processors: undefined,
  allowEmptyInput: undefined,
  cache: undefined,
})

export const withNoTailwindcss = await defineConfig({
  root: process.cwd(),
  tailwindcss: undefined,
  overrides: undefined,
})

const globs: ReadonlyArray<string> = ['legacy/**/*.css']
const names: ReadonlyArray<string> = ['brand']
const modules: ReadonlyArray<string> = [`${process.cwd()}/local-plugin.mjs`]
const configs = [{ rules: { 'color-named': null } }] as const

/**
 * The root of {@link withReadonlyArrays}, whose reference globs each match a file, as `defineConfig`
 * checks. The importing test removes it
 */
export const readonlyArraysRoot = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'stylelint-config-readonly-')),
)
for (const file of ['legacy/a.css', 'tokens/a.css']) {
  fs.mkdirSync(path.dirname(path.join(readonlyArraysRoot, file)), { recursive: true })
  fs.writeFileSync(path.join(readonlyArraysRoot, file), '')
}

/**
 * Every array option as a readonly array, as a config that shares a constant list passes it
 */
export const withReadonlyArrays = await defineConfig({
  root: readonlyArraysRoot,
  plugins: modules,
  processors: modules,
  extends: configs,
  referenceFiles: [{ files: globs, customSyntax: undefined, loader: undefined }],
  overrides: [
    {
      files: globs,
      plugins: modules,
      extends: configs,
      ignoreFiles: globs,
      referenceFiles: ['tokens/*.css', { files: globs }],
      rules: { 'color-named': 'never' },
    },
  ] as const,
})

export const withListArrays = await defineConfig({
  root: process.cwd(),
  tailwindcss: { functions: names, atRules: [] },
  ignoreFiles: globs,
})

export const withListFunctions = await defineConfig({
  root: process.cwd(),
  tailwindcss: { functions: (defaults) => defaults, atRules: (defaults) => [...defaults, 'brand'] },
  ignoreFiles: (defaults) => [...defaults, ...globs],
})
