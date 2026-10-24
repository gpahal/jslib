import eslintPluginE18e from '@e18e/eslint-plugin'

import { E18E_RULE_SET_DEFAULTS } from '@/internal/configs/constants'
import type { E18eOptions, TypedConfig, TypedRules } from '@/internal/types'
import { getPluginConfig } from '@/internal/utils'

/**
 * Code blocks show an API or a package rather than pick one
 */
export const E18E_CODE_BLOCK_RULES: TypedRules = Object.fromEntries(
  Object.keys(eslintPluginE18e.rules ?? {}).map((name) => [`e18e/${name}`, 'off']),
)

/**
 * The plugin's configs, less the rules below, and three from none of them. The others in none stay
 * off:
 *
 * - `prefer-exponentiation-operator`, `prefer-flatmap-over-map-flat`,
 *   `prefer-includes-over-regex-test` and `prefer-slice-over-split-index`: other rules report them
 * - `prefer-inline-equality` and `prefer-charcode-at-in-loop`: unicorn asks for the opposite
 * - `no-indexof-equality`: it needs type information, and its array fix changes the check
 * - `prefer-get-or-insert`: Node 24 has no `Map.prototype.getOrInsert()`
 * - `no-delete-property`: `delete` removes a key whose absence matters, as for `in`
 *
 * `prefer-object-has-own`'s fix is dropped, as `REPORT_ONLY_RULES` records, and `ALLOWED_OVERLAPS`
 * records why it stays on beside `no-prototype-builtins`
 */
export function e18e({
  files,
  modernization = E18E_RULE_SET_DEFAULTS.modernization,
  moduleReplacements = E18E_RULE_SET_DEFAULTS.moduleReplacements,
  performanceImprovements = E18E_RULE_SET_DEFAULTS.performanceImprovements,
}: Omit<E18eOptions, 'rules'> & { files: Array<string> }): Array<TypedConfig> {
  const rules: TypedRules = {
    ...(modernization && getPluginConfig(eslintPluginE18e, 'modernization').rules),
    ...(moduleReplacements && getPluginConfig(eslintPluginE18e, 'moduleReplacements').rules),
    ...(performanceImprovements &&
      getPluginConfig(eslintPluginE18e, 'performanceImprovements').rules),
    // Rules in none of the plugin's configs that no other rule reports
    ...(performanceImprovements && {
      'e18e/prefer-static-collator': 'error',
      'e18e/prefer-throw-if-no-entry': 'error',
      // `unicorn/no-array-reduce` would report it too, but it's off
      'e18e/no-spread-in-reduce': 'error',
    }),
    // `unicorn/prefer-code-point` and `unicorn/no-array-from-fill` ask for the opposite
    'e18e/prefer-string-fromcharcode': 'off',
    'e18e/prefer-array-fill': 'off',
    // `@typescript-eslint/prefer-nullish-coalescing` reports these, with options to leave `||` on
    // strings and numbers alone
    'e18e/prefer-nullish-coalescing': 'off',
    // These change behaviour, such as a copy where the code sorted in place
    'e18e/prefer-array-to-reversed': 'off',
    'e18e/prefer-array-to-sorted': 'off',
    'e18e/prefer-array-to-spliced': 'off',
    // Hoisting every regex out of its function rarely matters outside hot paths
    'e18e/prefer-static-regex': 'off',
    // `Array.from(s, fn)` for `[...s].map(fn)`, where `unicorn/prefer-iterator-to-array` asks for
    // `s.values().toArray()`, and its fix maps what the mapper adds
    'e18e/prefer-array-from-map': 'off',
    // `prefer-object-spread` reports `Object.assign({}, a)`, `unicorn/prefer-spread`
    // `Array.from(s)` and `a.concat(b)`, and `prefer-spread` `fn.apply(null, args)`
    'e18e/prefer-spread-syntax': 'off',
  }
  return [
    {
      name: 'gpahal/e18e/rules',
      files,
      plugins: { e18e: eslintPluginE18e },
      rules,
    },
  ]
}
