import type { MarkdownRuleDefinition } from '@eslint/markdown'
import type { Heading, Nodes, Paragraph, TableCell } from 'mdast'
import { normalizeIdentifier } from 'micromark-util-normalize-identifier'

import { forEachNode } from '@/internal/markdown/rules/traverse'
import { getLoc, getRange, RULE_DOCS_URL } from '@/internal/markdown/rules/utils'

// Adapted from `@eslint/markdown`'s `no-missing-label-refs` (MIT)

/**
 * GitHub alerts, such as `[!NOTE]`, and commit hashes, such as a changesets changelog's
 * `[def5678]`, which need a digit, so `[defaced]` isn't one
 */
const ALLOWED_LABEL_REGEX =
  /^(?:!(?:note|tip|important|warning|caution)|(?=[a-f]*\d)[\da-f]{7,40})$/u

const LINE_ENDING_REGEX = /(?:\r?\n|\r)[\t ]*(?:>[\t ]*)*/gu
/**
 * GFM makes a defined footnote a `footnoteReference` node, so one left in text is undefined
 */
const FOOTNOTE_LABEL_REGEX = /^\^\S+$/u
const ASCII_PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')

const TEXT_CONTAINER_TYPES = new Set(['heading', 'paragraph', 'tableCell'])

/**
 * A footnote reference has no text, so the `]` of `[as in[^1]]` would close a reference
 */
const LINK_AND_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'link',
  'linkReference',
  'image',
  'imageReference',
  'footnoteReference',
])

function isTextContainer(node: Nodes): node is Heading | Paragraph | TableCell {
  return TEXT_CONTAINER_TYPES.has(node.type)
}

/**
 * Brackets can span nodes, as in `[*text*]`, so each container's text is scanned together. Brackets
 * in a link, split by inline HTML, or inside an open label aren't references
 */
export const noMissingLabelRefs: MarkdownRuleDefinition<{
  RuleOptions: []
  MessageIds: 'undefinedReference'
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'problem',
    docs: {
      description: 'Disallow missing label references',
      url: RULE_DOCS_URL,
    },
    messages: {
      undefinedReference:
        'Unexpected reference to undefined definition `{{id}}`, add a definition for {{article}} {{kind}} or escape the opening bracket (`\\[`) for text',
    },
    schema: [],
  },
  create(context) {
    // `[` only, `[a]`, `[a][` or `[a][b]`
    type BracketRange = Array<number>

    const { sourceCode } = context
    const source = sourceCode.text
    const definitions = new Set<string>()

    function report(range: BracketRange) {
      const [open, firstClose, secondOpen, secondClose] = range
      // `[`, or `[]`, which isn't worth a message
      if (
        open === undefined ||
        firstClose === undefined ||
        (secondOpen === undefined && open + 2 === firstClose)
      ) {
        return
      }
      // A second label counts once it's closed. A shortcut `[a]` is as often text, as in `[High]`,
      // so it's left alone, as markdownlint's MD052 does, but not a footnote's `[^a]`
      if (secondOpen === undefined || secondClose === undefined) {
        const label = source.slice(open + 1, firstClose - 1)
        if (secondOpen === undefined && FOOTNOTE_LABEL_REGEX.test(label)) {
          context.report({
            loc: getLoc(sourceCode, open, firstClose),
            messageId: 'undefinedReference',
            data: { id: label, article: 'a', kind: 'footnote' },
          })
        }
        return
      }
      const loc = getLoc(sourceCode, open, secondClose)
      // `\![a]` is an escaped `!` before a link
      const isImage = source[open - 1] === '!' && source[open - 2] !== '\\'
      const kind = isImage ? 'image' : 'link'
      const isFull = secondOpen + 2 !== secondClose
      const rawLabel = isFull
        ? source.slice(secondOpen + 1, secondClose - 1)
        : source.slice(open + 1, firstClose - 1)
      // `[][]` isn't worth a message, and `markdown/no-invalid-label-refs` reports `[a][ ]`
      if (rawLabel === '' || (isFull && rawLabel.trim() === '')) {
        return
      }
      // A label that wraps in a blockquote has the next line's markers in its source
      const label = rawLabel.replaceAll(LINE_ENDING_REGEX, ' ').replaceAll(/\s+/gu, ' ').trim()
      // `[ ]` and `[\n]` can't be references in CommonMark
      if (label === '') {
        return
      }
      const id = normalizeIdentifier(label).toLowerCase()
      if (definitions.has(id) || ALLOWED_LABEL_REGEX.test(id)) {
        return
      }
      context.report({
        loc,
        messageId: 'undefinedReference',
        data: { id: label, article: kind === 'image' ? 'an' : 'a', kind },
      })
    }

    // Returns the index of the next character. `ranges` holds the references still open
    function scanCharacter(
      ranges: Array<BracketRange>,
      lineStart: number,
      line: string,
      index: number,
    ): number {
      switch (line.charAt(index)) {
        case '[': {
          // A label can't hold an unescaped `[`, so an open reference isn't one
          if (ranges.at(-1)?.length === 1) {
            ranges.pop()
          }
          ranges.push([lineStart + index])
          return index + 1
        }
        case '\\': {
          // Escaped ASCII punctuation, including a backslash, is text
          return index + (ASCII_PUNCTUATION.has(line[index + 1] ?? '') ? 2 : 1)
        }
        case ']': {
          const next = index + 1
          const range = ranges.at(-1)
          if (range && line[next] === '[' && range.length !== 3) {
            range.push(lineStart + next, lineStart + next)
            return next + 1
          }
          if (range) {
            range.push(lineStart + next)
            report(range)
            ranges.pop()
          }
          return next
        }
        default: {
          return index + 1
        }
      }
    }

    function findInText(ranges: Array<BracketRange>, start: number, end: number) {
      const text = source.slice(start, end)
      const lines: Array<[number, string]> = []
      let last = 0
      for (const match of text.matchAll(LINE_ENDING_REGEX)) {
        lines.push([start + last, text.slice(last, match.index)])
        last = match.index + match[0].length
      }
      lines.push([start + last, text.slice(last)])

      for (const [lineStart, line] of lines) {
        let index = 0
        while (index < line.length) {
          index = scanCharacter(ranges, lineStart, line, index)
        }
      }
    }

    // A link's text, as in `[see [docs]](url)`, holds no references, and a link or image ends the
    // single `[` open before it. Inline HTML, as in `<kbd>[</kbd>`, ends the open references
    function findInChild(ranges: Array<BracketRange>, child: Nodes) {
      if (child.type === 'text') {
        const range = getRange(child)
        if (range) {
          findInText(ranges, range[0], range[1])
        }
        return
      }
      if (child.type === 'html') {
        ranges.length = 0
        return
      }
      if (LINK_AND_IMAGE_TYPES.has(child.type)) {
        // A label can't hold a link, so an open `[` before one isn't a reference. One before an
        // image, as around a badge `[![build](badge.svg)]`, is text
        for (let range = ranges.at(-1); range?.length === 1; range = ranges.at(-1)) {
          ranges.pop()
        }
        return
      }
      if ('children' in child) {
        findInContainer(child)
      }
    }

    function findInContainer(node: Nodes & { children: Array<Nodes> }) {
      const ranges: Array<BracketRange> = []
      for (const child of node.children) {
        findInChild(ranges, child)
      }
      for (const range of ranges) {
        report(range)
      }
    }

    return {
      root(root) {
        const containers: Array<Nodes & { children: Array<Nodes> }> = []
        forEachNode(root, (node) => {
          if (node.type === 'definition') {
            definitions.add(normalizeIdentifier(node.identifier).toLowerCase())
          } else if (isTextContainer(node)) {
            containers.push(node)
          }
        })
        for (const container of containers) {
          findInContainer(container)
        }
      },
    }
  },
}
