import type { Code, Html, Nodes, Root } from 'mdast'

import { CODE_EXTNS } from '@/internal/files'
import { MARKDOWN_LINE_BREAK_GLOBAL_REGEX } from '@/internal/markdown/line-breaks'
import {
  BLOCK_COMMENT_SYNTAX,
  getCommentPlacement,
  type BlockOptions,
  type CommentSyntax,
  type UnwritableReason,
} from '@/internal/markdown/processor/comments'
import { findFirstIndex } from '@/internal/search'

export const BOM = '\u{FEFF}'

/**
 * For the languages whose name isn't an extension
 */
const LANGUAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['javascript', 'js'],
  ['ecmascript', 'js'],
  ['typescript', 'ts'],
  ['markdown', 'md'],
])

/**
 * As a word of its own, so `basefilename="x"` isn't one
 */
const FILENAME_META_REGEX = /(?:^|\s)filename=(?<quote>["'])(?<filename>.*?)\k<quote>/u

/**
 * Up to the first character a language name doesn't have, as `lowercase-code-block-language` reads
 * it: the `ts` of ` ```ts:title=x.js ` and VitePress's ` ```js{1} `
 */
const LANGUAGE_REGEX = /^[\w+#-]*/u

/**
 * JavaScript parsers count the line and paragraph separators too
 */
const JS_LINE_BREAK_REGEX = /\r\n|[\n\r\u{2028}\u{2029}]/gu

/**
 * The languages whose `SourceCode` counts JavaScript's line breaks: JavaScript's, and HTML's,
 * whose parser runs on ESLint's JavaScript language. Other parsers, such as Markdown's, JSON's and
 * YAML's, count only Markdown's line breaks
 */
const JS_LINE_BREAK_EXTENSIONS: ReadonlySet<string> = new Set([...CODE_EXTNS, 'astro', 'html'])

export type TextLine = {
  start: number
  end: number
}

export function getLines(text: string): Array<TextLine> {
  const lines: Array<TextLine> = []
  let start = 0
  for (const match of text.matchAll(MARKDOWN_LINE_BREAK_GLOBAL_REGEX)) {
    lines.push({ start, end: match.index })
    start = match.index + match[0].length
  }
  lines.push({ start, end: text.length })
  return lines
}

/**
 * A binary search, since an HTML node's comments each look up a line of the same value
 */
export function findLineIndex(lines: ReadonlyArray<TextLine>, index: number): number {
  return findFirstIndex(lines.length, (line) => (lines[line]?.start ?? Infinity) > index) - 1
}

/**
 * As the parser for the virtual file's extension counts lines
 */
function getCodeLineStarts(text: string, filename: string): Array<number> {
  const extension = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
  const regex = JS_LINE_BREAK_EXTENSIONS.has(extension)
    ? JS_LINE_BREAK_REGEX
    : MARKDOWN_LINE_BREAK_GLOBAL_REGEX
  return [0, ...text.matchAll(regex).map((match) => match.index + match[0].length)]
}

function getCommonSuffixLength(a: string, b: string): number {
  let length = 0
  while (
    length < a.length &&
    length < b.length &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  ) {
    length++
  }
  return length
}

/**
 * A line of a code block's code, at offset `js` of the virtual file and `md` of the Markdown file,
 * after `prefix`, the container's markers and the fence's indent. Only its characters from
 * `mappableFrom` on are the Markdown file's: before them, spaces may stand for part of a tab.
 * `prefix` is `undefined` then, and for an empty line
 */
export type CodeLine = {
  js: number
  md: number
  line: number
  length: number
  mappableFrom: number
  prefix: string | undefined
}

/**
 * Keys the comments before code blocks and the messages about them
 */
export function toCommentKey({ line, column }: { line: number; column: number }): string {
  return `${String(line)}:${String(column)}`
}

/**
 * A directive HTML comment before a code block, with its node's value lines and its text without
 * `<!--` and `-->`. A node can hold several, as in `<!-- a --> <!-- b -->`
 */
type HtmlComment = {
  node: Html & { position: NonNullable<Html['position']> }
  valueLines: Array<TextLine>
  valueStart: number
  comment: string
}

export type BlockComment = HtmlComment & {
  text: string
  start: number
}

/**
 * A fix's new lines get `newLinePrefix`, or, when the fence's line has a tab, the prefix of the
 * line the fix starts on. The comments put in its code span `commentsStart` to `commentsEnd` of its
 * virtual file's text, which has no BOM
 */
export type Block = {
  node: Code & { position: NonNullable<Code['position']> }
  filename: string
  newLinePrefix: string | undefined
  indentText: string
  syntax: CommentSyntax
  comments: Array<BlockComment>
  commentsStart: number
  commentsEnd: number
  text: string
  lineStarts: Array<number>
  codeLines: Array<CodeLine>
}

/**
 * Each level lints all the text inside it again, and 400 nested levels took 27 seconds
 */
const MAX_MARKDOWN_BLOCK_DEPTH = 3

const MARKDOWN_FILENAME_REGEX = /\.(?:md|markdown)$/u

/**
 * `info` names the block in an error: its language as written and its `filename` meta
 */
export type CommentKind =
  { kind: 'injected' } | { kind: 'excluded' } | { kind: 'unsupported'; info: string }

export type PlacementMessageId = UnwritableReason | 'sharedLine' | 'unsupported'

/**
 * Reported at the comment's start, or, for a directive without rules, which would disable the
 * report, at the end of the line before. An `unsupported` one is reported only when the Markdown
 * file's lint finds the directive unused
 */
export type Placement = {
  messageId: PlacementMessageId
  info: string
  syntax: Pick<CommentSyntax, 'open' | 'close'>
  line: number
  column: number
  key: string
}

/**
 * What `preprocess` keeps for `postprocess`
 */
export type FileState = {
  depth: number
  text: string
  root: Root
  lines: Array<TextLine>
  blocks: Array<Block>
  comments: ReadonlyMap<string, CommentKind>
  placements: Array<Placement>
}

/**
 * `undefined` for a value that isn't only comments and whitespace
 */
export function getHtmlComments(
  value: string,
): Array<{ valueStart: number; comment: string }> | undefined {
  const comments: Array<{ valueStart: number; comment: string }> = []
  let end = 0
  // An `indexOf` scan, since a lazy regex is quadratic on a run of unclosed `<!--`
  for (let start = value.indexOf('<!--'); start !== -1; start = value.indexOf('<!--', end)) {
    const close = value.indexOf('-->', start + 4)
    if (close === -1 || value.slice(end, start).trim() !== '') {
      break
    }
    comments.push({ valueStart: start, comment: value.slice(start + 4, close) })
    end = close + 3
  }
  return comments.length > 0 && value.slice(end).trim() === '' ? comments : undefined
}

const ESLINT_COMMENT_REGEX = /^(?:eslint\b|globals?\s|exported\s)/u

const SKIP_COMMENT_REGEX = /^eslint-skip(?:\s+--(?:\s[\s\S]*)?)?$/u

const NEXT_LINE_COMMENT_REGEX = /^eslint-disable-next-line(?:\s|$)/u

const BLANKET_COMMENT_REGEX = /^eslint-disable(?:-line)?(?:\s+--(?:\s[\s\S]*)?)?$/u

/**
 * A directive without rules on a line after the first would disable a report on its line, so it's
 * reported at the end of the line before
 */
function toPlacementPosition(
  lines: Array<TextLine>,
  comment: string,
  position: { line: number; column: number },
): { line: number; column: number } {
  const previous = lines[position.line - 2]
  return previous === undefined || !BLANKET_COMMENT_REGEX.test(comment.trim())
    ? position
    : { line: position.line - 1, column: previous.end - previous.start + 1 }
}

/**
 * Each line of the value is the end of its Markdown line. Before it, the Markdown file has list
 * indent and blockquote markers, and the value may have spaces for part of a tab, which map to the
 * line's start
 */
export function toHtmlOffset(
  lines: ReadonlyArray<TextLine>,
  { node: { position }, valueLines }: Pick<HtmlComment, 'node' | 'valueLines'>,
  index: number,
): number | undefined {
  const lineIndex = findLineIndex(valueLines, index)
  const valueLine = valueLines[lineIndex]
  const sourceLine = lines[position.start.line - 1 + lineIndex]
  if (valueLine === undefined || sourceLine === undefined) {
    return undefined
  }
  const end =
    lineIndex === valueLines.length - 1 ? (position.end.offset ?? sourceLine.end) : sourceLine.end
  return Math.max(end - (valueLine.end - index), sourceLine.start)
}

export function toHtmlPosition(
  lines: Array<TextLine>,
  comment: Pick<HtmlComment, 'node' | 'valueLines'>,
  index: number,
): { line: number; column: number } | undefined {
  const offset = toHtmlOffset(lines, comment, index)
  const line = comment.node.position.start.line + findLineIndex(comment.valueLines, index)
  const sourceLine = lines[line - 1]
  return offset === undefined || sourceLine === undefined
    ? undefined
    : { line, column: offset - sourceLine.start + 1 }
}

/**
 * With `comments` characters of comments put in after the first `head` characters. Each line of
 * code is the end of its Markdown line; where it isn't, only their common end maps. An empty
 * block's one line maps nothing
 */
function getCodeLines(
  text: string,
  lines: Array<TextLine>,
  node: Block['node'],
  { head, comments }: { head: number; comments: number },
): Array<CodeLine> {
  const codeLines: Array<CodeLine> = []
  let line = node.position.start.line + 1
  for (const { start, end } of getLines(node.value)) {
    const sourceLine = lines[line - 1]
    if (sourceLine === undefined) {
      break
    }
    const code = node.value.slice(start, end)
    const source = text.slice(sourceLine.start, sourceLine.end)
    const md = sourceLine.end - code.length
    const mappableFrom =
      node.value === '' ? Infinity : code.length - getCommonSuffixLength(source, code)
    codeLines.push({
      js: start < head ? start : start + comments,
      md,
      line,
      length: code.length,
      mappableFrom,
      prefix: mappableFrom === 0 && code.length > 0 ? text.slice(sourceLine.start, md) : undefined,
    })
    line++
  }
  return codeLines
}

/**
 * As a line of the file without its BOM: the first line starts one character later in the Markdown
 * file, and every line one character earlier in the virtual file
 */
function withoutBom(codeLine: CodeLine): CodeLine {
  if (codeLine.js > 0) {
    return { ...codeLine, js: codeLine.js - BOM.length }
  }
  return {
    ...codeLine,
    md: codeLine.md + BOM.length,
    length: codeLine.length - BOM.length,
    mappableFrom: Math.max(codeLine.mappableFrom - BOM.length, 0),
  }
}

/**
 * A footnote label, a blockquote marker, or any other character. An unclosed `[^` run is quadratic,
 * but labels hold at most 999 characters and nesting is capped by `MAX_DEPTH` in `language.ts`, so
 * the worst prefix takes about 20 ms
 */
const FENCE_PREFIX_PIECE_REGEX = / {0,3}\[\^(?:\\.|[^\\\]])*\]: *|> ?|[\s\S]/gu

/**
 * The prefix that makes a new line parse as the code after it: each blockquote marker with one
 * space, a footnote label as 4 spaces, and list markers and indents as spaces, so CommonMark strips
 * exactly the fence's indent. `undefined` with a tab, whose width depends on its column
 */
function getNewLinePrefix(fencePrefix: string): string | undefined {
  return fencePrefix.includes('\t')
    ? undefined
    : fencePrefix.replaceAll(FENCE_PREFIX_PIECE_REGEX, (piece) =>
        piece.startsWith('>') ? '> ' : piece.length > 2 ? ' '.repeat(4) : ' ',
      )
}

/**
 * Its `filename="…"` meta, sanitized, or its index and language (` ```js{1} ` is `0.js`). Neither
 * holds a path separator, and ESLint prefixes it with `<index>_`, so even `..` stays inside the
 * Markdown file's path
 */
function getBlockFilename(node: Code, index: number): string {
  const filename = FILENAME_META_REGEX.exec(node.meta ?? '')?.groups?.['filename']
  if (filename !== undefined) {
    return filename.replaceAll(/\s+/gu, '_').replaceAll(/[/\\]/gu, '_')
  }
  const language = LANGUAGE_REGEX.exec((node.lang ?? '').toLowerCase())?.[0] ?? ''
  return `${String(index)}.${LANGUAGE_EXTENSIONS.get(language) ?? language}`
}

/**
 * Puts each HTML comment of the run into the code in its language's syntax, one per line, but the
 * `eslint-disable-next-line` ones, which share the line before the code so each applies to its
 * first line. One that can't be written so, such as one containing `*\/`, goes to `placements`
 */
function getBlock(
  text: string,
  lines: Array<TextLine>,
  node: Block['node'],
  filename: string,
  comments: Array<HtmlComment>,
  {
    comments: commentKinds,
    placements,
    ...options
  }: BlockOptions & { comments: Map<string, CommentKind>; placements: FileState['placements'] },
): Block {
  const placement = getCommentPlacement(filename, node.value, options)
  const { syntax, head } = placement ?? { syntax: BLOCK_COMMENT_SYNTAX, head: 0 }
  const [language = ''] = (node.lang ?? '').split(/\s/u, 1)
  const metaFilename = FILENAME_META_REGEX.exec(node.meta ?? '')?.groups?.['filename']
  const info = metaFilename === undefined ? language : `${language} filename="${metaFilename}"`
  const isNextLine = ({ comment }: HtmlComment) => NEXT_LINE_COMMENT_REGEX.test(comment.trim())
  const ownLines: Array<HtmlComment> = []
  const sharedLine: Array<HtmlComment> = []
  for (const htmlComment of [
    ...comments.filter((comment) => !isNextLine(comment)),
    ...comments.filter((comment) => isNextLine(comment)),
  ]) {
    const position = toHtmlPosition(lines, htmlComment, htmlComment.valueStart)
    if (position === undefined) {
      continue
    }
    const key = toCommentKey(position)
    if (placement === undefined) {
      commentKinds.set(key, { kind: 'unsupported', info })
      placements.push({
        messageId: 'unsupported',
        info,
        syntax,
        ...toPlacementPosition(lines, htmlComment.comment, position),
        key,
      })
      continue
    }
    const isShared = isNextLine(htmlComment)
    const messageId =
      syntax.getUnwritableReason?.(htmlComment.comment) ??
      (isShared && !syntax.isLineShared && sharedLine.length > 0 ? 'sharedLine' : undefined)
    if (messageId !== undefined) {
      commentKinds.set(key, { kind: 'excluded' })
      placements.push({
        messageId,
        info,
        syntax,
        ...toPlacementPosition(lines, htmlComment.comment, position),
        key,
      })
      continue
    }
    commentKinds.set(key, { kind: 'injected' })
    if (isShared) {
      sharedLine.push(htmlComment)
    } else {
      ownLines.push(htmlComment)
    }
  }
  const blockComments: Array<BlockComment> = []
  let commentsText = ''
  for (const [index, htmlComment] of [...ownLines, ...sharedLine].entries()) {
    const commentText = `${syntax.open}${htmlComment.comment}${syntax.close}`
    blockComments.push({ ...htmlComment, text: commentText, start: commentsText.length })
    const isLineEnd = index < ownLines.length || htmlComment === sharedLine.at(-1)
    commentsText += `${commentText}${isLineEnd ? '\n' : ' '}`
  }
  // Comments after front matter that ends the block need a line break before them
  const separator =
    commentsText !== '' && head > 0 && !/[\n\r]$/u.test(node.value.slice(0, head)) ? '\n' : ''
  const commentsStart = head + separator.length
  const commentsEnd = commentsStart + commentsText.length
  const codeLines = getCodeLines(text, lines, node, {
    head,
    comments: separator.length + commentsText.length,
  })
  const { start } = node.position
  // A code line's prefix, or else the fence's with list markers as spaces
  const fenceLineStart = lines[start.line - 1]?.start ?? 0
  const fencePrefix = text.slice(fenceLineStart, fenceLineStart + start.column - 1)
  const indentText =
    codeLines.find((codeLine) => codeLine.prefix !== undefined)?.prefix ??
    fencePrefix.replaceAll(/[^\s>]/gu, ' ')
  const fullText = `${node.value.slice(0, head)}${separator}${commentsText}${node.value.slice(head)}\n`
  // ESLint drops a leading BOM from a virtual file, so the virtual file drops it too and positions
  // map past it
  const bomLength = fullText.startsWith(BOM) ? BOM.length : 0
  const blockText = fullText.slice(bomLength)
  return {
    node,
    filename,
    newLinePrefix: getNewLinePrefix(fencePrefix),
    indentText,
    syntax,
    comments: blockComments.map((comment) => ({
      ...comment,
      start: commentsStart + comment.start - bomLength,
    })),
    commentsStart: commentsStart - bomLength,
    commentsEnd: commentsEnd - bomLength,
    text: blockText,
    lineStarts: getCodeLineStarts(blockText, filename),
    codeLines: bomLength > 0 ? codeLines.map(withoutBom) : codeLines,
  }
}

/**
 * `false` for a node that isn't only comments, which ends the run. Pushed, since runs can be long
 */
function pushHtmlComments(run: Array<HtmlComment>, node: Html): boolean {
  const { position } = node
  const htmlComments = position && getHtmlComments(node.value)
  if (position === undefined || htmlComments === undefined) {
    return false
  }
  const htmlNode = { ...node, position }
  const valueLines = getLines(node.value)
  for (const comment of htmlComments) {
    if (ESLINT_COMMENT_REGEX.test(comment.comment.trim())) {
      run.push({ ...comment, node: htmlNode, valueLines })
    }
  }
  return true
}

/**
 * Walked without recursion, so deep nesting can't overflow the stack. A run of directive HTML
 * comments goes to the block right after it, and `eslint-skip` among them skips it. Other HTML
 * comments may sit in the run; any other node, or the container's end, ends it
 */
export function getBlocks(
  text: string,
  root: Root,
  depth: number,
  options: BlockOptions,
): FileState {
  const lines = getLines(text)
  const blocks: Array<Block> = []
  const comments = new Map<string, CommentKind>()
  const placements: Array<Placement> = []
  let run: Array<HtmlComment> = []
  let runParent: Nodes | undefined
  const stack: Array<{ node: Nodes; parent?: Nodes }> = [{ node: root }]
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    const { node, parent } = entry
    if ('children' in node) {
      // One at a time, since spreading many children can overflow the stack
      for (const child of node.children.toReversed()) {
        stack.push({ node: child, parent: node })
      }
    }
    if (parent !== runParent) {
      run = []
    }
    runParent = parent
    if (node.type === 'html') {
      if (!pushHtmlComments(run, node)) {
        run = []
      }
      continue
    }
    if (node.type !== 'code') {
      run = []
      continue
    }
    const blockRun = run
    run = []
    const { position } = node
    if (
      node.lang == null ||
      node.lang === '' ||
      position?.start.offset === undefined ||
      blockRun.some(({ comment }) => SKIP_COMMENT_REGEX.test(comment.trim()))
    ) {
      continue
    }
    const filename = getBlockFilename(node, blocks.length)
    if (depth >= MAX_MARKDOWN_BLOCK_DEPTH && MARKDOWN_FILENAME_REGEX.test(filename)) {
      continue
    }
    blocks.push(
      getBlock(text, lines, { ...node, position }, filename, blockRun, {
        ...options,
        comments,
        placements,
      }),
    )
  }
  return { depth, text, root, lines, blocks, comments, placements }
}
