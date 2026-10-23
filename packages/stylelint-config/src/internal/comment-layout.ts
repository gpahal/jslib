/**
 * The `@gpahal/comment-layout` rule: a multi-line comment is laid out JSDoc-style, as the ESLint
 * rule of the same name lays out doc blocks. The package README lists the exceptions
 */

import postcss from 'postcss'
import type { Comment } from 'postcss'
import stylelint from 'stylelint'
import type { Plugin, Rule } from 'stylelint'

import {
  getBlockCommentLines,
  hasMixedStarPrefixes,
  hasTextStar,
  hasUnusualLineTerminator,
  isStarredCommentLine,
} from '@gpahal/internal/comments'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

const ruleName = '@gpahal/comment-layout'

const messages = ruleMessages(ruleName, {
  layout:
    'Lay out a multi-line comment JSDoc-style: `/*` and ` */` on their own lines, each line between starting with ` * `',
  mixed:
    "Lay out this comment JSDoc-style by hand: some of its lines start with `*` and some don't, so the fix would guess",
  textStar:
    'Lay out this comment JSDoc-style by hand: a line starts with a `*` that is text, such as `*.css` or `*Important*`, which the fix would read as a star prefix',
  ambiguous:
    'Lay out this comment JSDoc-style by hand: its first line has text and every line after it starts with `*`, which the fix would read as either star prefixes or list bullets',
  terminator:
    'Lay out this comment JSDoc-style by hand: it has a line break other than LF or CRLF, which the fix would change',
})

/**
 * The indentation of a comment that starts its line, or `undefined` when code comes before it
 */
function indentOf(comment: Comment): string | undefined {
  const before = comment.raws.before ?? ''
  if (!before.includes('\n')) {
    // The first node of an embedded stylesheet has no line break in `before`, so the document's
    // code before the stylesheet, or else the node's column, tells whether code precedes it.
    // postcss-html and postcss-markdown count a CRLF's `\r` in the column
    const codeBefore: unknown =
      comment.parent === undefined ? undefined : Reflect.get(comment.parent.raws, 'codeBefore')
    const isLineStart =
      comment.parent?.type === 'root' &&
      !comment.prev() &&
      (typeof codeBefore === 'string'
        ? codeBefore === '' || codeBefore.endsWith('\n')
        : comment.source?.start?.column === before.length + 1)
    return isLineStart && before.trim() === '' ? before : undefined
  }
  const indent = before.slice(before.lastIndexOf('\n') + 1)
  return indent.trim() === '' ? indent : undefined
}

/**
 * A line of a banner: one of `*`, `=`, `-`, `#` or `~`, repeated at least 3 times, with whitespace
 * anywhere, as in `=====` or `- - -`
 */
const BANNER_LINE_REGEX = /^\s*([#*=~-])(?:\s*\1){2,}\s*$/

/**
 * A run of 2 or more `*`, as in `/***` or `***\/`. One `*` is a doc block's `/**` or `**\/`
 */
const STAR_RULE_REGEX = /^\s*\*(?:\s*\*)+\s*$/

/**
 * Whether a comment is a banner, whose first or last line is a rule, as in `/*****` or `=== *\/`.
 * Its layout is the author's choice
 */
function isBanner(lines: ReadonlyArray<string>): boolean {
  return [lines[0] ?? '', lines.at(-1) ?? ''].some(
    (line) => BANNER_LINE_REGEX.test(line) || STAR_RULE_REGEX.test(line),
  )
}

function isLastOnLine(comment: Comment): boolean {
  const next = comment.next()
  if (next) {
    return (next.raws.before ?? '').includes('\n')
  }
  // A rule's or at-rule's `after` is the whitespace before its `}`
  const parent = comment.parent
  const after: unknown = parent === undefined ? undefined : Reflect.get(parent.raws, 'after')
  return parent?.type === 'root' || (typeof after === 'string' ? after : '\n').includes('\n')
}

/**
 * Whether a comment is commented-out CSS. Prose such as `Note: keep in sync` parses as a
 * declaration too, so those count only with a block or a final `;`
 */
function isCommentedOutCss(inner: string): boolean {
  const css = getBlockCommentLines(inner).join('\n')
  let root: postcss.Root
  try {
    root = postcss.parse(css)
  } catch {
    return false
  }
  let isCss = false
  root.walk((node) => {
    const endsWithSemicolon = css[(node.source?.end?.offset ?? 0) - 1] === ';'
    isCss ||=
      node.type === 'rule' ||
      (node.type === 'atrule' && (node.nodes !== undefined || endsWithSemicolon)) ||
      (node.type === 'decl' && endsWithSemicolon)
  })
  return isCss
}

const ruleFunction: Rule = (primary: unknown) => (root, result) => {
  if (!validateOptions(result, ruleName, { actual: primary, possible: [true] })) {
    return
  }
  // Stylelint reads only comments that start with the configured prefix as directives
  const directivePrefix = `${result.stylelint.config?.configurationComment ?? 'stylelint'}-`
  root.walkComments((comment) => {
    const { start, end } = comment.source ?? {}
    if (
      !start ||
      !end ||
      start.line === end.line ||
      comment.raws['inline'] === true ||
      comment.text.startsWith('!') ||
      comment.text.startsWith(directivePrefix)
    ) {
      return
    }
    const indent = indentOf(comment)
    if (indent === undefined || !isLastOnLine(comment)) {
      return
    }
    const inner = `${comment.raws.left ?? ''}${comment.text}${comment.raws.right ?? ''}`
    if (isBanner(inner.split(/\r?\n/)) || isCommentedOutCss(inner)) {
      return
    }
    // The fix writes the comment's line ending, which would replace a lone CR or a U+2028
    if (hasUnusualLineTerminator(inner)) {
      report({ ruleName, result, node: comment, message: messages.terminator })
      return
    }
    const [firstLine = '', ...laterLines] = inner.split(/\r?\n/)
    // Such as `/* a` followed by ` * b`: the fix can't tell a star prefix from a list bullet, and
    // either guess changes some comments' text
    const laterTextLines = laterLines.filter((line) => line.trim() !== '')
    if (
      !inner.startsWith('*') &&
      firstLine.trim() !== '' &&
      laterTextLines.length > 0 &&
      laterTextLines.every((line) => isStarredCommentLine(line))
    ) {
      report({ ruleName, result, node: comment, message: messages.ambiguous })
      return
    }
    // A fix would either drop the star of `*.css` or add a prefix that its other lines lack.
    // Before the mixed check, which a text star beside star prefixes would also fail
    if (hasTextStar(inner)) {
      report({ ruleName, result, node: comment, message: messages.textStar })
      return
    }
    // With mixed lines, telling a prefix from text, such as a list bullet, would be a guess
    if (hasMixedStarPrefixes(inner)) {
      report({ ruleName, result, node: comment, message: messages.mixed })
      return
    }
    // No `*` that starts a line is left to read as text, so all of them are star prefixes
    const lines = getBlockCommentLines(inner)
    if (lines.length === 0) {
      return
    }
    const edge = `${inner.includes('\r\n') ? '\r\n' : '\n'}${indent} `
    const text = lines.map((line) => (line === '' ? '*' : `* ${line}`)).join(edge)
    if (comment.raws.left === edge && comment.raws.right === edge && comment.text === text) {
      return
    }
    report({
      ruleName,
      result,
      node: comment,
      message: messages.layout,
      fix: {
        apply: () => {
          comment.raws.left = edge
          comment.raws.right = edge
          comment.text = text
        },
        // The comment alone, so each comment in a block gets its own edit
        node: comment,
      },
    })
  })
}

ruleFunction.ruleName = ruleName
ruleFunction.messages = messages
ruleFunction.meta = {
  url: 'https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#comment-layout',
  fixable: true,
}

export const commentLayout: Plugin = createPlugin(ruleName, ruleFunction)
