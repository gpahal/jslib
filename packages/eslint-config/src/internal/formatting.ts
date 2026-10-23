import eslintConfigPrettier from 'eslint-config-prettier'

import { formatMessageList, formatNames } from '@gpahal/std/errors'

import { isRuleOn } from '@/internal/rules'
import type { TypedConfig } from '@/internal/types'
import { fail, PREFIX } from '@/internal/utils'

/**
 * `no-unexpected-multiline` reports a line starting with `(`, `[` or a template literal that
 * continues the line before, which code without semicolons can do by mistake. Prettier's output
 * never does
 */
export const KEPT_RULES: ReadonlySet<string> = new Set(['no-unexpected-multiline'])

/**
 * The layout rules of the plugins that the `html` and `astro` presets load, which
 * eslint-config-prettier doesn't list. Prettier formats `.html` and `.astro` files, so each conflicts
 * with it or is only safe with some options. html-eslint's other "Style" rules, such as
 * `sort-attrs`, don't touch layout
 */
const PRESET_LAYOUT_RULES: ReadonlySet<string> = new Set([
  '@html-eslint/attrs-newline',
  '@html-eslint/class-spacing',
  '@html-eslint/element-newline',
  '@html-eslint/indent',
  '@html-eslint/no-extra-spacing-attrs',
  '@html-eslint/no-extra-spacing-tags',
  '@html-eslint/no-extra-spacing-text',
  '@html-eslint/no-multiple-empty-lines',
  '@html-eslint/no-trailing-spaces',
  '@html-eslint/quotes',
  'astro/semi',
])

/**
 * Conflicting with Prettier or safe only with some options
 */
export const FORMATTING_RULES: ReadonlySet<string> = new Set([
  ...Object.keys(eslintConfigPrettier.rules).filter((rule) => !KEPT_RULES.has(rule)),
  ...PRESET_LAYOUT_RULES,
])

const FORMATTING_RULE_DESCRIPTION =
  'is a rule that eslint-config-prettier turns off, since it conflicts with Prettier or is only safe with some options'

const LAYOUT_RULE_DESCRIPTION =
  'is a layout rule for files that Prettier formats, so it conflicts with Prettier or is only safe with some options'

function describeFormattingRule(rule: string): string {
  return PRESET_LAYOUT_RULES.has(rule) ? LAYOUT_RULE_DESCRIPTION : FORMATTING_RULE_DESCRIPTION
}

/**
 * All in one error, since a plugin's preset may have a dozen
 */
export function checkFormattingRules(
  subjects: ReadonlyArray<string>,
  rules: object,
  allowed: ReadonlyArray<string>,
  hint = '',
): void {
  const found = Object.entries(rules)
    .filter(
      ([rule, entry]) => FORMATTING_RULES.has(rule) && !allowed.includes(rule) && isRuleOn(entry),
    )
    .map(([rule]) => rule)
  const [first] = found
  if (first === undefined) {
    return
  }
  if (found.length === 1) {
    fail(
      [...subjects, formatNames([first])],
      `${describeFormattingRule(first)}.${hint} Turn it off, or list it in \`allowFormattingRules\``,
    )
  }
  const items = found.map((rule) => ({
    subjects: [formatNames([rule])],
    description: describeFormattingRule(rule),
  }))
  throw new TypeError(
    `${formatMessageList(PREFIX, subjects, items)}\n${hint.trim()}${hint === '' ? '' : ' '}Turn them off, or list them in \`allowFormattingRules\``,
  )
}

/**
 * Taking them out, rather than turning them off after, keeps every other rule where the configs put
 * it. A changed config is a copy, since its `rules` may be a plugin's own object
 */
export function withoutFormattingRules(
  configs: Array<TypedConfig>,
  allowed: ReadonlyArray<string>,
): Array<TypedConfig> {
  const isStripped = (rule: string) => FORMATTING_RULES.has(rule) && !allowed.includes(rule)
  return configs.map((config) => {
    const { rules } = config
    if (!rules || !Object.keys(rules).some(isStripped)) {
      return config
    }
    return {
      ...config,
      rules: Object.fromEntries(Object.entries(rules).filter(([rule]) => !isStripped(rule))),
    }
  })
}

/**
 * Added by the finalizer before the type-aware guards, so a formatting rule that an `onResolved`
 * callback turns on in place, where the checks don't look, is off too
 */
export function formattingOffConfig(
  files: ReadonlyArray<string>,
  allowed: ReadonlyArray<string>,
): TypedConfig {
  return {
    name: 'gpahal/formatting/off',
    files: [...files],
    rules: Object.fromEntries(
      [...FORMATTING_RULES].filter((rule) => !allowed.includes(rule)).map((rule) => [rule, 'off']),
    ),
  }
}
