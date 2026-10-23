/**
 * Lists in messages, joined as `formatNames` from `@gpahal/std/errors` joins them: "a, b and c",
 * without a comma before the conjunction. Contract: trusted strings from the packages' own code
 */

import { formatNames } from '@gpahal/std/errors'

/**
 * Join the items as they are, as in "a, b or c". One item is itself, and none is `''`.
 *
 * @example
 * ```ts
 * import { joinList } from '@gpahal/internal/lists'
 *
 * joinList(['a', 'b', 'c'], 'or') // 'a, b or c'
 * ```
 */
export function joinList(items: ReadonlyArray<string>, conjunction: 'and' | 'or'): string {
  if (items.length < 2) {
    return items[0] ?? ''
  }
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1) ?? ''}`
}

/**
 * Format the first `max` names quoted, as in "`a`, `b` and 3 more", or all of them, as in "`a` and
 * `b`".
 *
 * @example
 * ```ts
 * import { formatSomeNames } from '@gpahal/internal/lists'
 *
 * formatSomeNames(['a', 'b', 'c'], 2) // '`a`, `b` and 1 more'
 * ```
 */
export function formatSomeNames(names: ReadonlyArray<string>, max: number): string {
  return names.length > max
    ? `${formatNames(names.slice(0, max))} and ${String(names.length - max)} more`
    : formatNames(names, { conjunction: 'and' })
}
