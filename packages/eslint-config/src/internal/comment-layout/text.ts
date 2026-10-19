import type { TSESTree } from '@typescript-eslint/utils'

import { getBlockCommentLines } from '@gpahal/internal/comments'

import { docBlockInner, isUnsafeToFix } from '@/internal/comment-layout/classify'

const TERMINATOR_CHAR_REGEX = /[\n\r\u{2028}\u{2029}]/gu

const LINE_TERMINATOR_REGEX = /\r\n|[\n\r\u{2028}\u{2029}]/gu

export type LineStart = (offset: number) => number

/**
 * A binary search, since a walk back could cross a long minified line for each comment. Made once
 * per file, since a cache keyed by the text would compare each call's text
 */
export function createLineStarts(text: string): LineStart {
  let starts: Array<number> | undefined
  return (offset) => {
    starts ??= [
      0,
      ...Array.from(text.matchAll(LINE_TERMINATOR_REGEX), (match) => match.index + match[0].length),
    ]
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if ((starts[middle] ?? 0) <= offset) {
        low = middle
      } else {
        high = middle - 1
      }
    }
    return starts[low] ?? 0
  }
}

function lineEnd(text: string, offset: number): number {
  TERMINATOR_CHAR_REGEX.lastIndex = offset
  return TERMINATOR_CHAR_REGEX.exec(text)?.index ?? text.length
}

/**
 * `undefined` when code other than `prefix` comes first
 */
export function indentBefore(
  text: string,
  lineStart: LineStart,
  offset: number,
  prefix = '',
): string | undefined {
  const lead = text.slice(lineStart(offset), offset)
  const indent = lead.slice(0, lead.length - prefix.length)
  return lead.endsWith(prefix) && indent.trim() === '' ? indent : undefined
}

export function isLastOnLine(text: string, offset: number, suffix = ''): boolean {
  const rest = text.slice(offset, lineEnd(text, offset)).trim()
  return rest === '' || rest === suffix
}

function withLfLineEndings(value: string): string {
  return value.replaceAll(LINE_TERMINATOR_REGEX, '\n')
}

export function starredBlock(
  lines: Array<string>,
  indent: string,
  opener: '/*' | '/**',
  eol = '\n',
): string {
  const body = lines.map((line) => `${indent} *${line === '' ? '' : ` ${line}`}`).join(eol)
  return `${opener}${eol}${body}${eol}${indent} */`
}

export function lineComments(lines: Array<string>, indent: string, eol: string): string {
  return lines.map((line) => (line === '' ? '//' : `// ${line}`)).join(`${eol}${indent}`)
}

/**
 * Without the star runs at its start and end, so `/** a **\/` reads as `a`
 */
export function docBlockLines(value: string): Array<string> {
  return getBlockCommentLines(docBlockInner(value))
}

/**
 * The first line's, or the line's before when it ends the file, or LF in a one-line file
 */
export function lineEndingAt(text: string, lineStart: LineStart, start: number): string {
  const next = lineEnd(text, start)
  if (next < text.length) {
    return text.startsWith('\r\n', next) ? '\r\n' : (text[next] ?? '\n')
  }
  const previous = lineStart(start) - 1
  if (previous < 0) {
    return '\n'
  }
  return text.startsWith('\r\n', previous - 1) ? '\r\n' : (text[previous] ?? '\n')
}

export function skipSpaces(text: string, offset: number): number {
  let end = offset
  while (text[end] === ' ' || text[end] === '\t') {
    end++
  }
  return end
}

/**
 * `undefined` when already starred or uncheckable. `fixed` is `undefined` when a fix isn't safe,
 * and replaces up to `end`, past the spaces before code beside the block, which `movesCode` says
 * moves to its own line. A JSX comment's braces may share its first and last lines
 */
export function starredLayoutFix(
  text: string,
  lineStart: LineStart,
  range: TSESTree.Range,
  value: string,
  opener: '/*' | '/**',
  isJsx = false,
): { fixed: string | undefined; end: number; movesCode: boolean } | undefined {
  const lines = opener === '/**' ? docBlockLines(value) : getBlockCommentLines(value)
  // A JSX comment's ` *` lines sit under the `/` of `{/*`, where Prettier puts them
  const indent = indentBefore(text, lineStart, range[0], isJsx ? '{' : '')
  if (indent === undefined || lines.length === 0) {
    return undefined
  }
  const isAlone = isLastOnLine(text, range[1]) || (isJsx && text.startsWith('}', range[1]))
  // Compared with LF line endings, so a file with other endings isn't reported
  if (
    isAlone &&
    withLfLineEndings(text.slice(range[0], range[1])) === starredBlock(lines, indent, opener)
  ) {
    return undefined
  }
  if (isUnsafeToFix(value, opener === '/**')) {
    return { fixed: undefined, end: range[1], movesCode: !isAlone }
  }
  const eol = lineEndingAt(text, lineStart, range[0])
  const expected = starredBlock(lines, indent, opener, eol)
  return isAlone
    ? { fixed: expected, end: range[1], movesCode: false }
    : { fixed: `${expected}${eol}${indent}`, end: skipSpaces(text, range[1]), movesCode: true }
}
