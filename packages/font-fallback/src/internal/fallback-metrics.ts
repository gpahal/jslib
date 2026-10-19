import {
  describeValue,
  formatMessage,
  formatMessageList,
  formatNames,
  type MessageItem,
} from '@gpahal/std/errors'

import { getFamilySubject } from '@/internal/families'
import { PREFIX } from '@/internal/options'
import type { FontMetrics } from '@/internal/types'

/**
 * The `@font-face` descriptors that make a fallback take the space of the web font, as ratios
 */
export type FallbackOverrides = {
  sizeAdjust: number
  ascentOverride: number
  descentOverride: number
  lineGapOverride: number
}

type OverrideRange = { min: number; max: number; isMinExcluded?: boolean }

/**
 * The range each override must be in. Outside it, the fonts are too unlike for a size-adjusted
 * fallback
 */
const OVERRIDE_RANGES: Readonly<Record<keyof FallbackOverrides, OverrideRange>> = {
  sizeAdjust: { min: 0.5, max: 2 },
  ascentOverride: { min: 0, max: 2, isMinExcluded: true },
  descentOverride: { min: 0, max: 1.5 },
  lineGapOverride: { min: 0, max: 1 },
}

const OVERRIDE_KEYS = [
  'sizeAdjust',
  'ascentOverride',
  'descentOverride',
  'lineGapOverride',
] as const satisfies ReadonlyArray<keyof FallbackOverrides>

/**
 * The overrides that make `fallback` take the space of `original`, with `givenSizeAdjust`, a
 * ratio, in place of the one computed from average widths, if it's given
 */
export function computeOverrides(
  original: FontMetrics,
  fallback: FontMetrics,
  givenSizeAdjust?: number,
): FallbackOverrides {
  // Credits to:
  // https://github.com/seek-oss/capsize/blob/master/packages/core/src/createFontStack.ts
  const sizeAdjust =
    givenSizeAdjust ??
    original.xWidthAvg / original.unitsPerEm / (fallback.xWidthAvg / fallback.unitsPerEm)
  const adjustedEmSquare = original.unitsPerEm * sizeAdjust
  return {
    sizeAdjust,
    ascentOverride: original.ascent / adjustedEmSquare,
    descentOverride: -original.descent / adjustedEmSquare,
    lineGapOverride: original.lineGap / adjustedEmSquare,
  }
}

/**
 * A fallback and its overrides, for {@link checkOverrides}
 */
export type FallbackOverridesEntry = { fallbackFamily: string; overrides: FallbackOverrides }

type DefaultFallbacksIssues = { subject: string; issues: ReadonlyArray<MessageItem> }

/**
 * The issues of each error thrown when every default fallback is out of range. They are kept off
 * the error, which stays a plain `Error`, so the CLI can rebuild its message to name `-f` in place
 * of the `fallbacks` option
 */
const defaultFallbacksIssues = new WeakMap<object, DefaultFallbacksIssues>()

/**
 * The subject and issues of an error that {@link checkOverrides} threw when every default fallback
 * is out of range, or `undefined` for another value
 */
export function getDefaultFallbacksIssues(error: unknown): DefaultFallbacksIssues | undefined {
  return error instanceof Error ? defaultFallbacksIssues.get(error) : undefined
}

/**
 * The error message for default fallbacks that are all out of range, with `fix`, such as
 * ``Set `fallbacks` ``. The summary goes on the first line, after the issue count of a list, so it
 * doesn't read as part of the last issue
 */
export function formatDefaultFallbacksMessage(
  subject: string,
  issues: ReadonlyArray<MessageItem>,
  fix: string,
): string {
  const summary = `Every default fallback is out of range. ${fix}`
  const message = formatMessageList(PREFIX, [subject], issues)
  if (issues.length === 1) {
    return `${message}. ${summary}`
  }
  const header = formatMessage(PREFIX, [subject], `${issues.length} issues`)
  return `${header}. ${summary}${message.slice(header.length)}`
}

/**
 * The entries whose overrides are in range, for the font `subject` names. Given fallbacks must all
 * be; of the default fallbacks, `isDefault`, the ones out of range are left out, keeping the order
 * of the rest
 *
 * @throws If an override of a given fallback, or of every default fallback, isn't finite or is out
 *   of its range. The error lists each such fallback.
 */
export function checkOverrides<T extends FallbackOverridesEntry>(
  subject: string,
  entries: ReadonlyArray<T>,
  isDefault: boolean,
): Array<T> {
  const issues: Array<MessageItem> = []
  const valid: Array<T> = []
  for (const entry of entries) {
    const issue = getOverridesIssue(entry.overrides, entry.fallbackFamily)
    if (issue === undefined) {
      valid.push(entry)
    } else {
      issues.push(issue)
    }
  }
  if (issues.length === 0 || (isDefault && valid.length > 0)) {
    return valid
  }
  if (!isDefault) {
    throw new Error(formatMessageList(PREFIX, [subject], issues))
  }
  const error = new Error(formatDefaultFallbacksMessage(subject, issues, 'Set `fallbacks`'))
  defaultFallbacksIssues.set(error, { subject, issues })
  throw error
}

/**
 * The issue with the first override of `fallbackFamily` that isn't finite or is out of its range,
 * or `undefined`
 */
function getOverridesIssue(
  overrides: FallbackOverrides,
  fallbackFamily: string,
): MessageItem | undefined {
  const issue = getRangeIssue(overrides)
  return issue === undefined
    ? undefined
    : {
        subjects: [getFamilySubject('fallback', fallbackFamily)],
        description: `expected ${issue.name} ${issue.range}, received ${describeValue(issue.received)}. This font is too unlike ${formatNames([fallbackFamily])} for a size-adjusted fallback`,
      }
}

/**
 * Check the overrides computed from the given `sizeAdjust`, a percentage, for the font `subject`
 * names. They don't depend on the fallback, so an override out of range is the `sizeAdjust`'s
 *
 * @throws If an override isn't finite or is out of its range.
 */
export function checkSizeAdjustOverrides(
  subject: string,
  overrides: FallbackOverrides,
  sizeAdjust: number,
): void {
  const issue = getRangeIssue(overrides)
  if (issue !== undefined) {
    throw new Error(
      formatMessage(
        PREFIX,
        [subject, formatNames(['sizeAdjust'])],
        `expected a value that gives ${issue.name} ${issue.range}, received ${describeValue(sizeAdjust)}, which gives ${describeValue(issue.received)}. Set another \`sizeAdjust\`, or drop it`,
      ),
    )
  }
}

/**
 * The first override that isn't finite or is out of its range: its name with an article, such as
 * ``an `ascentOverride` ``, its range and its value, rounded for reading, or `undefined`
 */
function getRangeIssue(
  overrides: FallbackOverrides,
): { name: string; range: string; received: number } | undefined {
  for (const key of OVERRIDE_KEYS) {
    const { min, max, isMinExcluded = false } = OVERRIDE_RANGES[key]
    const value = overrides[key]
    const isInRange = (number: number): boolean =>
      Number.isFinite(number) && (isMinExcluded ? number > min : number >= min) && number <= max
    if (!isInRange(value)) {
      // Rounded for reading, unless rounding lands in the range, as 2.00004 does on 2
      const rounded = Number(value.toFixed(4))
      return {
        name: `${key === 'ascentOverride' ? 'an' : 'a'} \`${key}\``,
        range: isMinExcluded ? `over ${min} and at most ${max}` : `from ${min} to ${max}`,
        received: rounded === min || rounded === max || isInRange(rounded) ? value : rounded,
      }
    }
  }
  return undefined
}
