import { AST_NODE_TYPES, AST_TOKEN_TYPES } from '@typescript-eslint/utils'
import type { TSESTree } from '@typescript-eslint/utils'

import {
  getBlockCommentLines,
  hasMixedStarPrefixes,
  hasTextStar,
  hasUnusualLineTerminator,
} from '@gpahal/internal/comments'

type Comment = TSESTree.Comment

/**
 * A namespace alias, such as `import x = A.B`, is a declaration instead
 */
export function isImport(
  node: TSESTree.Node,
): node is TSESTree.ImportDeclaration | TSESTree.TSImportEqualsDeclaration {
  return (
    node.type === AST_NODE_TYPES.ImportDeclaration ||
    (node.type === AST_NODE_TYPES.TSImportEqualsDeclaration &&
      node.moduleReference.type === AST_NODE_TYPES.TSExternalModuleReference)
  )
}

/**
 * Comments that tools read, in a `/**` block too: a first word ending in `-ignore`, `-disable…` or
 * `-enable`, an `@` directive such as `@ts-expect-error` or `@__PURE__`, source maps, magic comments
 * such as `webpackIgnore:`, `NOSONAR`-style markers, triple-slash directives and `/*!` comments. A
 * JSDoc tag isn't a directive
 */
const DIRECTIVE =
  /^(?:[\w-]+[:-](?:ignore|disable(?:-next-line|-line)?|enable)(?:\b|(?=[A-Z]))|@(?:ts-|jsx(?:ImportSource|Runtime|Frag)?\b|(?:vitest|jest)-environment\b|license\b|preserve\b|__\w+__|flow\b|noflow\b|refresh\b|generated\b|deno-types\b|(?:no)?format\b|prettier\b)|[#@]\s+source(?:Mapping)?URL=|eslint\s|globals?\s|exported\s|#(?:end)?region\b|\/\s*(?:<|@ts-)|noinspection\b|nosemgrep\b|NOSONAR\b|\*?\s*#__\w+__|\*?\s*(?:webpack[A-Z]\w*|turbopack\w*):|istanbul\s|c8\s|v8\s|\**!|\*?\s*@(?:license|preserve)\b)/

/**
 * ESLint reads these only in a `/*` block, and prose often starts with them, as in
 * `// global cache`. `// eslint` stays a directive: a doc block made from it would read as a
 * misplaced directive
 */
const BLOCK_ONLY_ESLINT_DIRECTIVE = /^(?:globals?|exported)(?:\s|$)/

/**
 * A `/**` block starting with a directive word isn't read, as {@link isDocBlockDirective} says
 */
function isDirective(comment: Comment): boolean {
  const value = comment.value.trimStart()
  return (
    !(comment.type === AST_TOKEN_TYPES.Line && BLOCK_ONLY_ESLINT_DIRECTIVE.test(value)) &&
    (DIRECTIVE.test(value) || (!isDocBlock(comment) && DIRECTIVE_WORD.test(value)))
  )
}

/**
 * As `Copyright (c) 2020 …`, `©`, `SPDX-License-Identifier: …`, `Licensed under …`, or a line
 * starting `Forked from … (MIT)`. Case-sensitive, so prose such as "the copyright page" isn't one
 */
const LEGAL_NOTICE =
  /\b(?:Copyright|COPYRIGHT)\b|©|\bSPDX-License-Identifier:|\bLicen[cs]ed under\b|^[ \t*]*(?:Forked|Adapted|Ported|Derived) from\b/mu

const MIT_REGEX = /\bMIT\b/u

export function isLeftAsIs(comment: Comment): boolean {
  return isDirective(comment) || LEGAL_NOTICE.test(comment.value) || MIT_REGEX.test(comment.value)
}

/**
 * ESLint also splits on spaces, but so does prose, such as "global state of the store"
 */
const NAME_LIST = String.raw`[\p{L}\p{N}_$]+(?:\s*:\s*\w+)?(?:\s*,\s*[\p{L}\p{N}_$]+(?:\s*:\s*\w+)?)*\s*(?:--.*)?$`

/**
 * Tools read these only in a `//` or `/*` comment. Not `eslint-plugin-x` or prose such as
 * "auto-enable the feature". TypeScript's, which it reads in `/**` too, are in {@link DIRECTIVE}
 */
const DIRECTIVE_WORD = new RegExp(
  String.raw`^(?:eslint(?:-(?:disable(?:-next-line|-line)?|enable|env))?(?:\s|$)|(?:globals?|exported)\s+${NAME_LIST}|prettier-ignore\b|biome-ignore|oxlint-|deno-lint-ignore\b|cspell:|tslint:|type-coverage:|stylelint-(?:disable|enable)\b|(?:istanbul|c8|v8)\s+ignore\b|jshint\s|jscs:|deepcode\s+ignore\b|pragma:\s*allowlist\b|(?:codeql|lgtm)\[)`,
  'u',
)

/**
 * The ones that suppress errors, and `eslint-env`, which ESLint rejects
 */
const ESLINT_BLOCK_DIRECTIVE = /^eslint-(?:disable(?:-next-line|-line)?|enable|env)(?:\s|$)/

/**
 * Tools don't read it, but they would read a `//` or `/*` comment a fix made from it, which could
 * suppress errors. A multi-line block starting with another directive word is prose
 */
export function isDocBlockDirective(comment: Comment): boolean {
  if (!isDocBlock(comment)) {
    return false
  }
  const firstLine = getBlockCommentLines(comment.value)[0] ?? ''
  return comment.loc.start.line === comment.loc.end.line
    ? DIRECTIVE_WORD.test(firstLine)
    : ESLINT_BLOCK_DIRECTIVE.test(firstLine)
}

/**
 * Tools skip the whitespace before a directive
 */
function isDirectiveLine(line: string, asLineComment: boolean): boolean {
  const text = line.trimStart()
  return (
    !(asLineComment && BLOCK_ONLY_ESLINT_DIRECTIVE.test(text)) &&
    (DIRECTIVE.test(text) || DIRECTIVE_WORD.test(text))
  )
}

/**
 * A line that would be a directive there could suppress errors or coverage
 */
export function isSafeToRewrite(lines: Array<string>, asLineComments = false): boolean {
  return lines.every((line) => !isDirectiveLine(line, asLineComments))
}

/**
 * `@ts-expect-error` and `@ts-ignore` apply to the next line that isn't blank or a `//` comment.
 * TypeScript reads one after `//` or `///`, or after the `/` and `*` characters that start a
 * block's last line, such as `/***`, with no word boundary after it
 */
const TS_DIRECTIVE = String.raw`@ts-(?:expect-error|ignore|nocheck\b)`

const TS_LINE_DIRECTIVE = '@ts-(?:expect-error|ignore)'

function tsDirectiveRegexes(names: string): { line: RegExp; block: RegExp } {
  return {
    line: new RegExp(String.raw`^\/?\s*${names}`),
    block: new RegExp(String.raw`^[*/]*\s*${names}`),
  }
}

const TS_DIRECTIVE_REGEXES = tsDirectiveRegexes(TS_DIRECTIVE)
const TS_LINE_DIRECTIVE_REGEXES = tsDirectiveRegexes(TS_LINE_DIRECTIVE)

function lastLineOf(comment: Comment): string {
  return comment.value.split(/\r\n|[\n\r\u{2028}\u{2029}]/u).at(-1) ?? ''
}

function hasTsDirective(comment: Comment, regexes: { line: RegExp; block: RegExp }): boolean {
  return comment.type === AST_TOKEN_TYPES.Line
    ? regexes.line.test(comment.value)
    : regexes.block.test(comment.value.trimStart()) ||
        regexes.block.test(lastLineOf(comment).trimStart())
}

/**
 * As TypeScript's scanner records it. `undefined` for other comments
 */
export function tsLineDirectiveLine(comment: Comment): number | undefined {
  if (comment.type === AST_TOKEN_TYPES.Line) {
    return TS_LINE_DIRECTIVE_REGEXES.line.test(comment.value) ? comment.loc.start.line : undefined
  }
  return TS_LINE_DIRECTIVE_REGEXES.block.test(lastLineOf(comment).trimStart())
    ? comment.loc.end.line
    : undefined
}

/**
 * As in `/** Note` and ` * @ts-expect-error *\/`, so a fix that moves the `*\/` or the line would
 * move the directive
 */
export function isTsDirective(comment: Comment): boolean {
  return hasTsDirective(comment, TS_DIRECTIVE_REGEXES)
}

/**
 * A fix between it and its line would move what it applies to. Not `@ts-nocheck`
 */
export function isTsLineDirective(comment: Comment): boolean {
  return hasTsDirective(comment, TS_LINE_DIRECTIVE_REGEXES)
}

const ESLINT_LINE_DIRECTIVE_REGEX = /^eslint-disable-(next-)?line(?:\s|$)/

export function eslintDirectiveLine(comment: Comment): number | undefined {
  const match = ESLINT_LINE_DIRECTIVE_REGEX.exec(comment.value.trimStart())
  if (!match) {
    return undefined
  }
  return match[1] === undefined ? comment.loc.start.line : comment.loc.end.line + 1
}

/**
 * ESLint gives it the type `Shebang`, outside the AST's comment types
 */
export function isShebang(comment: Comment): boolean {
  return (comment.type as string) === 'Shebang'
}

export function isDocBlock(comment: Comment): boolean {
  return comment.type === AST_TOKEN_TYPES.Block && comment.value.startsWith('*')
}

/**
 * As `/* webpackChunkName: "x" *\/`, left alone outside JSX
 */
export function isPlainBlock(comment: Comment): boolean {
  return comment.type === AST_TOKEN_TYPES.Block && !isDocBlock(comment)
}

/**
 * The whole run when whitespace or the end follows, as a banner's `/*** banner`, else at most the
 * `*` of a `/**`, since a run before text, as in `/***Note**`, holds markup
 */
function leadingStarCount(value: string): number {
  let count = 0
  while (value[count] === '*') {
    count++
  }
  return count <= 1 || /^\s|^$/u.test(value.slice(count)) ? count : 1
}

export function withoutStarRuns(value: string): string {
  const start = leadingStarCount(value)
  let end = value.length
  while (end > start && value[end - 1] === '*') {
    end--
  }
  return value.slice(start, end)
}

/**
 * One `*` for the `/**`, then the text without its star runs. A banner's extra stars become spaces,
 * so the first line keeps its column, which later lines' indentation is measured from
 */
export function docBlockInner(value: string): string {
  return `*${' '.repeat(Math.max(leadingStarCount(value) - 1, 0))}${withoutStarRuns(value)}`
}

/**
 * An unusual line terminator, mixed ` * ` prefixes, or a line starting with a `*` that may be text,
 * such as ` *bold*`
 */
export function isUnsafeToFix(value: string, isDocBlockFix: boolean): boolean {
  const inner = isDocBlockFix && value.startsWith('*') ? docBlockInner(value) : value
  return hasUnusualLineTerminator(inner) || hasMixedStarPrefixes(inner) || hasTextStar(inner)
}

export function isMultiLine(comment: Comment): boolean {
  return comment.loc.start.line !== comment.loc.end.line
}

/**
 * JavaScript files need it where it is
 */
export function isTypeAnnotation(comment: Comment): boolean {
  return isDocBlock(comment) && getBlockCommentLines(comment.value)[0]?.startsWith('@') === true
}

export function isTagged(comment: Comment): boolean {
  return (
    isDocBlock(comment) &&
    getBlockCommentLines(comment.value).some((line) => line.trimStart().startsWith('@'))
  )
}

const TYPE_DECLARATION_TAG = /^@(?:typedef|callback|import)\b/

/**
 * It declares a type of its own rather than documents the declaration below
 */
export function isTypeDeclarationBlock(comment: Comment): boolean {
  return (
    isDocBlock(comment) &&
    getBlockCommentLines(comment.value).some((line) => TYPE_DECLARATION_TAG.test(line.trimStart()))
  )
}

const TASK_MARKER = /^(?:TODO|FIXME|HACK|XXX|BUG|NOTE|NB)\b/

/**
 * As `---- Helpers ----`, `==========` or Xcode's `MARK: Helpers`
 */
const BANNER = /^(?:[-=*#~_+/\\]{3}|MARK:)|[-=*#~_+]{3}$/

const CODE_LINE =
  /^(?:(?:const|let|var|function|class|import|export|return|if|for|while|await|type|interface)\s.*[=;{}()]|.*[;{}]$|[\w$.]+\(.*\);?$)/

/**
 * Code without semicolons: a union constituent, as `| 'b'` but not a table row, or an enum member,
 * as `B,` or `B = 2,`
 */
const UNION_OR_ENUM_MEMBER_LINE = /^(?:\|(?!.*\|$)\s*\S|[A-Z][\w$]*(?:\s*=\s*\S.*)?,$)/

/**
 * A class or type member without a semicolon, as `private b = 2`, `b?: number` or
 * `async load(id: string): Promise<void>`. Not a URL, as `https://example.com`
 */
const MEMBER_LINE =
  /^(?:(?:private|protected|public|readonly|static|abstract|declare|override|async|get|set|accessor)\s+)*#?[\w$]+[?!]?(?:\s*[:=](?!\/\/)\s*\S|\(.*\)(?:\s*:\s*\S.*)?$)/

/**
 * Prose that {@link MEMBER_LINE} matches: a capitalized label, as `Note: x` or `Example: z`, or two
 * words in a row after the first colon or `=`, as `note: keeps the order`, unless the first is a
 * keyword, as in `b: keyof T`
 */
const MEMBER_PROSE =
  /^[A-Z][\w$]*:|^[^:=]*[:=].*?(?<![\w$])(?!(?:keyof|typeof|readonly|unique|infer|new|await|void|async|function)\s)[A-Za-z_$][\w$]*\s+[A-Za-z_$]/

function isCodeLine(text: string): boolean {
  return (
    CODE_LINE.test(text) ||
    UNION_OR_ENUM_MEMBER_LINE.test(text) ||
    (MEMBER_LINE.test(text) && !MEMBER_PROSE.test(text))
  )
}

export function isNoteLine(comment: Comment): boolean {
  const text = comment.value.trim()
  return (
    comment.type === AST_TOKEN_TYPES.Line &&
    (TASK_MARKER.test(text) || BANNER.test(text) || isCodeLine(text))
  )
}
