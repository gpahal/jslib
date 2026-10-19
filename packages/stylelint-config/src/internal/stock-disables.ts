import type { PostcssResult } from 'stylelint'

/**
 * Whether a disable comment that names `stockRule`, which an own rule replaces, covers `line`.
 * Stylelint matches disable comments by the reporting rule's name, and a plugin rule can't take a
 * built-in rule's name: plugin names need a `/`, and a built-in name always loads the built-in. A
 * covered warning is recorded under the stock name, so `reportNeedlessDisables` counts the comment
 * as used. When a disable of `ownRule` also covers it, the rule reports the warning, which
 * stylelint then records under the own name, so a comment that names both rules uses both. With
 * `ignoreDisables`, the warning is still reported
 */
export function isDisabledByStockRule(
  result: PostcssResult,
  stockRule: string,
  ownRule: string,
  line: number | undefined,
): boolean {
  if (line === undefined) {
    return false
  }
  const { disabledRanges, config } = result.stylelint
  const isCovered = (rule: string) =>
    (disabledRanges[rule] ?? []).some(
      ({ start, end }) => start <= line && (end === undefined || end >= line),
    )
  if (!isCovered(stockRule)) {
    return false
  }
  ;(result.stylelint.disabledWarnings ??= []).push({ rule: stockRule, line })
  return config?.ignoreDisables !== true && !isCovered(ownRule)
}

/**
 * Whether the final config turns on `stockRule`, which an own rule replaces. A user who sets the
 * stock rule to options under `extends` gets the stock rule in place of the own rule, which then
 * steps aside rather than report each problem again. A user's `null` can't turn the own rule off
 * this way: Stylelint normalizes `null`, `[null]` and `[null, {}]` to `null`, the preset's own
 * setting of the stock rule, so the two can't be told apart
 */
export function isStockRuleOn(result: PostcssResult, stockRule: string): boolean {
  return result.stylelint.config?.rules?.[stockRule] != null
}
