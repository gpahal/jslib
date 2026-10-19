import {
  MarkdownLanguage,
  MarkdownSourceCode,
  type MarkdownLanguageContext,
  type MarkdownLanguageOptions,
} from '@eslint/markdown'
import type { Html, Nodes, Root } from 'mdast'
import { fromMarkdown, type Options as ParseOptions } from 'mdast-util-from-markdown'
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { frontmatter } from 'micromark-extension-frontmatter'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import type { Position } from 'unist'

import { toArray } from '@gpahal/std/arrays'
import { describeValue, getErrorMessage } from '@gpahal/std/errors'
import { isRecord } from '@gpahal/std/objects'

import { getLines, toHtmlOffset } from '@/internal/markdown/processor/blocks'
import { formatErrorMessage } from '@/internal/utils'

type File = Parameters<MarkdownLanguage['parse']>[0]
type ParseResult = ReturnType<MarkdownLanguage['parse']>
type OkParseResult = Parameters<MarkdownLanguage['createSourceCode']>[1]
type FileError = Extract<ParseResult, { ok: false }>['errors'][number]

export type FrontmatterKind = 'yaml' | 'toml'

const FRONTMATTER_KINDS: ReadonlySet<unknown> = new Set(['yaml', 'toml'])

const FRONTMATTER_EXPECTED = "`false`, `'yaml'`, `'toml'` or an array of `'yaml'` and `'toml'`"

/**
 * `frontmatter` also takes both kinds, and not JSON
 */
type GpahalMarkdownLanguageOptions = {
  frontmatter?: false | FrontmatterKind | Array<FrontmatterKind>
  math?: boolean
}

/**
 * Math off, as `@eslint/markdown` has it: an unclosed `$$` math block runs to the document's end
 */
const DEFAULT_LANGUAGE_OPTIONS: GpahalMarkdownLanguageOptions = {
  frontmatter: ['yaml', 'toml'],
  math: false,
}

/**
 * GFM's mdast extensions without mdast-util-gfm-autolink-literal's `transforms`, which leave the
 * literal URLs they find after parsing, and the text around them, without positions
 * (syntax-tree/mdast-util-gfm-autolink-literal#19), which crashes `@eslint/markdown`
 * (eslint/markdown#619). GitHub links none of those but an email in brackets or emphasis. Remove
 * once the transforms keep positions or `@eslint/markdown` handles nodes without them
 */
const GFM_MDAST_EXTENSIONS = gfmFromMarkdown().map(
  ({ transforms: _transforms, ...extension }) => extension,
)

/**
 * Made once per combination: the extensions keep no state between parses
 */
const PARSE_OPTIONS = new Map<string, ParseOptions>()

function getParseOptionsKey(kinds: Array<FrontmatterKind>, isMath: boolean): string {
  return `${kinds.join(',')}|${String(isMath)}`
}

function getParseOptions(kinds: Array<FrontmatterKind>, isMath: boolean): ParseOptions {
  const key = getParseOptionsKey(kinds, isMath)
  let options = PARSE_OPTIONS.get(key)
  if (!options) {
    options = {
      extensions: [
        gfm(),
        ...(kinds.length > 0 ? [frontmatter(kinds)] : []),
        ...(isMath ? [math()] : []),
      ],
      mdastExtensions: [
        ...GFM_MDAST_EXTENSIONS,
        ...(kinds.length > 0 ? [frontmatterFromMarkdown(kinds)] : []),
        ...(isMath ? [mathFromMarkdown()] : []),
      ],
    }
    PARSE_OPTIONS.set(key, options)
  }
  return options
}

function getFrontmatterKinds(option: unknown): Array<FrontmatterKind> {
  return option === false || option === undefined
    ? []
    : toArray<unknown>(option).filter((kind): kind is FrontmatterKind =>
        FRONTMATTER_KINDS.has(kind),
      )
}

/**
 * ESLint, `@eslint/markdown` and the rules recurse over the tree, which overflows the stack at a
 * few thousand levels. Parse time has no cap, on purpose: micromark with GFM is quadratic on long
 * paragraphs of `#a` lines and large GFM tables, as in `@eslint/markdown`
 */
const MAX_DEPTH = 1000

/**
 * A loop, so the check itself can't overflow the stack
 */
function findTooDeep(root: Root): Nodes | undefined {
  const stack: Array<[Nodes, number]> = [[root, 0]]
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const [node, depth] = item
    if (depth > MAX_DEPTH) {
      return node
    }
    if ('children' in node) {
      for (const child of node.children) {
        stack.push([child, depth + 1])
      }
    }
  }
  return undefined
}

type MarkdownParseResult = { ok: true; root: Root } | { ok: false; error: FileError }

/**
 * ESLint runs `preprocess` and then `parse` on the same text, which share it, as the processor and
 * the rules only read the tree. One entry, so at most one file's tree is kept
 */
const lastParse: { text?: string; key?: string; result?: MarkdownParseResult } = {}

/**
 * As the language and the processor parse it, or the error that makes it a parse error, including
 * nesting deeper than `MAX_DEPTH`. The last parse is reused for the same text and options
 */
export function parseMarkdown(
  text: string,
  kinds: Array<FrontmatterKind>,
  isMath: boolean,
): MarkdownParseResult {
  const key = getParseOptionsKey(kinds, isMath)
  if (lastParse.result !== undefined && lastParse.text === text && lastParse.key === key) {
    return lastParse.result
  }
  const result = parseUncached(text, kinds, isMath)
  Object.assign(lastParse, { text, key, result })
  return result
}

/**
 * For text that ESLint won't parse next
 */
export function parseUncached(
  text: string,
  kinds: Array<FrontmatterKind>,
  isMath: boolean,
): MarkdownParseResult {
  let root: Root
  try {
    root = fromMarkdown(text, getParseOptions(kinds, isMath))
  } catch (error) {
    return { ok: false, error: toFileError(error) }
  }
  const tooDeep = findTooDeep(root)
  if (tooDeep !== undefined) {
    return {
      ok: false,
      error: {
        message: `Markdown nested more than ${String(MAX_DEPTH)} levels deep`,
        line: tooDeep.position?.start.line ?? 1,
        column: tooDeep.position?.start.column ?? 1,
      },
    }
  }
  return { ok: true, root }
}

function toFileError(error: unknown): FileError {
  const { line, column } = isRecord(error) ? error : {}
  return {
    message: getErrorMessage(error),
    line: typeof line === 'number' ? line : 1,
    column: typeof column === 'number' ? column : 1,
  }
}

/**
 * As `@eslint/markdown` reads them
 */
const CONFIG_COMMENT_START_REGEX =
  /^<!--\s*eslint(?:-enable|-disable(?:(?:-next)?-line)?)?(?:\s|-->)/u

type InlineConfigComment = { value: string; position: Position }

function getInlineConfigComments(
  text: string,
  lines: ReturnType<typeof getLines>,
  sourceCode: MarkdownSourceCode,
  node: Html & { position: Position },
): Array<InlineConfigComment> {
  const { value } = node
  const comments: Array<InlineConfigComment> = []
  const valueLines = getLines(value)
  // An `indexOf` scan, since a lazy regex is quadratic on a run of unclosed `<!--`
  for (let start = value.indexOf('<!--'); start !== -1;) {
    const close = value.indexOf('-->', start + 4)
    if (close === -1) {
      break
    }
    const end = close + 3
    const comment = value.slice(start, end)
    const startOffset = toHtmlOffset(lines, { node, valueLines }, start)
    const endOffset = toHtmlOffset(lines, { node, valueLines }, end)
    if (
      startOffset !== undefined &&
      endOffset !== undefined &&
      endOffset <= text.length &&
      CONFIG_COMMENT_START_REGEX.test(comment)
    ) {
      comments.push({
        value: comment.slice(4, -3).trim(),
        position: {
          start: { ...sourceCode.getLocFromIndex(startOffset), offset: startOffset },
          end: { ...sourceCode.getLocFromIndex(endOffset), offset: endOffset },
        },
      })
    }
    start = value.indexOf('<!--', end)
  }
  return comments
}

/**
 * Places directive comments at their offsets in the text. `@eslint/markdown` 8.0.3 adds an offset
 * in an HTML node's value to the node's start, but the value has spaces for part of a tab and lacks
 * the container's markers on later lines, so a directive in a tab-indented list item runs past the
 * text, crashing with a `RangeError` or a fix deleting what follows. Remove once
 * `@eslint/markdown` maps directive offsets through tab-indented containers
 */
class GpahalMarkdownSourceCode extends MarkdownSourceCode {
  #inlineConfigComments: Array<InlineConfigComment> | undefined

  override getInlineConfigNodes(): Array<InlineConfigComment> {
    if (this.#inlineConfigComments === undefined) {
      const { text } = this
      const lines = getLines(text)
      const comments: Array<InlineConfigComment> = []
      // In document order, without recursion
      const stack: Array<Nodes> = [this.ast]
      for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
        if (node.type === 'html' && node.position !== undefined && node.value.includes('<!--')) {
          comments.push(
            ...getInlineConfigComments(text, lines, this, { ...node, position: node.position }),
          )
        } else if ('children' in node) {
          for (const child of node.children.toReversed()) {
            stack.push(child)
          }
        }
      }
      this.#inlineConfigComments = comments
    }
    return this.#inlineConfigComments
  }
}

/**
 * `@eslint/markdown`'s GFM language with its own parse, without the GFM transforms that crash
 * ESLint (eslint/markdown#619), with YAML and TOML front matter together, and with
 * {@link GpahalMarkdownSourceCode}
 */
export class GpahalMarkdownLanguage extends MarkdownLanguage {
  constructor() {
    super({ mode: 'gfm' })
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The base type allows one front matter kind, and this class takes an array of them too
    this.defaultLanguageOptions = DEFAULT_LANGUAGE_OPTIONS as MarkdownLanguageOptions
  }

  override validateLanguageOptions(
    languageOptions: GpahalMarkdownLanguageOptions | MarkdownLanguageOptions,
  ): void {
    const { frontmatter: frontmatterOption, math: mathOption } = languageOptions
    const isValidFrontmatter =
      frontmatterOption === undefined ||
      frontmatterOption === false ||
      FRONTMATTER_KINDS.has(frontmatterOption) ||
      (Array.isArray(frontmatterOption) &&
        frontmatterOption.every((kind) => FRONTMATTER_KINDS.has(kind)))
    if (!isValidFrontmatter) {
      throw new Error(
        formatErrorMessage(
          ['`languageOptions.frontmatter`'],
          `expected ${FRONTMATTER_EXPECTED}, received ${describeValue(frontmatterOption)}. JSON front matter isn't supported`,
        ),
      )
    }
    if (mathOption !== undefined && typeof mathOption !== 'boolean') {
      throw new Error(
        formatErrorMessage(
          ['`languageOptions.math`'],
          `expected a boolean, received ${describeValue(mathOption)}`,
        ),
      )
    }
  }

  override parse(file: File, context: MarkdownLanguageContext): ParseResult {
    const text = String(file.body)
    // `validateLanguageOptions` accepted more than the base type allows
    const { frontmatter: frontmatterOption, math: mathOption }: Record<string, unknown> =
      context.languageOptions
    const result = parseMarkdown(text, getFrontmatterKinds(frontmatterOption), mathOption === true)
    // Reported as a problem, not thrown, as the base language does
    return result.ok ? { ok: true, ast: result.root } : { ok: false, errors: [result.error] }
  }

  override createSourceCode(file: File, parseResult: OkParseResult): MarkdownSourceCode {
    return new GpahalMarkdownSourceCode({ text: String(file.body), ast: parseResult.ast })
  }
}
