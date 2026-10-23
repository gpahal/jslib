/**
 * The `@gpahal/comment-layout` rule: `/**` doc blocks, laid out JSDoc-style, where TypeScript reads
 * JSDoc, and `//` lines elsewhere, except the module header. The README's "Comment layout" section
 * has the contract. Plain `/*` blocks, directives and `/*!` comments, and runs holding one, stay.
 *
 * A fix that could change the code or lose the layout is left out, and a change that moves code to
 * another line is a suggestion. Nothing changes the number of lines a `@ts-expect-error` or
 * `@ts-ignore` applies to, and Astro scripts get neither.
 */

import { AST_NODE_TYPES, AST_TOKEN_TYPES } from '@typescript-eslint/utils'
import type { TSESLint, TSESTree } from '@typescript-eslint/utils'

import { getBlockCommentLines } from '@gpahal/internal/comments'
import { trimBlankLines } from '@gpahal/std/strings'

import {
  eslintDirectiveLine,
  isDocBlock,
  isDocBlockDirective,
  isImport,
  isLeftAsIs,
  isMultiLine,
  isNoteLine,
  isPlainBlock,
  isSafeToRewrite,
  isShebang,
  isTagged,
  isTsDirective,
  isTsLineDirective,
  isTypeAnnotation,
  isTypeDeclarationBlock,
  isUnsafeToFix,
  tsLineDirectiveLine,
  withoutStarRuns,
} from '@/internal/comment-layout/classify'
import { createNodeLookup } from '@/internal/comment-layout/nodes'
import {
  createLineStarts,
  docBlockLines,
  indentBefore,
  isLastOnLine,
  lineComments,
  lineEndingAt,
  skipSpaces,
  starredBlock,
  starredLayoutFix,
} from '@/internal/comment-layout/text'
import { getDocsUrl } from '@/internal/utils'

type Comment = TSESTree.Comment

type MessageId =
  | 'doc'
  | 'docByHand'
  | 'docTerminator'
  | 'docBelowTsDirective'
  | 'toDoc'
  | 'notDoc'
  | 'layout'
  | 'trailingNote'
  | 'toNoteLine'
  | 'jsxLayout'
  | 'notDirective'
  | 'sameLine'
  | 'toOwnLine'
  | 'toLayout'

type Edit = {
  range: TSESTree.Range
  text: string
}

/**
 * As TypeScript and ESLint count lines. Not global, for `split`
 */
const LINE_TERMINATOR_REGEX = /\r\n|[\n\r\u{2028}\u{2029}]/u

/**
 * eslint-plugin-astro dedents a `<script>` and doesn't indent a fix's later lines back, so fixes
 * there never settle
 */
const ASTRO_VIRTUAL_FILE_REGEX = /\.astro[\\/][^\\/]+$/u

/**
 * As the Vite scaffold's `// https://vite.dev/config/`, which points to docs
 */
const URL_REGEX = /^https?:\/\/\S+$/u

function countLineTerminators(value: string): number {
  return value.split(LINE_TERMINATOR_REGEX).length - 1
}

/**
 * A declaration or member, or the `|` before a union constituent
 */
type Anchor = TSESTree.Node | TSESTree.Token

/**
 * In the program body or a `declare module`, `declare global` or `namespace` block, imports aside
 */
const MODULE_DECLARATION_TYPES = new Set([
  'ClassDeclaration',
  'ExportAllDeclaration',
  'ExportDefaultDeclaration',
  'ExportNamedDeclaration',
  'FunctionDeclaration',
  'TSDeclareFunction',
  'TSEnumDeclaration',
  'TSExportAssignment',
  'TSImportEqualsDeclaration',
  'TSInterfaceDeclaration',
  'TSModuleDeclaration',
  'TSTypeAliasDeclaration',
  'VariableDeclaration',
])

/**
 * Including constructor parameter properties and named tuple members, whose docs editors show.
 * Union constituents are added separately
 */
const MEMBER_TYPES = [
  'AccessorProperty',
  'MethodDefinition',
  'PropertyDefinition',
  'StaticBlock',
  'TSAbstractAccessorProperty',
  'TSAbstractMethodDefinition',
  'TSAbstractPropertyDefinition',
  'TSCallSignatureDeclaration',
  'TSConstructSignatureDeclaration',
  'TSEnumMember',
  'TSIndexSignature',
  'TSMethodSignature',
  'TSNamedTupleMember',
  'TSParameterProperty',
  'TSPropertySignature',
]

/**
 * Where a doc block is allowed but `//` comments are too. Function parameters are added separately
 */
const OPTIONAL_ANCHOR_TYPES = ['Property', 'FunctionDeclaration', 'TSTypeParameter']

/**
 * TypeScript reads JSDoc on declaring assignments in JavaScript files
 */
const JS_FILE_REGEX = /\.(?:[cm]?js|jsx)$/

function isModuleExports(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.object.type === AST_NODE_TYPES.Identifier &&
    node.object.name === 'module' &&
    node.property.type === AST_NODE_TYPES.Identifier &&
    node.property.name === 'exports'
  )
}

const THIS_BOUNDARY_TYPES: ReadonlySet<string> = new Set([
  AST_NODE_TYPES.AccessorProperty,
  AST_NODE_TYPES.PropertyDefinition,
  AST_NODE_TYPES.StaticBlock,
])

/**
 * A class constructor or a `function`, which TypeScript reads as a constructor in a JavaScript
 * file, past blocks and arrow functions
 */
function isInConstructor(node: TSESTree.ExpressionStatement): boolean {
  // ESLint sets the program's `parent` to `null`, which its types leave out
  for (
    let current: TSESTree.Node | null | undefined = node.parent;
    current;
    current = current.parent
  ) {
    if (current.type === AST_NODE_TYPES.FunctionDeclaration) {
      return true
    }
    if (current.type === AST_NODE_TYPES.FunctionExpression) {
      const { parent } = current
      return parent.type === AST_NODE_TYPES.MethodDefinition
        ? parent.kind === 'constructor'
        : parent.type !== AST_NODE_TYPES.Property || (!parent.method && parent.kind === 'init')
    }
    if (THIS_BOUNDARY_TYPES.has(current.type)) {
      return false
    }
  }
  return false
}

/**
 * `this.x = …` in a constructor, `exports.x = …`, `module.exports = …`, `module.exports.x = …`,
 * `Foo.prototype.x = …`, and `Foo.x = …` at module level
 */
function isDeclaringAssignment(node: TSESTree.ExpressionStatement): boolean {
  const { expression } = node
  if (
    expression.type !== AST_NODE_TYPES.AssignmentExpression ||
    expression.operator !== '=' ||
    expression.left.type !== AST_NODE_TYPES.MemberExpression
  ) {
    return false
  }
  const target = expression.left
  if (isModuleExports(target)) {
    return true
  }
  if (target.computed) {
    return false
  }
  const { object } = target
  if (object.type === AST_NODE_TYPES.ThisExpression) {
    return isInConstructor(node)
  }
  return object.type === AST_NODE_TYPES.Identifier
    ? object.name === 'exports' || node.parent.type === AST_NODE_TYPES.Program
    : object.type === AST_NODE_TYPES.MemberExpression &&
        (isModuleExports(object) ||
          (!object.computed &&
            object.object.type === AST_NODE_TYPES.Identifier &&
            object.property.type === AST_NODE_TYPES.Identifier &&
            object.property.name === 'prototype'))
}

const FUNCTION_SELECTOR = [
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
  'TSCallSignatureDeclaration',
  'TSConstructSignatureDeclaration',
  'TSConstructorType',
  'TSDeclareFunction',
  'TSEmptyBodyFunctionExpression',
  'TSFunctionType',
  'TSMethodSignature',
].join(', ')

/**
 * As in `/// text`, which a fix drops
 */
const EXTRA_SLASHES_REGEX = /^\/+(?=\s|$)/

/**
 * `undefined` for text that starts with a slash, as in `///path`, which can't be told apart
 */
function lineCommentText(comment: Comment): string | undefined {
  const value = comment.value.replace(EXTRA_SLASHES_REGEX, '')
  if (value.startsWith('/')) {
    return undefined
  }
  return (value.startsWith(' ') ? value.slice(1) : value).trimEnd()
}

/**
 * As `// @returns the value`, which a doc block would make tools read
 */
function isTagLine(comment: Comment): boolean {
  return (
    comment.type === AST_TOKEN_TYPES.Line &&
    /^@[\p{L}_$]/u.test(lineCommentText(comment)?.trimStart() ?? '')
  )
}

function withoutSharedIndent(lines: Array<string>): Array<string> {
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.length - line.trimStart().length)
  const shared = indents.reduce((min, indent) => Math.min(min, indent), indents[0] ?? 0)
  return lines.map((line) => line.slice(shared))
}

/**
 * A block's lines, and each group of `//` comments without its shared indentation. `undefined`
 * when a comment's text can't be read
 */
function runLines(comments: Array<Comment>): Array<string> | undefined {
  const lines: Array<string> = []
  // A loop, since a `push` spread throws a RangeError past the runtime's argument limit
  const append = (items: ReadonlyArray<string>) => {
    for (const item of items) {
      lines.push(item)
    }
  }
  let group: Array<string> = []
  for (const comment of comments) {
    if (isDocBlock(comment)) {
      append(withoutSharedIndent(group))
      append(docBlockLines(comment.value))
      group = []
      continue
    }
    const line = lineCommentText(comment)
    if (line === undefined) {
      return undefined
    }
    group.push(line)
  }
  append(withoutSharedIndent(group))
  return trimBlankLines(lines)
}

export const commentLayout: TSESLint.RuleModule<MessageId> = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    hasSuggestions: true,
    docs: {
      description:
        'Use JSDoc-style `/** */` doc blocks on declarations and type or class members, and `//` elsewhere, bar tagged JSDoc blocks',
      url: getDocsUrl('comment-layout'),
    },
    messages: {
      doc: 'A comment on a module-level declaration or a type or class member is a `/** */` doc block',
      docByHand:
        'A comment on a module-level declaration or a type or class member is a `/** */` doc block; add a blank line to detach a section comment, or merge it into the doc block by hand',
      docTerminator:
        "A doc block can't contain `*/`. Reword the comment, or add a blank line to detach it",
      docBelowTsDirective:
        'A comment on a module-level declaration or a type or class member is a `/** */` doc block; move the comment above the TypeScript directive, since a block between the directive and its code would take the directive',
      toDoc: 'Turn the comments into one `/** */` doc block',
      notDoc:
        'Unexpected untagged `/** */` block where no doc block goes; use `//`, or `/* */` when code shares the line',
      layout:
        'Lay out a doc block JSDoc-style: `/**` and ` */` on their own lines, each line between starting with ` * `',
      trailingNote: 'Move this note into the doc block or onto its own line',
      toNoteLine: 'Move the note onto its own line above the doc block',
      jsxLayout:
        'A JSX comment is a `/* */` block, laid out JSDoc-style when it spans lines: `/*` and ` */` on their own lines, each line between starting with ` * `',
      notDirective:
        "A `/** */` comment isn't a directive; write the directive as a `//` or `/* */` comment, or reword the text",
      sameLine:
        "TypeScript doesn't read a doc block with code before it on its line, except on a parameter or type parameter; put it on its own line above the member",
      toOwnLine: 'Put the doc block on its own line above the member',
      toLayout: 'Lay out the block JSDoc-style, moving the code beside it to the next line',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode
    const text = sourceCode.text
    const anchors: Array<Anchor> = []
    const optionalAnchors: Array<Anchor> = []
    // A doc block before these on their line documents them
    const sameLineAnchors: Array<TSESTree.Node> = []
    // TypeScript doesn't read a doc block before these on their line, so it moves
    const sameLineMembers: Array<TSESTree.Node> = []
    const statements = sourceCode.ast.body
    const { countStatementsBefore, deepestNodeAt } = createNodeLookup(sourceCode, statements)
    let leadingCount = 0
    const lineStart = createLineStarts(text)
    const allowsFixes = !ASTRO_VIRTUAL_FILE_REGEX.test(context.filename)

    // As TypeScript's scanner finds them: at the start of a `//` comment or a block's last line.
    // Found on first use, since few files need them
    let tsDirectiveLines: Set<number> | undefined

    function getTsDirectiveLines(): Set<number> {
      if (tsDirectiveLines === undefined) {
        tsDirectiveLines = new Set()
        for (const comment of sourceCode.getAllComments()) {
          const line = tsLineDirectiveLine(comment)
          if (line !== undefined) {
            tsDirectiveLines.add(line)
          }
        }
      }
      return tsDirectiveLines
    }

    // As TypeScript's `markPrecedingCommentDirectiveLine`, the search goes up past blank lines and
    // `//` lines
    function isCoveredByTsDirective(line: number): boolean {
      const directiveLines = getTsDirectiveLines()
      if (directiveLines.size === 0) {
        return false
      }
      if (directiveLines.has(line)) {
        return true
      }
      for (let previous = line - 1; previous >= 1; previous--) {
        if (directiveLines.has(previous)) {
          return true
        }
        const lineText = sourceCode.lines[previous - 1]?.trim() ?? ''
        if (lineText !== '' && !lineText.startsWith('//')) {
          return false
        }
      }
      return false
    }

    function keepsTsDirectiveTargets(edits: Array<Edit>): boolean {
      return edits.every(
        (edit) =>
          countLineTerminators(text.slice(edit.range[0], edit.range[1])) ===
            countLineTerminators(edit.text) ||
          !isCoveredByTsDirective(sourceCode.getLocFromIndex(edit.range[0]).line),
      )
    }

    // Drops a fix or suggestion in an Astro script, or one that moves a TypeScript directive's code
    function report(descriptor: {
      loc: TSESTree.SourceLocation
      messageId: MessageId
      fix?: Array<Edit> | undefined
      suggest?: { messageId: MessageId; fix: Array<Edit> } | undefined
    }): void {
      const { loc, messageId, fix, suggest } = descriptor
      const isSafe = (edits: Array<Edit>): boolean => allowsFixes && keepsTsDirectiveTargets(edits)
      const toFix =
        (edits: Array<Edit>) =>
        (fixer: TSESLint.RuleFixer): Array<TSESLint.RuleFix> =>
          edits.map((edit) => fixer.replaceTextRange(edit.range, edit.text))
      context.report({
        loc,
        messageId,
        ...(fix !== undefined && isSafe(fix) && { fix: toFix(fix) }),
        ...(suggest !== undefined &&
          isSafe(suggest.fix) && {
            suggest: [{ messageId: suggest.messageId, fix: toFix(suggest.fix) }],
          }),
      })
    }

    function addModuleDeclarations(body: Array<TSESTree.ProgramStatement>): void {
      for (const node of body) {
        if (!MODULE_DECLARATION_TYPES.has(node.type) || isImport(node)) {
          continue
        }
        anchors.push(decoratorBefore(node) ?? node)
        addLaterDeclarators(node)
      }
    }

    // The statement anchors the first declarator. TypeScript reads a doc block before a later one,
    // also after code on its line
    function addLaterDeclarators(node: TSESTree.ProgramStatement): void {
      const declaration =
        node.type === AST_NODE_TYPES.ExportNamedDeclaration ? node.declaration : node
      if (declaration?.type === AST_NODE_TYPES.VariableDeclaration) {
        for (const declarator of declaration.declarations.slice(1)) {
          optionalAnchors.push(declarator)
          sameLineAnchors.push(declarator)
        }
      }
    }

    // An exported class's first decorator comes before `export`, so comments above it attach
    function decoratorBefore(node: TSESTree.ProgramStatement): TSESTree.Decorator | undefined {
      const declaration =
        node.type === AST_NODE_TYPES.ExportNamedDeclaration ||
        node.type === AST_NODE_TYPES.ExportDefaultDeclaration
          ? node.declaration
          : null
      // ESLint's parser, which lints a JavaScript-only project, leaves out `decorators`
      const decorators: ReadonlyArray<TSESTree.Decorator> | undefined =
        declaration?.type === AST_NODE_TYPES.ClassDeclaration ? declaration.decorators : undefined
      const decorator = decorators?.[0]
      return decorator !== undefined && decorator.range[0] < node.range[0] ? decorator : undefined
    }

    // The offset after which code stays on an ESLint line directive's line: anywhere for
    // `eslint-disable-next-line`, after the comment for `eslint-disable-line`
    let eslintDirectiveStarts: Map<number, number> | undefined

    function getEslintDirectiveStarts(): Map<number, number> {
      if (eslintDirectiveStarts === undefined) {
        eslintDirectiveStarts = new Map()
        for (const directive of sourceCode.getAllComments()) {
          const line = eslintDirectiveLine(directive)
          if (line === undefined) {
            continue
          }
          const start = line > directive.loc.end.line ? -1 : directive.range[0]
          eslintDirectiveStarts.set(line, Math.min(start, eslintDirectiveStarts.get(line) ?? start))
        }
      }
      return eslintDirectiveStarts
    }

    // Moving that code would leave the directive unused and the code reported. An
    // `eslint-disable-line` after the code moves with it
    function movesEslintDirectiveTarget(comment: Comment): boolean {
      if (isLastOnLine(text, comment.range[1])) {
        return false
      }
      const start = getEslintDirectiveStarts().get(comment.loc.end.line)
      return start !== undefined && start < comment.range[0]
    }

    function isFirstOnLine(comment: Comment): boolean {
      return indentBefore(text, lineStart, comment.range[0]) !== undefined
    }

    // Up to a blank line. A doc block before the line's last comment ends the run, so no fix spans
    // it
    function attachedComments(anchor: Anchor): Array<Comment> {
      const before = sourceCode.getCommentsBefore(anchor)
      // Reversed once, since `unshift` is linear in the run's length
      const reversed: Array<Comment> = []
      let boundary = anchor.loc.start.line
      let end = before.length
      while (end > 0) {
        const last = before[end - 1]
        if (!last || isShebang(last) || last.loc.end.line < boundary - 1) {
          break
        }
        let start = end - 1
        while (start > 0 && before[start - 1]?.loc.end.line === before[start]?.loc.start.line) {
          start--
        }
        const line = before.slice(start, end)
        const [first] = line
        if (!first || isShebang(first) || !isFirstOnLine(first)) {
          break
        }
        const docIndex = line.findLastIndex(isDocBlock)
        const lineStartIndex = docIndex > 0 ? start + docIndex : start
        for (let index = end - 1; index >= lineStartIndex; index--) {
          const comment = before[index]
          if (comment) {
            reversed.push(comment)
          }
        }
        if (docIndex > 0) {
          break
        }
        boundary = first.loc.start.line
        end = start
      }
      if (reversed.length === 0) {
        return detachedDocBlock(before, anchor)
      }
      return reversed.toReversed()
    }

    // TypeScript reads a doc block across blank lines, on hover and in a `.d.ts`. Only the nearest,
    // so a module header above another doc block stays one
    function detachedDocBlock(before: Array<Comment>, anchor: Anchor): Array<Comment> {
      const last = before.at(-1)
      return last !== undefined &&
        isDocBlock(last) &&
        isFirstOnLine(last) &&
        last.loc.end.line < anchor.loc.start.line - 1
        ? [last]
        : []
    }

    function trailingComments(run: Array<Comment>, index: number): Array<Comment> {
      const line = run[index]?.loc.end.line
      const trailing: Array<Comment> = []
      for (let next = index + 1; next < run.length; next++) {
        const comment = run[next]
        if (comment === undefined || comment.loc.start.line !== line) {
          break
        }
        trailing.push(comment)
      }
      return trailing
    }

    // A directive after it on its line, such as `// NOSONAR`, leaves the line as it is
    function isPinned(run: Array<Comment>, index: number): boolean {
      const doc = run[index]
      return doc !== undefined && isDocBlock(doc) && trailingComments(run, index).some(isLeftAsIs)
    }

    // A suggestion moves a `//` comment after a doc block to its own line above it. Returns whether
    // it reported
    function checkTrailing(run: Array<Comment>): boolean {
      for (const [index, doc] of run.entries()) {
        if (!isDocBlock(doc)) {
          continue
        }
        const trailing = trailingComments(run, index)
        if (trailing.length === 0 || trailing.some(isLeftAsIs)) {
          continue
        }
        const [comment] = trailing
        if (trailing.length !== 1 || comment?.type !== AST_TOKEN_TYPES.Line) {
          return false
        }
        const docLineStart = lineStart(doc.range[0])
        const indent = indentBefore(text, lineStart, skipSpaces(text, docLineStart)) ?? ''
        const eol = lineEndingAt(text, lineStart, doc.range[0])
        report({
          loc: { start: doc.loc.start, end: comment.loc.end },
          messageId: 'trailingNote',
          suggest: {
            messageId: 'toNoteLine',
            fix: [
              {
                range: [docLineStart, docLineStart],
                text: `${indent}${sourceCode.getText(comment)}${eol}`,
              },
              { range: [doc.range[1], comment.range[1]], text: '' },
            ],
          },
        })
        return true
      }
      return false
    }

    // As in `{ /** The size */ size: number }`
    function sameLineDocBlock(anchor: TSESTree.Node): Comment | undefined {
      const comment = sourceCode.getCommentsBefore(anchor).at(-1)
      return comment !== undefined &&
        isDocBlock(comment) &&
        !isFirstOnLine(comment) &&
        text.slice(comment.range[1], anchor.range[0]).trim() === '' &&
        comment.loc.end.line === anchor.loc.start.line
        ? comment
        : undefined
    }

    // A suggestion moves it above. No tagged block moves, since TypeScript would read it, nor a
    // line directive's line
    function checkSameLine(comment: Comment, anchor: TSESTree.Node): void {
      if (isLeftAsIs(comment) || isDocBlockDirective(comment)) {
        return
      }
      const commentStart = lineStart(comment.range[0])
      const lineIndent = text.slice(commentStart, skipSpaces(text, commentStart))
      const containerStart = lineStart(anchor.parent?.range[0] ?? anchor.range[0])
      const indent =
        commentStart === containerStart
          ? `${lineIndent}${lineIndent.includes('\t') ? '\t' : '  '}`
          : lineIndent
      const eol = lineEndingAt(text, lineStart, comment.range[0])
      const lines = docBlockLines(comment.value)
      const block =
        lines.length === 0 ? sourceCode.getText(comment) : starredBlock(lines, indent, '/**', eol)
      let start = comment.range[0]
      while (text[start - 1] === ' ' || text[start - 1] === '\t') {
        start--
      }
      const directiveStarts = getEslintDirectiveStarts()
      const canFix =
        !isTagged(comment) &&
        !isUnsafeToFix(comment.value, true) &&
        !isTsDirective(comment) &&
        !directiveStarts.has(comment.loc.start.line) &&
        !directiveStarts.has(comment.loc.end.line)
      report({
        loc: comment.loc,
        messageId: 'sameLine',
        suggest: canFix
          ? {
              messageId: 'toOwnLine',
              fix: [
                { range: [start, anchor.range[0]], text: `${eol}${indent}${block}${eol}${indent}` },
              ],
            }
          : undefined,
      })
    }

    function reportLayout(comment: Comment, isJsx = false, isJsxExpression = isJsx): void {
      const opener = isJsx ? '/*' : '/**'
      const result = starredLayoutFix(
        text,
        lineStart,
        comment.range,
        comment.value,
        opener,
        isJsxExpression,
      )
      if (!result) {
        return
      }
      const { fixed, end, movesCode } = result
      const edits: Array<Edit> | undefined =
        fixed === undefined || isTsDirective(comment) || movesEslintDirectiveTarget(comment)
          ? undefined
          : [{ range: [comment.range[0], end], text: fixed }]
      report({
        loc: comment.loc,
        messageId: isJsx ? 'jsxLayout' : 'layout',
        ...(movesCode
          ? { suggest: edits && { messageId: 'toLayout', fix: edits } }
          : { fix: edits }),
      })
    }

    // A JSDoc type annotation, which starts with a tag, may stay on one line
    function checkDocBlock(comment: Comment): void {
      if (!isTypeAnnotation(comment) || isMultiLine(comment)) {
        reportLayout(comment)
      }
    }

    // `//` notes above stay, like the one `checkTrailing` moves there. A tagged note isn't one
    function isDocBelowNotes(comments: Array<Comment>): boolean {
      const doc = comments.at(-1)
      return (
        doc !== undefined &&
        isDocBlock(doc) &&
        comments
          .slice(0, -1)
          .every((comment) => comment.type === AST_TOKEN_TYPES.Line && !isTagLine(comment))
      )
    }

    // Leading `@typedef`, `@callback` and `@import` blocks declare types of their own
    function docComments(run: Array<Comment>): Array<Comment> {
      const comments = run.filter((comment) => !isLeftAsIs(comment))
      while (comments[0] !== undefined && isTypeDeclarationBlock(comments[0])) {
        comments.shift()
      }
      return comments
    }

    // Attached `//` comments and `/**` blocks merge into one doc block: by a suggestion with a `//`
    // comment or when code moves, else by a fix
    function checkAttached(run: Array<Comment>): void {
      if (checkTrailing(run)) {
        return
      }
      const comments = docComments(run)
      if (
        comments.every(
          (comment) =>
            comment.type === AST_TOKEN_TYPES.Line && URL_REGEX.test(comment.value.trim()),
        )
      ) {
        return
      }
      const [first] = comments
      const last = comments.at(-1)
      // A run with a plain block is left as it is. A doc block starting with a directive word is
      // reported on its own, and tools would read a `//` line starting with a JSDoc tag
      if (
        !first ||
        !last ||
        comments.some(isPlainBlock) ||
        comments.some(isDocBlockDirective) ||
        isTagLine(first)
      ) {
        return
      }
      const lastIndex = run.indexOf(last)
      if (isDocBelowNotes(comments)) {
        if (!isPinned(run, lastIndex)) {
          checkDocBlock(last)
        }
        return
      }
      if (comments.some(isNoteLine)) {
        return
      }
      // A `//` comment whose text can't be read leaves no lines, so no fix
      const lines = runLines(comments) ?? []
      // A fix spanning a directive inside the run would delete it
      const isContiguous = lastIndex - run.indexOf(first) === comments.length - 1
      // TypeScript reads past `//` lines, so a merge below a TypeScript directive would move it
      const isBelowTsDirective =
        run.slice(0, lastIndex).some(isTsLineDirective) ||
        isCoveredByTsDirective(first.loc.start.line)
      const hasTerminator = lines.some((line) => line.includes('*/'))
      const canFix =
        lines.length > 0 &&
        !hasTerminator &&
        isContiguous &&
        isFirstOnLine(first) &&
        !isBelowTsDirective &&
        !movesEslintDirectiveTarget(last) &&
        run.every((comment, index) => isLeftAsIs(comment) || !isPinned(run, index)) &&
        comments.every(
          (comment) =>
            !(isDocBlock(comment) && (isTagged(comment) || isUnsafeToFix(comment.value, true))) &&
            !isTagLine(comment),
        )
      const loc = { start: first.loc.start, end: last.loc.end }
      if (!canFix) {
        report({
          loc,
          messageId: hasTerminator
            ? 'docTerminator'
            : isBelowTsDirective
              ? 'docBelowTsDirective'
              : 'docByHand',
        })
        return
      }
      const indent = indentBefore(text, lineStart, first.range[0]) ?? ''
      const eol = lineEndingAt(text, lineStart, first.range[0])
      const block = starredBlock(lines, indent, '/**', eol)
      const isAlone = isLastOnLine(text, last.range[1])
      const end = isAlone ? last.range[1] : skipSpaces(text, last.range[1])
      const fix: Array<Edit> = [
        { range: [first.range[0], end], text: isAlone ? block : `${block}${eol}${indent}` },
      ]
      // A `//` comment may label the declarations below, so only the editor offers a doc block
      report(
        !isAlone || comments.some((comment) => comment.type === AST_TOKEN_TYPES.Line)
          ? { loc, messageId: 'doc', suggest: { messageId: 'toDoc', fix } }
          : { loc, messageId: 'doc', fix },
      )
    }

    // Only imports and directive prologues come before it, and a blank line parts it from an import
    // below. Astro's parser stretches the last frontmatter import over a comment, so the check is by
    // position, and gives the frontmatter's opening `---` as a token, which starts the file
    function isModuleHeader(comment: Comment): boolean {
      const previous = sourceCode.getTokenBefore(comment, { includeComments: true })
      if (
        previous === null ||
        (previous.type as string) === 'Shebang' ||
        (previous.value === '---' && previous.range[0] === 0)
      ) {
        return true
      }
      const nextIndex = countStatementsBefore(comment.range[1])
      const next = statements[nextIndex]
      const isOnImport =
        next !== undefined && isImport(next) && next.loc.start.line <= comment.loc.end.line + 1
      const beforeCount = countStatementsBefore(comment.range[0])
      const before = statements[beforeCount - 1]
      const isAfterImports =
        beforeCount <= leadingCount &&
        (before === undefined ||
          !isImport(before) ||
          comment.range[0] >=
            (before.type === AST_NODE_TYPES.ImportDeclaration ? before.source : before).range[1])
      return !isOnImport && isAfterImports
    }

    function checkJsx(comment: Comment, isExpression: boolean): void {
      if (
        comment.type !== AST_TOKEN_TYPES.Block ||
        !(isDocBlock(comment) || isMultiLine(comment))
      ) {
        return
      }
      if (isMultiLine(comment)) {
        reportLayout(comment, true, isExpression)
        return
      }
      const lines = getBlockCommentLines(comment.value)
      report({
        loc: comment.loc,
        messageId: 'jsxLayout',
        fix:
          isUnsafeToFix(comment.value, false) || !isSafeToRewrite(lines)
            ? undefined
            : [
                {
                  range: comment.range,
                  text: lines.length === 0 ? '/* */' : `/* ${lines.join(' ')} */`,
                },
              ],
      })
    }

    // Tagged blocks stay, since tools read them where they are. One with a line that would be a
    // directive as `//` gets no fix
    function checkUnattached(comment: Comment): void {
      // Before the node lookup, as for a JSDoc cast in JSX, `{/** @type {X} */ (y)}`
      if (comment.type === AST_TOKEN_TYPES.Line || isTagged(comment)) {
        return
      }
      const containingNode = deepestNodeAt(comment.range[0])
      if (containingNode?.type.startsWith('JSX') === true) {
        checkJsx(
          comment,
          containingNode.type === AST_NODE_TYPES.JSXExpressionContainer ||
            containingNode.parent?.type === AST_NODE_TYPES.JSXExpressionContainer,
        )
        return
      }
      if (!isDocBlock(comment) || comment.value === '*') {
        return
      }
      if (isModuleHeader(comment)) {
        reportLayout(comment)
        return
      }
      const inner = withoutStarRuns(comment.value)
      const lines = docBlockLines(comment.value)
      const indent = indentBefore(text, lineStart, comment.range[0])
      if (indent === undefined || !isLastOnLine(text, comment.range[1])) {
        report({
          loc: comment.loc,
          messageId: 'notDoc',
          fix:
            !isUnsafeToFix(comment.value, true) && isSafeToRewrite(lines)
              ? [{ range: comment.range, text: `/*${inner}*/` }]
              : undefined,
        })
        return
      }
      const eol = lineEndingAt(text, lineStart, comment.range[0])
      report({
        loc: comment.loc,
        messageId: 'notDoc',
        fix:
          lines.length > 0 &&
          !isUnsafeToFix(comment.value, true) &&
          isSafeToRewrite(lines, true) &&
          // `//` lines below a directive would move it to the code below
          !isCoveredByTsDirective(comment.loc.start.line)
            ? [{ range: comment.range, text: lineComments(lines, indent, eol) }]
            : undefined,
      })
    }

    const listeners: TSESLint.RuleListener = {
      Program() {
        const firstOther = statements.findIndex(
          (statement) =>
            !isImport(statement) &&
            (statement.type !== AST_NODE_TYPES.ExpressionStatement ||
              statement.directive === undefined),
        )
        leadingCount = firstOther === -1 ? statements.length : firstOther
        addModuleDeclarations(statements)
      },
      TSModuleBlock(node) {
        addModuleDeclarations(node.body)
      },
      // TypeScript doesn't read JSDoc on a constituent, so only a type alias's own union, which
      // documents its cases, requires doc blocks
      TSUnionType(node) {
        const isAliasUnion =
          node.parent.type === AST_NODE_TYPES.TSTypeAliasDeclaration &&
          node.parent.typeAnnotation === node
        for (const type of node.types) {
          const before = sourceCode.getTokenBefore(type)
          const anchor = before?.value === '|' ? before : type
          if (isAliasUnion) {
            anchors.push(anchor)
          } else {
            optionalAnchors.push(anchor)
          }
        }
      },
      'Program:exit': function () {
        const attached = new Set<Comment>()
        for (const anchor of sameLineAnchors) {
          const comment = sameLineDocBlock(anchor)
          if (comment !== undefined) {
            attached.add(comment)
          }
        }
        for (const anchor of sameLineMembers) {
          const comment = sameLineDocBlock(anchor)
          if (comment === undefined) {
            continue
          }

          attached.add(comment)
          checkSameLine(comment, anchor)
        }
        for (const anchor of anchors) {
          const run = attachedComments(anchor)
          for (const comment of run) {
            attached.add(comment)
          }
          checkAttached(run)
        }
        for (const anchor of optionalAnchors) {
          const fullRun = attachedComments(anchor)
          const run = fullRun.filter((comment) => !attached.has(comment))
          if (checkTrailing(run) || run.some((_comment, index) => isPinned(run, index))) {
            for (const comment of run) {
              attached.add(comment)
            }
            continue
          }
          const comments = docComments(run)
          const comment = comments.at(-1)
          if (!comment || !isDocBelowNotes(comments) || isDocBlockDirective(comment)) {
            continue
          }
          checkDocBlock(comment)
          for (const comment of run) {
            attached.add(comment)
          }
        }
        for (const comment of sourceCode.getAllComments()) {
          if (isLeftAsIs(comment) || isShebang(comment)) {
            continue
          }
          // A fix would make `/** eslint-disable-next-line */` a directive, so there's none
          if (isDocBlockDirective(comment)) {
            report({ loc: comment.loc, messageId: 'notDirective' })
          } else if (!attached.has(comment)) {
            checkUnattached(comment)
          }
        }
      },
    }
    for (const type of MEMBER_TYPES) {
      listeners[type] = (node: TSESTree.Node) => {
        anchors.push(node)
        if (node.type === AST_NODE_TYPES.TSParameterProperty) {
          sameLineAnchors.push(node)
        } else {
          sameLineMembers.push(node)
        }
      }
    }
    // A module-level function declaration is an anchor, whose comments are taken first
    for (const type of OPTIONAL_ANCHOR_TYPES) {
      listeners[type] = (node: TSESTree.Node) => {
        if (
          node.type === AST_NODE_TYPES.Property &&
          node.parent.type !== AST_NODE_TYPES.ObjectExpression
        ) {
          return
        }

        optionalAnchors.push(node)
        if (node.type === AST_NODE_TYPES.Property) {
          sameLineMembers.push(node)
        } else if (node.type === AST_NODE_TYPES.TSTypeParameter) {
          sameLineAnchors.push(node)
        }
      }
    }
    if (JS_FILE_REGEX.test(context.filename)) {
      listeners.ExpressionStatement = (node) => {
        if (isDeclaringAssignment(node)) {
          optionalAnchors.push(node)
        }
      }
    }
    // A parameter that starts its function, as in `x => x`, leaves a comment before it to the
    // function
    listeners[FUNCTION_SELECTOR] = (node: TSESTree.Node) => {
      if (!('params' in node)) {
        return
      }
      for (const param of node.params) {
        if (param.type === AST_NODE_TYPES.TSParameterProperty || param.range[0] === node.range[0]) {
          continue
        }

        optionalAnchors.push(param)
        sameLineAnchors.push(param)
      }
    }
    return listeners
  },
}
