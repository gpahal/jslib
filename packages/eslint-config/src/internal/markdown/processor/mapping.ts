import type { Linter, Rule } from 'eslint'

import { MARKDOWN_LINE_BREAK_REGEX } from '@/internal/markdown/line-breaks'
import {
  toHtmlPosition,
  type Block,
  type BlockComment,
  type CodeLine,
  type FileState,
} from '@/internal/markdown/processor/blocks'
import type { CommentSyntax } from '@/internal/markdown/processor/comments'
import { isDirectiveMessage } from '@/internal/markdown/processor/directives'

/**
 * `undefined` for an offset in the comments before the code
 */
function findCodeLine(block: Block, offset: number): CodeLine | undefined {
  let low = 0
  let high = block.codeLines.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((block.codeLines[middle]?.js ?? offset) <= offset) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return block.codeLines[low - 1]
}

/**
 * `undefined` in the comments put before the code, or in a part of a line that isn't the file's
 */
function toMarkdownOffset(block: Block, offset: number): number | undefined {
  const codeLine = findCodeLine(block, offset)
  const column = codeLine === undefined ? -1 : offset - codeLine.js
  return codeLine !== undefined && column >= codeLine.mappableFrom && column <= codeLine.length
    ? codeLine.md + column
    : undefined
}

const LINE_BREAK_AND_INDENT_REGEX = new RegExp(
  String.raw`(${MARKDOWN_LINE_BREAK_REGEX.source})([\t ]*)`,
  'gu',
)

/**
 * So a CRLF file stays CRLF. `\n` when the fence ends the file
 */
function lineBreakOf({ text, lines }: FileState, block: Block): string {
  const index = block.node.position.start.line - 1
  const end = lines[index]?.end
  const next = lines[index + 1]?.start
  return end === undefined || next === undefined ? '\n' : text.slice(end, next)
}

/**
 * `undefined` when its range has no place in the Markdown file. New lines get the block's
 * `newLinePrefix`, such as `> `, without trailing whitespace, and its line breaks. A fix on an
 * empty code line shorter than the container's indent replaces the line's start with the prefix
 */
function adjustFix(state: FileState, block: Block, fix: Rule.Fix): Rule.Fix | undefined {
  const { lines } = state
  const codeLine = findCodeLine(block, fix.range[0])
  const start = toMarkdownOffset(block, fix.range[0])
  const end = toMarkdownOffset(block, fix.range[1])
  if (
    codeLine === undefined ||
    start === undefined ||
    end === undefined ||
    (fix.range[0] < block.commentsEnd && fix.range[1] > block.commentsStart)
  ) {
    return undefined
  }
  const prefix = block.newLinePrefix ?? codeLine.prefix ?? block.indentText
  const lineStart = lines[codeLine.line - 1]?.start
  const firstLine = fix.text.split(MARKDOWN_LINE_BREAK_REGEX, 1)[0] ?? ''
  const isTextOnEmptyLine = codeLine.length === 0 && lineStart !== undefined && firstLine !== ''
  const isLineLeftEmpty =
    codeLine.length > 0 &&
    codeLine.prefix !== undefined &&
    lineStart !== undefined &&
    block.text.slice(codeLine.js, fix.range[0]).trim() === '' &&
    firstLine.trim() === '' &&
    (fix.text.length > firstLine.length ||
      ['', '\n', '\r'].includes(block.text.charAt(fix.range[1])))
  const head = isTextOnEmptyLine ? prefix : isLineLeftEmpty ? prefix.trimEnd() : undefined
  const blockLineBreak = lineBreakOf(state, block)
  const fixText =
    isLineLeftEmpty && !isTextOnEmptyLine ? fix.text.slice(firstLine.length) : fix.text
  return {
    range: [head === undefined || lineStart === undefined ? start : lineStart, end],
    text: `${head ?? ''}${fixText.replaceAll(
      LINE_BREAK_AND_INDENT_REGEX,
      (match: string, _lineBreak: string, indent: string, offset: number, text: string) => {
        const next = offset + match.length
        // A line of only whitespace keeps no indent
        const first = next === text.length ? block.text.charAt(fix.range[1]) : text.charAt(next)
        return ['', '\n', '\r'].includes(first)
          ? `${blockLineBreak}${prefix.trimEnd()}`
          : `${blockLineBreak}${prefix}${indent}`
      },
    )}`,
  }
}

/**
 * 1-based. A column below 1, as yaml-eslint-parser gives parse errors, is the line's first
 */
function toBlockOffset(block: Block, line: number, column: number): number | undefined {
  const lineStart = Number.isSafeInteger(line) ? block.lineStarts[line - 1] : undefined
  return lineStart === undefined ? undefined : lineStart + Math.max(column, 1) - 1
}

/**
 * Kept within the line. `undefined` for an empty block, whose messages go on its opening fence
 */
function toMarkdownPosition(
  { lines }: FileState,
  block: Block,
  offset: number,
): { line: number; column: number } | undefined {
  const codeLine = findCodeLine(block, offset)
  const sourceLine = codeLine === undefined ? undefined : lines[codeLine.line - 1]
  if (codeLine === undefined || sourceLine === undefined || codeLine.mappableFrom === Infinity) {
    return undefined
  }
  const md = Math.min(
    Math.max(codeLine.md + offset - codeLine.js, sourceLine.start),
    sourceLine.end,
  )
  return { line: codeLine.line, column: md - sourceLine.start + 1 }
}

/**
 * Maps a message in a comment put before the code to its HTML comment, or to the HTML comment's
 * start for a directive message. Only fatal and directive messages are kept, without an end
 */
function adjustCommentMessage(
  { lines }: FileState,
  { open }: CommentSyntax,
  comment: BlockComment,
  message: Linter.LintMessage,
  offset: number,
): Linter.LintMessage | undefined {
  if (message.fatal !== true && !isDirectiveMessage(message)) {
    return undefined
  }
  // ESLint core reports a directive at its comment's start, as the Markdown file's lint does, but
  // html-eslint at the value, after `<!--`. A fatal message keeps its place
  const inComment = offset - comment.start
  const index = isDirectiveMessage(message)
    ? comment.valueStart
    : comment.valueStart +
      Math.min(
        inComment < open.length ? 0 : inComment + '<!--'.length - open.length,
        `<!--${comment.comment}-->`.length,
      )
  const position = toHtmlPosition(lines, comment, index)
  if (position === undefined) {
    return undefined
  }
  const {
    endLine: _endLine,
    endColumn: _endColumn,
    fix: _fix,
    suggestions: _suggestions,
    ...withoutEndAndFixes
  } = message
  return { ...withoutEndAndFixes, ...position }
}

/**
 * `undefined` for a message about a rule in the comments before the code. One with no place in the
 * code, such as a parse error past its end, goes on the opening fence, so no fatal message is lost.
 * A fix or suggestion with no place there is dropped
 */
export function adjustMessage(
  state: FileState,
  block: Block,
  message: Linter.LintMessage,
): Linter.LintMessage | undefined {
  const offset = toBlockOffset(block, message.line, message.column)
  const comment =
    offset === undefined || offset >= block.commentsEnd
      ? undefined
      : block.comments.findLast(({ start }) => start <= offset)
  if (offset !== undefined && comment !== undefined) {
    return adjustCommentMessage(state, block.syntax, comment, message, offset)
  }
  const position = offset === undefined ? undefined : toMarkdownPosition(state, block, offset)
  const {
    endLine,
    endColumn,
    fix: _fix,
    suggestions: _suggestions,
    ...withoutEndAndFixes
  } = message
  if (position === undefined) {
    const { start } = block.node.position
    return { ...withoutEndAndFixes, line: start.line, column: start.column }
  }
  const adjusted: Linter.LintMessage = { ...withoutEndAndFixes, ...position }
  const endOffset =
    endLine === undefined || endColumn === undefined
      ? undefined
      : toBlockOffset(block, endLine, endColumn)
  const end = endOffset === undefined ? undefined : toMarkdownPosition(state, block, endOffset)
  if (end !== undefined) {
    adjusted.endLine = end.line
    adjusted.endColumn = end.column
  }
  const fix = message.fix && adjustFix(state, block, message.fix)
  if (fix) {
    adjusted.fix = fix
  }
  const suggestions = message.suggestions?.flatMap((suggestion) => {
    const suggestionFix = adjustFix(state, block, suggestion.fix)
    return suggestionFix ? [{ ...suggestion, fix: suggestionFix }] : []
  })
  if (suggestions !== undefined && suggestions.length > 0) {
    adjusted.suggestions = suggestions
  }
  return adjusted
}
