import type { MarkdownRuleDefinition } from '@eslint/markdown'
import type { ImageReference, LinkReference } from 'mdast'

import { RULE_DOCS_URL } from '@/internal/markdown/rules/utils'

// Ported from remark-lint-no-shortcut-reference-link and remark-lint-no-shortcut-reference-image
// (MIT)

/**
 * Reports a shortcut reference, `[text]` or `![text]`, which reads like text in brackets, with a
 * fix to the collapsed reference, `[text][]` or `![text][]`
 */
export const noShortcutReference: MarkdownRuleDefinition<{
  RuleOptions: []
  MessageIds: 'shortcutLink' | 'shortcutImage'
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'suggestion',
    docs: {
      description: 'Disallow shortcut references to definitions',
      url: RULE_DOCS_URL,
    },
    fixable: 'code',
    messages: {
      shortcutLink:
        'Unexpected shortcut reference link (`[text]`), expected collapsed reference (`[text][]`)',
      shortcutImage:
        'Unexpected shortcut reference image (`![text]`), expected collapsed reference (`![text][]`)',
    },
    schema: [],
  },
  create(context) {
    const check = (node: LinkReference | ImageReference) => {
      const { position, referenceType } = node
      const end = position?.end.offset
      if (referenceType !== 'shortcut' || position === undefined || end === undefined) {
        return
      }
      context.report({
        loc: position,
        messageId: node.type === 'linkReference' ? 'shortcutLink' : 'shortcutImage',
        fix: (fixer) => fixer.insertTextAfterRange([end, end], '[]'),
      })
    }
    return { linkReference: check, imageReference: check }
  },
}
