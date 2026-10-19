import type { MarkdownRuleDefinition } from '@eslint/markdown'
import type { Heading, Html, Nodes } from 'mdast'

import { getHeadings } from '@/internal/markdown/rules/headings'
import {
  FRONTMATTER_TITLE_META,
  getFrontmatterTitleRegex,
  isFrontmatterWithTitle,
  RULE_DOCS_URL,
} from '@/internal/markdown/rules/utils'

// Adapted from `@eslint/markdown`'s `no-multiple-h1` (MIT)

/**
 * Reports each rank 1 heading after the first: a Markdown `#` or setext heading, or an HTML `<h1>`
 * outside comments. A top-level line of front matter that `frontmatterTitle` matches without its
 * indentation counts as the first, as `heading-increment` reads one: in YAML a key of the root
 * mapping, and in TOML a key before the first table. `@eslint/markdown` counts every line, such as
 * a nested mapping's `title`. An empty `frontmatterTitle` turns the check off. HTML is read with
 * the parser `heading-increment` uses, not `@eslint/markdown`'s regex, which takes quadratic time
 * on an unclosed `<!--`
 */
export const noMultipleH1: MarkdownRuleDefinition<{
  RuleOptions: [{ frontmatterTitle?: string }]
  MessageIds: 'multipleH1'
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'problem',
    docs: {
      description: 'Disallow multiple H1 headings in the same document',
      url: RULE_DOCS_URL,
    },
    messages: {
      multipleH1: 'Unexpected additional H1 heading',
    },
    ...FRONTMATTER_TITLE_META,
  },
  create(context) {
    const { sourceCode } = context
    const titleRegex = getFrontmatterTitleRegex(context.options)
    let count = 0
    const check = (node: Heading | Html) => {
      for (const { rank, loc } of getHeadings(node, sourceCode)) {
        if (rank !== 1) {
          continue
        }
        count++
        if (count > 1) {
          context.report({ loc, messageId: 'multipleH1' })
        }
      }
    }
    return {
      'yaml, toml': function (node: Nodes) {
        if (titleRegex !== undefined && isFrontmatterWithTitle(node, titleRegex)) {
          count++
        }
      },
      heading: check,
      html: check,
    }
  },
}
