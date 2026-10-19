import type { ESLint, Linter } from 'eslint'

import { resolveSubOptions } from '@gpahal/internal/node/options'
import { isRecord } from '@gpahal/std/objects'

import type { LooseRules, TypedConfig } from '@/internal/types'

/**
 * As ESLint splits it: a scoped plugin's name ends at the last `/`, as in
 * `@gpahal/markdown/heading-increment`, an unscoped one's at the first, as in
 * `n/no-unsupported-features/es-builtins`
 */
export function parseRuleId(ruleId: string): { pluginName?: string; ruleName: string } {
  if (!ruleId.includes('/')) {
    return { ruleName: ruleId }
  }
  const slash = ruleId.startsWith('@') ? ruleId.lastIndexOf('/') : ruleId.indexOf('/')
  return { pluginName: ruleId.slice(0, slash), ruleName: ruleId.slice(slash + 1) }
}

export function getPlugins(
  configs: ReadonlyArray<Pick<Linter.Config, 'plugins'>>,
): ReadonlyMap<string, ESLint.Plugin> {
  return new Map(configs.flatMap((config) => Object.entries(config.plugins ?? {})))
}

/**
 * Only its `disable-type-checked` config lists them, as of 5.21, with their `x-` aliases
 */
const ESLINT_REACT_TYPED_RULES = [
  'no-implicit-children',
  'no-implicit-key',
  'no-implicit-ref',
  'no-leaked-conditional-rendering',
  'no-unused-props',
].flatMap((rule) => [`@eslint-react/${rule}`, `@eslint-react/x-${rule}`])

/**
 * Typed rules that throw without type information yet don't set `meta.docs.requiresTypeChecking`:
 * @e18e/eslint-plugin 0.8.1's that call `getTypedParserServices`, and @eslint-react's.
 * `tests/upstream-workarounds.test.ts` fails once either plugin flags its rules: then remove them
 */
export const UNFLAGGED_TYPED_RULES: ReadonlyArray<string> = [
  'e18e/no-indexof-equality',
  ...ESLINT_REACT_TYPED_RULES,
]

export function needsTypeInformation(
  rule: string,
  plugins: ReadonlyMap<string, ESLint.Plugin>,
): boolean {
  if (UNFLAGGED_TYPED_RULES.includes(rule)) {
    return true
  }
  const { pluginName, ruleName } = parseRuleId(rule)
  const docs: unknown =
    pluginName === undefined ? undefined : plugins.get(pluginName)?.rules?.[ruleName]?.meta?.docs
  return isRecord(docs) && docs['requiresTypeChecking'] === true
}

export function pickRules(rules: LooseRules, names: Iterable<string>): LooseRules {
  const picked = new Set(names)
  return Object.fromEntries(Object.entries(rules).filter(([name]) => picked.has(name)))
}

/**
 * A function default runs only when the option is left out, since it may look up files
 */
export function isEnabled(option: unknown, isOnByDefault: boolean | (() => boolean)): boolean {
  if (option !== undefined) {
    return option !== false
  }
  return typeof isOnByDefault === 'function' ? isOnByDefault() : isOnByDefault
}

export function isRuleOn(entry: unknown): boolean {
  const severity: unknown = Array.isArray(entry) ? entry[0] : entry
  return severity !== undefined && severity !== 'off' && severity !== 0
}

function isWarnSeverity(severity: unknown): boolean {
  return severity === 'warn' || severity === 1
}

function isWarnEntry(entry: unknown): boolean {
  return isWarnSeverity(Array.isArray(entry) ? entry[0] : entry)
}

/**
 * A skipped test is often deliberate, as for a known failure, but shouldn't go unnoticed
 */
export const PRESET_WARNINGS: ReadonlySet<string> = new Set(['vitest/no-disabled-tests'])

function isNormalizedWarning(name: string, entry: unknown): boolean {
  return isWarnEntry(entry) && !PRESET_WARNINGS.has(name)
}

/**
 * Options kept. A changed config is a copy, since its `rules` may be a plugin's own object
 */
export function normalizeSeverities(configs: Array<TypedConfig>): Array<TypedConfig> {
  return configs.map((config) => {
    const { rules } = config
    if (
      !rules ||
      Object.entries(rules).every(([name, entry]) => !isNormalizedWarning(name, entry))
    ) {
      return config
    }
    const normalized: Record<string, unknown> = {}
    for (const [name, entry] of Object.entries(rules)) {
      const options: Array<unknown> = Array.isArray(entry) ? entry.slice(1) : []
      normalized[name] = isNormalizedWarning(name, entry) ? ['error', ...options] : entry
    }
    return { ...config, rules: normalized }
  })
}

export function getRules(
  option: boolean | { rules?: LooseRules | undefined } | undefined,
): LooseRules {
  return resolveSubOptions(option)?.rules ?? {}
}
