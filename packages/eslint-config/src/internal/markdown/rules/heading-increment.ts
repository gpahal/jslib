import type { MarkdownRuleDefinition } from '@eslint/markdown'

import { getHeadings } from '@/internal/markdown/rules/headings'
import { forEachNode } from '@/internal/markdown/rules/traverse'
import {
  FRONTMATTER_TITLE_META,
  getFrontmatterTitleRegex,
  isFrontmatterWithTitle,
  RULE_DOCS_URL,
} from '@/internal/markdown/rules/utils'

// Adapted from `@eslint/markdown`'s `heading-increment` (MIT)

/**
 * Reports a heading more than one rank below the closest heading of a lower rank. HTML `<h1>` to
 * `<h6>` count, and a top-level line of front matter that `frontmatterTitle` matches, a `title`
 * key by default, counts as a rank 1 heading: in YAML a key of the root mapping, and in TOML a key
 * before the first table. `@eslint/markdown` counts every line, such as a nested mapping's
 * `title`. An empty `frontmatterTitle` turns the check of front matter off, as in `no-multiple-h1`
 */
export const headingIncrement: MarkdownRuleDefinition<{
  RuleOptions: [{ frontmatterTitle?: string }]
  MessageIds: 'skippedRank'
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'problem',
    docs: {
      description: 'Enforce heading levels increment by one',
      url: RULE_DOCS_URL,
    },
    messages: {
      skippedRank: 'Unexpected heading rank `{{rank}}`, expected rank `{{expected}}`',
    },
    ...FRONTMATTER_TITLE_META,
  },
  create(context) {
    const { sourceCode } = context
    const titleRegex = getFrontmatterTitleRegex(context.options)
    return {
      root(root) {
        // The ranks of the headings that a following heading is under, such as 1 and 2 after `# A`
        // and `## B`. A heading drops the higher ranks, and a front matter title is rank 1
        const ranks = new Set<number>()
        forEachNode(root, (node) => {
          if (titleRegex !== undefined && isFrontmatterWithTitle(node, titleRegex)) {
            ranks.clear()
            ranks.add(1)
            return
          }
          for (const { rank, loc } of getHeadings(node, sourceCode)) {
            let parentRank = rank - 1
            while (parentRank > 0 && !ranks.has(parentRank)) {
              parentRank--
            }
            if (parentRank > 0 && rank > parentRank + 1) {
              context.report({
                loc,
                messageId: 'skippedRank',
                data: { rank: String(rank), expected: String(parentRank + 1) },
              })
            }
            for (const other of ranks) {
              if (other > rank) {
                ranks.delete(other)
              }
            }
            ranks.add(rank)
          }
        })
      },
    }
  },
}
