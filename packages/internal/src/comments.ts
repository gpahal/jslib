/**
 * Reads the lines of block comments, for the comment-layout rules of the config packages.
 * Contract: trusted values from the developer's own code. Hostile getters, proxies and iterators
 * aren't supported
 */

import { trimBlankLines } from '@gpahal/std/strings'

const STARRED_LINE_REGEX = /^\s*\*(?:\**\s*$|@|(?!\*)[^\p{L}\p{N}\s]*(?:\s|$))/u
const STAR_PREFIX_REGEX = /^\s*\*\s?/
const LEADING_STAR_REGEX = /^\s*\*/
const LEADING_WHITESPACE_REGEX = /^\s*/

/**
 * Check if a line of a block comment starts with a JSDoc-style star prefix: a `*` followed by the
 * end of the line, whitespace, `@`, which TypeScript reads as a tag, or a run of punctuation that
 * ends the line or is followed by whitespace, as in a banner's ` *-----`. A `*` that starts text, as
 * in ` *bold*`, ` *.css` or the typo ` *b`, isn't a prefix.
 *
 * @example
 * ```ts
 * import { isStarredCommentLine } from '@gpahal/internal/comments'
 *
 * isStarredCommentLine(' * text') // true
 * isStarredCommentLine(' *bold*') // false
 * ```
 */
export function isStarredCommentLine(line: string): boolean {
  return STARRED_LINE_REGEX.test(line)
}

const LINE_TERMINATOR_REGEX = /\r\n|[\n\r\u{2028}\u{2029}]/u

const UNUSUAL_LINE_TERMINATOR_REGEX = /[\u{2028}\u{2029}]|\r(?!\n)/u

/**
 * Check if a block comment's inner text has a line terminator other than LF and CRLF. A fix that
 * rewrites the lines would change them, and where they end a `//` comment, as in JavaScript, could
 * turn text into code.
 *
 * @example
 * ```ts
 * import { hasUnusualLineTerminator } from '@gpahal/internal/comments'
 *
 * hasUnusualLineTerminator(' One\r   two ') // true
 * hasUnusualLineTerminator(' One\r\n   two ') // false
 * ```
 */
export function hasUnusualLineTerminator(inner: string): boolean {
  return UNUSUAL_LINE_TERMINATOR_REGEX.test(inner)
}

/**
 * Check if the non-blank lines of a block comment's inner text after the first mix lines with and
 * without a star prefix, as in a JSDoc block where one line lost its `*`.
 *
 * @example
 * ```ts
 * import { hasMixedStarPrefixes } from '@gpahal/internal/comments'
 *
 * hasMixedStarPrefixes('*\n * One\n   two\n ') // true
 * hasMixedStarPrefixes('*\n * One\n * two\n ') // false
 * ```
 */
export function hasMixedStarPrefixes(inner: string): boolean {
  const lines = getNonBlankLinesAfterFirst(inner)
  return lines.some(isStarredCommentLine) && !lines.every(isStarredCommentLine)
}

/**
 * Check if a line of a block comment's inner text starts with a `*` that isn't a star prefix, as in
 * ` *Important*: text`, `/**Note**` or `/***`. Such a `*` may be text or a star prefix missing its
 * space, so a fix can't tell which layout the comment has.
 *
 * @example
 * ```ts
 * import { hasTextStar } from '@gpahal/internal/comments'
 *
 * hasTextStar('*\n *Important*: call init first.\n ') // true
 * hasTextStar('*Note**: keep this\n   in sync ') // true
 * hasTextStar('*\n * Important: call init first.\n ') // false
 * ```
 */
export function hasTextStar(inner: string): boolean {
  const first = inner.split(LINE_TERMINATOR_REGEX, 1)[0] ?? ''
  return (
    (first.startsWith('*') &&
      (!isStarredCommentLine(first) || LEADING_STAR_REGEX.test(first.slice(1)))) ||
    getNonBlankLinesAfterFirst(inner).some(
      (line) => LEADING_STAR_REGEX.test(line) && !isStarredCommentLine(line),
    )
  )
}

function getNonBlankLinesAfterFirst(inner: string): Array<string> {
  return inner
    .split(LINE_TERMINATOR_REGEX)
    .slice(1)
    .filter((line) => line.trim() !== '')
}

/**
 * Get the text lines of a block comment from its inner text, split on every JavaScript line
 * terminator. It drops a `*` right after `/*`, the star prefixes when every non-blank line after the
 * first has one, then shared indentation, trailing whitespace and blank lines at the ends. A `*`
 * that starts text stays, unlike in TypeScript.
 *
 * @example
 * ```ts
 * import { getBlockCommentLines } from '@gpahal/internal/comments'
 *
 * getBlockCommentLines('*\n * One\n *   two\n ') // ['One', '  two']
 * getBlockCommentLines('* Usage:\n *     run()\n ') // ['Usage:', '   run()']
 * getBlockCommentLines('*\n *Note\n ') // ['*Note']
 * ```
 */
export function getBlockCommentLines(inner: string): Array<string> {
  const [first = '', ...rest] = (inner.startsWith('*') ? inner.slice(1) : inner).split(
    LINE_TERMINATOR_REGEX,
  )
  const isStarred =
    rest.some((line) => line.trim() !== '') &&
    rest.every((line) => line.trim() === '' || LEADING_STAR_REGEX.test(line))
  const unstarred = isStarred
    ? rest.map((line) =>
        line.replace(isStarredCommentLine(line) ? STAR_PREFIX_REGEX : LEADING_WHITESPACE_REGEX, ''),
      )
    : rest
  const indents = unstarred
    .filter((line) => line.trim() !== '')
    .map((line) => line.length - line.trimStart().length)
  // Not `Math.min(...indents)`, whose arguments overflow the stack for a comment of over 100k lines
  const minIndent = indents.reduce((min, indent) => Math.min(min, indent), indents[0] ?? 0)
  // A star prefix ends 2 columns right of the `/`, where text after `/*` starts and text after
  // `/**` starts 1 column further
  const firstIndent = first.length - first.trimStart().length
  const firstMargin = Math.max(inner.startsWith('*') ? firstIndent : firstIndent - 1, 0)
  const shared = isStarred && first.trim() !== '' ? Math.min(firstMargin, minIndent) : minIndent
  return trimBlankLines([
    first.trim(),
    ...unstarred.map((line) => (line.trim() === '' ? '' : line.slice(shared).trimEnd())),
  ])
}
