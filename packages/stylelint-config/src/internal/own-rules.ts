import { CUSTOM_PROPERTY_EMPTY_LINE_BEFORE } from '@/internal/custom-property-empty-line-before'
import { DECLARATION_EMPTY_LINE_BEFORE } from '@/internal/declaration-empty-line-before'
import { QUOTE_OWN_RULES } from '@/internal/quote-rules'
import type { StylelintRules } from '@/internal/rules'

/**
 * The stock rules that own rules replace, with the own rule of each
 */
export const OWN_RULES: ReadonlyArray<readonly [stock: string, own: string]> = [
  ['custom-property-empty-line-before', CUSTOM_PROPERTY_EMPTY_LINE_BEFORE],
  ['declaration-empty-line-before', DECLARATION_EMPTY_LINE_BEFORE],
  ...QUOTE_OWN_RULES,
]

/**
 * `rules` with the setting of each stock rule in {@link OWN_RULES} given to the own rule that
 * replaces it. A setting of the own rule wins
 */
export function toOwnRules(rules: Readonly<Record<string, unknown>>): StylelintRules {
  let ownedRules: Readonly<Record<string, unknown>> = rules
  for (const [stock, own] of OWN_RULES) {
    const { [stock]: setting, ...rest } = ownedRules
    if (setting !== undefined) {
      ownedRules = { ...rest, [own]: rest[own] === undefined ? setting : rest[own] }
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Each own rule takes the options of the stock rule it replaces
  return ownedRules as StylelintRules
}
