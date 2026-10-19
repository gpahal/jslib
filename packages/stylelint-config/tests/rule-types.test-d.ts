import process from 'node:process'

// Compiled by the package's `typecheck`, not run. Stylelint still exports `CoreRules`, which it
// marks internal, and the rule types still take each rule's options from it

import type { Config, CoreRules } from 'stylelint'

import { defineConfig, replace, type Replaced, type StylelintRules } from '@/index'

/**
 * A rule only Stylelint has, so it's typed only through `CoreRules`
 */
export const hasCoreRule: 'color-no-hex' extends keyof CoreRules ? true : false = true

export const typedPrimaryOption: StylelintRules = { 'number-max-precision': 4 }

export const ownRuleOptions: StylelintRules = {
  '@gpahal/declaration-empty-line-before': ['always', { except: ['after-declaration'] }],
}

export const wrongOwnRuleOption: StylelintRules = {
  // @ts-expect-error - The rule takes the options of `declaration-empty-line-before`
  '@gpahal/declaration-empty-line-before': 'sometimes',
}

/**
 * An `undefined` primary option keeps the preset's
 */
export const keptPrimaryOption: StylelintRules = {
  'order/properties-order': [undefined, { disableFix: false }],
  'plugin/use-baseline': [undefined],
}

export const wrongKeptPrimarySecondaryOption: StylelintRules = {
  // @ts-expect-error - The secondary options keep their types
  'order/properties-order': [undefined, { unspecified: 'sometimes' }],
}

export const wrongPrimaryOption: StylelintRules = {
  // @ts-expect-error - `CoreRules` gives the rule a number
  'number-max-precision': 'x',
}

export const configs: Array<Config> = [
  await defineConfig({
    root: process.cwd(),
    rules: {
      // Any plugin rule
      'foo/bar': [true, { anything: 1 }],
      'order/properties-order': [['display'], { unspecified: 'bottom', severity: 'warning' }],
      'color-no-hex': [true, { message: 'No hex colors', disableFix: true }],
    },
  }),
  await defineConfig({
    root: process.cwd(),
    rules: {
      // `replace()` takes and checks the setting the rule takes
      'property-no-vendor-prefix': replace([true, { severity: 'warning' }]),
      'order/properties-order': replace([['display'], { unspecified: 'bottom' }]),
      // @ts-expect-error - `CoreRules` gives the rule a number
      'number-max-precision': replace('x'),
    },
    overrides: [{ files: '*.scss', rules: { 'color-no-hex': replace(true) } }],
  }),
  // @ts-expect-error - Stylelint has no rule of this name
  await defineConfig({ root: process.cwd(), rules: { 'color-no-hexx': true } }),
  await defineConfig({
    root: process.cwd(),
    // @ts-expect-error - A misspelled rule name in an override
    overrides: [{ files: '*.scss', rules: { 'block-no-emptyy': true } }],
  }),
  // @ts-expect-error - `fix` in an override hides problems without writing fixes
  await defineConfig({ root: process.cwd(), overrides: [{ files: '*.scss', fix: true }] }),
]

export const replaced: Replaced<true> = replace(true)

// @ts-expect-error - The wrapper isn't the setting, which only `defineConfig` unwraps
export const unwrapped: true = replace(true)
