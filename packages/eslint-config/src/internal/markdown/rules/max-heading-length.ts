import type { MarkdownRuleDefinition } from '@eslint/markdown'
import type { Heading } from 'mdast'
import { toString } from 'mdast-util-to-string'

import { RULE_DOCS_URL } from '@/internal/markdown/rules/utils'

// Ported from remark-lint-maximum-heading-length (MIT)

const DEFAULT_MAX = 80

/**
 * Reports a heading whose text, without its `#` markers and HTML, is longer than `max` code points,
 * 80 by default
 */
export const maxHeadingLength: MarkdownRuleDefinition<{
  RuleOptions: [{ max?: number }]
  MessageIds: 'tooLong'
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'suggestion',
    docs: {
      description: 'Enforce a maximum length for heading text',
      url: RULE_DOCS_URL,
    },
    messages: {
      tooLong:
        'Unexpected `{{length}}` characters in heading, expected at most `{{max}}` characters',
    },
    schema: [
      {
        type: 'object',
        properties: { max: { type: 'integer', minimum: 1 } },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ max: DEFAULT_MAX }],
  },
  create(context) {
    const [{ max = DEFAULT_MAX }] = context.options
    return {
      heading(node: Heading) {
        // Code points, as `Array.from()` counts them
        const length = toString(node, { includeHtml: false }).match(/./gsu)?.length ?? 0
        if (node.position && length > max) {
          context.report({
            loc: node.position,
            messageId: 'tooLong',
            data: { length: String(length), max: String(max) },
          })
        }
      },
    }
  },
}
