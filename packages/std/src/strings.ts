/**
 * String helpers. Contract: strings from the developer's own code. `shorten`, the trims and
 * `escapeControls` run in linear time, so they also take untrusted strings. `toString` runs an
 * object's own conversion methods, so it takes trusted objects only
 */

import { describeValue } from '@/internal/describe'
import { lazy } from '@/internal/lazy'
import { stdMessage } from '@/internal/message'
import { checkNumber, checkOptions } from '@/internal/options'
import { isSymbol } from '@/symbols'

export { escapeControls } from '@/internal/escape'

/**
 * Convert a value to a string as `String()` does, except that `null` and `undefined` become `''`,
 * `-0` becomes `'-0'`, also in an array, and a symbol gives `Symbol(description)` instead of
 * throwing. An object that can't become a primitive, such as `Object.create(null)`, gives
 * `Object.prototype.toString`'s result. Errors from an object's conversion methods aren't caught
 */
export function toString(value: unknown): string {
  return toStringInternal(value, undefined)
}

/**
 * The longest string V8 makes, the lowest limit of the major engines, so an array with more commas
 * fails up front
 */
const MAX_STRING_LENGTH = 2 ** 29 - 24

const ARRAY_JOIN_CHUNK_SIZE = 4096

function toStringInternal(
  value: unknown,
  arraysBeingJoined: Set<Array<unknown>> | undefined,
): string {
  if (value == null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    if (arraysBeingJoined?.has(value) === true) {
      return ''
    }
    if (value.length - 1 > MAX_STRING_LENGTH) {
      throw new RangeError(
        stdMessage(
          ['`toString`'],
          `an array of ${value.length} items gives a string longer than ${MAX_STRING_LENGTH} characters`,
        ),
      )
    }

    const joining = arraysBeingJoined ?? new Set()
    joining.add(value)
    try {
      // An index loop rather than `map`, which would construct the array's species. Joining by
      // chunk keeps memory near the string's size, where one `+=` per item keeps a node per item
      let result = ''
      const parts: Array<string> = []
      for (let start = 0; start < value.length; start += ARRAY_JOIN_CHUNK_SIZE) {
        const end = Math.min(start + ARRAY_JOIN_CHUNK_SIZE, value.length)
        parts.length = 0
        for (let index = start; index < end; index++) {
          parts.push(toStringInternal(value[index], joining))
        }
        result += `${start === 0 ? '' : ','}${parts.join(',')}`
      }
      return result
    } finally {
      joining.delete(value)
    }
  }
  if (isSymbol(value)) {
    // Not `value.toString()`, which a boxed symbol can override
    return Symbol.prototype.toString.call(value)
  }
  if (typeof value === 'number') {
    return Object.is(value, -0) ? '-0' : String(value)
  }
  return typeof value === 'boolean' || typeof value === 'bigint'
    ? String(value)
    : objectToString(value)
}

function isBoxedNegativeZero(value: object): boolean {
  if (Object.prototype.toString.call(value) !== '[object Number]') {
    return false
  }

  try {
    return Object.is(Number.prototype.valueOf.call(value), -0)
  } catch {
    // A fake `Symbol.toStringTag`
    return false
  }
}

/**
 * `String(value)`, falling back to `Object.prototype.toString` where `String()` would throw
 */
function objectToString(value: object): string {
  // As in lodash
  if (isBoxedNegativeZero(value)) {
    return '-0'
  }

  // The lookup order of `String()`, with the string hint
  const toPrimitive: unknown = Reflect.get(value, Symbol.toPrimitive)
  return (
    (toPrimitive == null
      ? (callForPrimitiveString(value, Reflect.get(value, 'toString'), []) ??
        callForPrimitiveString(value, Reflect.get(value, 'valueOf'), []))
      : callForPrimitiveString(value, toPrimitive, ['string'])) ??
    Object.prototype.toString.call(value)
  )
}

function callForPrimitiveString(
  value: object,
  method: unknown,
  args: Array<unknown>,
): string | undefined {
  if (typeof method !== 'function') {
    return undefined
  }

  const result: unknown = method.apply(value, args)
  if (result !== null && (typeof result === 'object' || typeof result === 'function')) {
    return undefined
  }
  return typeof result === 'symbol' ? result.toString() : String(result)
}

/**
 * Add `prefix` if missing
 */
export function ensurePrefix(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s : `${prefix}${s}`
}

/**
 * Add `suffix` if missing
 */
export function ensureSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s : `${s}${suffix}`
}

/**
 * Remove one leading `prefix` if present
 */
export function stripPrefix(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s
}

/**
 * Remove one trailing `suffix` if present
 */
export function stripSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s
}

function checkTrimArguments(caller: string, s: unknown, chars: unknown): void {
  checkString(caller, s)
  if (chars !== undefined && typeof chars !== 'string') {
    throw new TypeError(
      stdMessage(
        [caller, '`chars`'],
        `expected a string or \`undefined\`, received ${describeValue(chars)}`,
      ),
    )
  }
}

function checkString(caller: string, s: unknown): void {
  if (typeof s !== 'string') {
    throw new TypeError(
      stdMessage([caller, '`s`'], `expected a string, received ${describeValue(s)}`),
    )
  }
}

// The trims scan rather than use a `[chars]+$` regex, which backtracks quadratically on long runs
// of `chars` that aren't at the end

/**
 * Remove leading `chars`, a set of literal code points, from `s`, or leading whitespace without
 * `chars`. Arguments of the wrong type throw a `TypeError`
 */
export function trimStart(s: string, chars?: string): string {
  checkTrimArguments('`trimStart`', s, chars)
  return trimStartUnchecked(s, chars)
}

function trimStartUnchecked(s: string, chars: string | undefined): string {
  if (chars === undefined) {
    return s.trimStart()
  }

  const charSet = new Set(chars)
  let start = 0
  for (const char of s) {
    if (!charSet.has(char)) {
      break
    }
    start += char.length
  }
  return s.slice(start)
}

/**
 * Remove trailing `chars`, a set of literal code points, from `s`, or trailing whitespace without
 * `chars`. Arguments of the wrong type throw a `TypeError`
 */
export function trimEnd(s: string, chars?: string): string {
  checkTrimArguments('`trimEnd`', s, chars)
  return trimEndUnchecked(s, chars)
}

function trimEndUnchecked(s: string, chars: string | undefined): string {
  if (chars === undefined) {
    return s.trimEnd()
  }

  const charSet = new Set(chars)
  let end = s.length
  while (end > 0) {
    const start = skipCodePointBackward(s, end)
    const char = s.slice(start, end)
    if (!charSet.has(char)) {
      break
    }
    end = start
  }
  return s.slice(0, end)
}

/**
 * Whether a surrogate pair starts at `index`
 */
function isSurrogatePairAt(s: string, index: number): boolean {
  return (s.codePointAt(index) ?? 0) > 0xff_ff
}

/**
 * Remove leading and trailing `chars`, a set of literal code points, from `s`, or whitespace without
 * `chars`. Arguments of the wrong type throw a `TypeError`
 */
export function trim(s: string, chars?: string): string {
  checkTrimArguments('`trim`', s, chars)
  return trimEndUnchecked(trimStartUnchecked(s, chars), chars)
}

/**
 * Splits as lodash does, and on apostrophes too. Every letter takes the combining marks that follow
 * it, so a decomposed `É` stays uppercase. Runs of `Lo` (such as CJK) and `Lm` are words of their
 * own. The lookbehinds try an ordinal and an uppercase run only from a run's first character, so a
 * long run isn't rescanned from each character. A bare pictograph matches before `\p{RGI_Emoji}` is
 * tried, since V8 tries each of that set's sequences first, which is slow on long runs of emoji
 */
function getWordRegexSource(): string {
  return String.raw`[\p{Extended_Pictographic}--\p{L}](?![\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}])|\p{RGI_Emoji}|(?<!\d)\d*(?:1st|2nd|3rd|\dth)(?![\p{Ll}\d])|(?<!\d)\d*(?:1ST|2ND|3RD|\dTH)(?![\p{Lu}\d])|(?<!\p{Lu})(?:\p{Lu}\p{M}*)+(?=\p{Lu}\p{M}*\p{Ll})|(?:\p{Lu}\p{M}*)?(?:\p{Ll}\p{M}*)+|(?:\p{Lu}\p{M}*)+|\p{Lt}\p{M}*(?:\p{Ll}\p{M}*)*|[\p{Lo}\p{Lm}][\p{Lo}\p{Lm}\p{M}]*|\p{N}+|\p{Extended_Pictographic}`
}

/**
 * Compiled on first use, since a `v`-flag regex literal is an early `SyntaxError` where the flag
 * isn't supported, so loading this module, and `urls` through it, would need the flag
 */
const getWordRegex = lazy(() => new RegExp(getWordRegexSource(), 'gv'))

/**
 * The ASCII apostrophe, the single quotation marks often typed for it, and the modifier letter
 * apostrophe
 */
const APOSTROPHE_REGEX = /['\u{2018}\u{2019}\u{2BC}]/gu

/**
 * Holds the `source` getter, which throws for an object without a `RegExp`'s internal slots, so a
 * fake with a `Symbol.toStringTag` or a proxy fails it, and a `RegExp` from another realm passes
 */
const REGEXP_SOURCE = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')

function isRegExp(value: unknown): value is RegExp {
  // The getter gives `(?:)` for `RegExp.prototype`, which has no internal slots
  if (
    value === null ||
    typeof value !== 'object' ||
    value === RegExp.prototype ||
    REGEXP_SOURCE?.get === undefined
  ) {
    return false
  }
  try {
    REGEXP_SOURCE.get.call(value)
    return true
  } catch {
    return false
  }
}

/**
 * `String#match` returns only the first match without the `g` flag, and stops at the first
 * non-matching position with the `y` flag
 */
function toGlobalRegex(pattern: string | RegExp): RegExp {
  if (typeof pattern === 'string') {
    try {
      return new RegExp(pattern, 'gu')
    } catch (error) {
      throw new SyntaxError(
        stdMessage(
          ['`words`', '`pattern`'],
          `expected a valid regular expression, received ${describeValue(pattern)}`,
        ),
        { cause: error },
      )
    }
  }
  return pattern.global && !pattern.sticky
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags.replace('y', '')}${pattern.global ? '' : 'g'}`)
}

/**
 * Split `s` into its words. By default, it splits on separators, case changes (`fooBar`,
 * `XMLHttp`) and letter-digit boundaries, and keeps an emoji, a number with an ordinal suffix
 * (`1st`) and a run of letters without case (CJK) as words of their own. Unlike lodash's `words`,
 * an apostrophe splits a word: `don't` gives `['don', 't']`.
 *
 * A custom `pattern` gives the non-empty strings it matches. A string pattern gets the `u` flag,
 * and a regex always gets the `g` flag and loses the `y` flag. Arguments of the wrong type throw a
 * `TypeError`, and an invalid string `pattern` a `SyntaxError`
 *
 * @example
 * ```ts
 * import { words } from '@gpahal/std/strings'
 *
 * words('fooBar XMLHttp_2nd') // ['foo', 'Bar', 'XML', 'Http', '2nd']
 * words('a-b c', /[^\s-]+/) // ['a', 'b', 'c']
 * ```
 */
export function words(s: string, pattern?: string | RegExp): Array<string> {
  checkString('`words`', s)
  const untypedPattern: unknown = pattern
  if (
    untypedPattern !== undefined &&
    typeof untypedPattern !== 'string' &&
    !isRegExp(untypedPattern)
  ) {
    throw new TypeError(
      stdMessage(
        ['`words`', '`pattern`'],
        `expected a string, a \`RegExp\` or \`undefined\`, received ${describeValue(untypedPattern)}`,
      ),
    )
  }
  if (pattern === undefined) {
    return s.match(getWordRegex()) ?? []
  }
  // A pattern that can match nothing, like `/(?:)/`, gives an empty match between characters
  return (s.match(toGlobalRegex(pattern)) ?? []).filter((word) => word !== '')
}

function upperFirst(s: string): string {
  const firstCodePoint = s.codePointAt(0)
  if (firstCodePoint === undefined) {
    return s
  }

  const first = String.fromCodePoint(firstCodePoint)
  return first.toUpperCase() + s.slice(first.length)
}

/**
 * `s` in camel case, from its {@link words} without apostrophes: `'foo bar'` becomes `'fooBar'`.
 * Each later word's first letter is uppercased, not titlecased, so `ß` becomes `SS` and `ǆ` becomes
 * `Ǆ` rather than `ǅ`
 */
export function camelCase(s: string): string {
  return words(s.replaceAll(APOSTROPHE_REGEX, ''))
    .map((word, index) => (index === 0 ? word.toLowerCase() : upperFirst(word.toLowerCase())))
    .join('')
}

/**
 * `s` in kebab case, from its {@link words} without apostrophes: `'fooBar'` becomes `'foo-bar'`
 */
export function kebabCase(s: string): string {
  return words(s.replaceAll(APOSTROPHE_REGEX, ''))
    .map((word) => word.toLowerCase())
    .join('-')
}

export type ShortenOptions = {
  /**
   * What replaces the middle of a shortened string. Default is `'…'`, one character
   */
  ellipsis?: string | undefined
}

const MAX_FULLY_SEGMENTED_LENGTH = 10_000

const WINDOW_CODE_UNITS_PER_GRAPHEME = 64

/**
 * Emoji sequences and flags fit. A stack of combining marks, as in Zalgo text, may not
 */
const MAX_GRAPHEME_CODE_UNITS = 32

function capGrapheme(grapheme: string): string {
  return grapheme.length <= MAX_GRAPHEME_CODE_UNITS
    ? grapheme
    : grapheme.slice(0, toCodePointStart(grapheme, MAX_GRAPHEME_CODE_UNITS))
}

function joinCapped(graphemes: ReadonlyArray<string>): string {
  return graphemes.map((grapheme) => capGrapheme(grapheme)).join('')
}

/**
 * Replace the middle with `ellipsis` to keep at most `maxLen` grapheme clusters, 10 by default,
 * keeping both ends. If the ellipsis and a cluster on each side don't fit, truncate instead.
 * Combining marks can merge with the ellipsis, leaving fewer clusters.
 *
 * Each cluster kept is cut to its first 32 code units, which emoji sequences and flags fit, so the
 * result has at most `maxLen * 32` code units plus the ellipsis, even for Zalgo text. Inputs over
 * 10,000 code units and `maxLen * 128` segment only the first and last `maxLen * 64` code units,
 * whose edges can cut clusters or change flag pairing, and are always shortened.
 *
 * @throws RangeError if `maxLen` isn't a non-negative integer
 * @throws TypeError if an argument has the wrong type
 */
export function shorten(s: string, maxLen = 10, options: ShortenOptions = {}): string {
  checkString('`shorten`', s)
  checkOptions('`shorten`', options)
  const { ellipsis = '…' } = options
  if (typeof ellipsis !== 'string') {
    throw new TypeError(
      stdMessage(
        ['`shorten`', '`options.ellipsis`'],
        `expected a string or \`undefined\`, received ${describeValue(ellipsis)}`,
      ),
    )
  }
  checkNumber('`shorten`', '`maxLen`', maxLen, 'a number or `undefined`')
  if (!Number.isSafeInteger(maxLen) || maxLen < 0) {
    throw new RangeError(
      stdMessage(
        ['`shorten`', '`maxLen`'],
        `expected a non-negative integer, received ${describeValue(maxLen)}`,
      ),
    )
  }
  // A string has at least as many code units as grapheme clusters, and this one's fit the cap
  if (s.length <= maxLen && s.length <= MAX_GRAPHEME_CODE_UNITS) {
    return s
  }

  const window = maxLen * WINDOW_CODE_UNITS_PER_GRAPHEME
  const isLong = s.length > MAX_FULLY_SEGMENTED_LENGTH && s.length > 2 * window
  const head = getGraphemes(isLong ? s.slice(0, toCodePointStart(s, window)) : s)
  if (!isLong && head.length <= maxLen) {
    return joinCapped(head)
  }
  const kept = maxLen - getGraphemes(ellipsis).length
  if (kept < 2) {
    return joinCapped(head.slice(0, maxLen))
  }
  const headLength = Math.ceil(kept / 2)
  const tail = isLong ? getGraphemes(s.slice(toCodePointStart(s, s.length - window))) : head
  return `${joinCapped(head.slice(0, headLength))}${ellipsis}${joinCapped(tail.slice(tail.length - (kept - headLength)))}`
}

/**
 * Lazy, so importing this module works where `Intl.Segmenter` is missing
 */
const getGraphemeSegmenter = lazy(() => new Intl.Segmenter(undefined, { granularity: 'grapheme' }))

function getGraphemes(s: string): Array<string> {
  return Array.from(getGraphemeSegmenter().segment(s), ({ segment }) => segment)
}

/**
 * `index`, or the index before it when it's inside a surrogate pair, so a slice there doesn't make
 * a lone surrogate
 */
function toCodePointStart(s: string, index: number): number {
  return index > 0 && isSurrogatePairAt(s, index - 1) ? index - 1 : index
}

/**
 * The index of the code point that ends at `end`, which is above 0
 */
function skipCodePointBackward(s: string, end: number): number {
  return end - (end >= 2 && isSurrogatePairAt(s, end - 2) ? 2 : 1)
}

/**
 * Return `lines` without the blank or whitespace-only lines at the start and the end
 *
 * @example
 * ```ts
 * import { trimBlankLines } from '@gpahal/std/strings'
 *
 * trimBlankLines(['', 'a', '', 'b', '  ']) // ['a', '', 'b']
 * ```
 */
export function trimBlankLines(lines: ReadonlyArray<string>): Array<string> {
  const first = lines.findIndex((line) => line.trim() !== '')
  return first === -1
    ? []
    : lines.slice(first, lines.findLastIndex((line) => line.trim() !== '') + 1)
}
