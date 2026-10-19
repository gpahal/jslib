import type { MarkdownRuleDefinition } from '@eslint/markdown'
import type { ListItem, Paragraph } from 'mdast'

import { MARKDOWN_LINE_BREAK_REGEX } from '@/internal/markdown/line-breaks'
import { getLoc, getRange, RULE_DOCS_URL } from '@/internal/markdown/rules/utils'

// Adapted from `@eslint/markdown`'s `no-missing-atx-heading-space` (MIT)

/**
 * 1 to 6 `#` at a line's start, after a later paragraph line's container markers, followed by
 * something other than `#` or whitespace: Markdown parses it as a paragraph, so it's likely a
 * heading missing its space. Not `#123`, a shebang or the keycap emoji `#️⃣`
 */
const LEADING_HASHES_REGEX =
  /(?:^|(?<=[\r\n])(?<prefix>[\t >]*))(?<hashes>#{1,6})(?!\d+\b)(?!!|\u{FE0F}?\u{20E3})(?:[^# \t]|$)/gu

/**
 * A hex color or a C directive such as `#include`. A lowercase color without a digit could be a
 * word, such as `#add` or `#decade`, so it counts only as one letter three or four times, as in
 * `#fff`, or letter pairs, as in `#aabbcc` or `#fafafa`. A word such as `Add` reads as a heading's
 */
const NOT_HEADING_REGEX =
  /^(?:(?:([a-f])\1{2,3}|(?:([a-f])\2){3,4}|([a-f]{2})\3\3|(?=[a-f]*\d)(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|[\dA-F]{3,4}|[\dA-F]{6}|[\dA-F]{8})\b|(?:include|define|if|ifdef|ifndef|elif|else|endif|pragma|import|undef|error)\b)/u

/**
 * As in `#hashtag is trending` or `#{name} in Ruby`, which may not be a heading
 */
const TAG_LIKE_START_REGEX = /^(?:[\p{L}\p{M}\p{N}_-]+|\{[^\s}]*\})[\t ]+\S/u

/**
 * Text after punctuation may be code, as Rust's `#[derive(Debug)]`
 */
const WORD_START_REGEX = /^[\p{L}\p{N}]/u

/**
 * As Obsidian writes them: one token of letters, digits, `_`, `-` and `/`, not only digits
 */
const TAG_REGEX = /^(?!\p{N}+$)[\p{L}\p{M}\p{N}_/-]+$/u

/**
 * Its own copy, since `matchAll` on a shared global regex starts from `exec`'s `lastIndex`
 */
const LINE_BREAK_REGEX = new RegExp(MARKDOWN_LINE_BREAK_REGEX.source, 'gu')

/**
 * As `general` or `general #random`
 */
function isTagLine(line: string): boolean {
  const [first = '', ...others] = line.trim().split(/\s+/u)
  return (
    TAG_REGEX.test(first) &&
    others.every((token) => token.startsWith('#') && TAG_REGEX.test(token.slice(1)))
  )
}

/**
 * The line must start in the paragraph's own text, not in inline code, HTML or a link. Only a
 * one-line paragraph starting with a letter or digit, whose first word couldn't be a tag, is fixed;
 * other lines get a suggestion
 */
export const noMissingAtxHeadingSpace: MarkdownRuleDefinition<{
  RuleOptions: []
  MessageIds: 'missingSpace' | 'addSpace'
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'problem',
    docs: {
      description: 'Disallow headings without a space after the hash characters',
      url: RULE_DOCS_URL,
    },
    fixable: 'whitespace',
    hasSuggestions: true,
    messages: {
      missingSpace: 'Unexpected missing space after `#` in what looks like a heading',
      addSpace: 'Add a space after `#` to make the line a heading',
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context
    const taskTexts = new Set<Paragraph>()
    return {
      listItem(node: ListItem) {
        const [first] = node.children
        if (typeof node.checked === 'boolean' && first?.type === 'paragraph') {
          taskTexts.add(first)
        }
      },
      paragraph(node: Paragraph) {
        const range = getRange(node)
        if (!range || taskTexts.has(node)) {
          return
        }
        const textRanges = node.children.flatMap((child) => {
          const childRange = child.type === 'text' ? getRange(child) : undefined
          return childRange ? [childRange] : []
        })
        const text = sourceCode.text.slice(range[0], range[1])
        let rangeIndex = 0
        for (const match of text.matchAll(LEADING_HASHES_REGEX)) {
          const start = range[0] + match.index + (match.groups?.['prefix']?.length ?? 0)
          while ((textRanges[rangeIndex]?.[1] ?? Infinity) <= start) {
            rangeIndex++
          }
          const textRange = textRanges[rangeIndex]
          if (textRange === undefined || start < textRange[0]) {
            continue
          }
          const end = start + (match.groups?.['hashes']?.length ?? 0)
          // From `end`, since slicing the rest of the paragraph for each match is quadratic
          LINE_BREAK_REGEX.lastIndex = end - range[0]
          const lineEnd = LINE_BREAK_REGEX.exec(text)?.index ?? text.length
          const line = text.slice(end - range[0], lineEnd)
          if (isTagLine(line) || NOT_HEADING_REGEX.test(line)) {
            continue
          }
          const loc = getLoc(sourceCode, start, Math.min(end + 1, range[1]))
          const isFixable =
            start === range[0] &&
            node.position?.start.line === node.position?.end.line &&
            WORD_START_REGEX.test(line) &&
            !TAG_LIKE_START_REGEX.test(line)
          if (isFixable) {
            context.report({
              loc,
              messageId: 'missingSpace',
              fix: (fixer) => fixer.insertTextAfterRange([start, end], ' '),
            })
          } else {
            context.report({
              loc,
              messageId: 'missingSpace',
              suggest: [
                {
                  messageId: 'addSpace',
                  fix: (fixer) => fixer.insertTextAfterRange([start, end], ' '),
                },
              ],
            })
          }
        }
      },
    }
  },
}
