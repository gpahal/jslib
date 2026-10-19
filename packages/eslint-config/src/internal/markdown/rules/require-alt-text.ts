import type { MarkdownRuleDefinition } from '@eslint/markdown'
import type { Html, Image, ImageReference } from 'mdast'

import { getElements, getHtmlAttribute, parseHtmlNode } from '@/internal/markdown/rules/html'
import { getLoc, getRange, RULE_DOCS_URL } from '@/internal/markdown/rules/utils'

// Adapted from `@eslint/markdown`'s `require-alt-text` (MIT)

/**
 * `alt=""` and a bare `alt` mark an image as decorative, but only whitespace is a mistake
 */
function isMissingAlt(alt: string | undefined) {
  return alt === undefined || (alt.length > 0 && alt.trim() === '')
}

/**
 * The roles that mark an image as decorative, as `alt=""` does
 */
const DECORATIVE_ROLES: ReadonlySet<string> = new Set(['presentation', 'none'])

/**
 * Requires alternative text for images: Markdown images and image references, and HTML `<img>`
 * tags, whose attributes are read with an HTML parser. `alt=""` marks an image as decorative, and
 * an image with `aria-hidden="true"`, `role="presentation"` or `role="none"` is skipped
 */
export const requireAltText: MarkdownRuleDefinition<{
  RuleOptions: []
  MessageIds: 'missingAlt'
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'problem',
    docs: {
      description: 'Require alternative text for images',
      url: RULE_DOCS_URL,
    },
    messages: {
      missingAlt:
        'Unexpected image without alternative text. Add it, or mark a decorative image with an empty one in HTML, as in `<img src="a.png" alt="">`',
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context
    const checkImage = (node: Image | ImageReference) => {
      if (node.position && (node.alt ?? '').trim() === '') {
        context.report({ loc: node.position, messageId: 'missingAlt' })
      }
    }
    return {
      image: checkImage,
      imageReference: checkImage,
      html(node: Html) {
        const parsed = parseHtmlNode(node, sourceCode)
        if (!parsed) {
          return
        }
        for (const element of getElements(parsed.tree)) {
          const elementRange = getRange(element)
          if (!elementRange || element.tagName !== 'img') {
            continue
          }
          const isHidden =
            getHtmlAttribute(element, 'aria-hidden')?.toLowerCase() === 'true' ||
            DECORATIVE_ROLES.has(getHtmlAttribute(element, 'role')?.trim().toLowerCase() ?? '')
          if (isHidden || !isMissingAlt(getHtmlAttribute(element, 'alt'))) {
            continue
          }
          context.report({
            loc: getLoc(sourceCode, parsed.start + elementRange[0], parsed.start + elementRange[1]),
            messageId: 'missingAlt',
          })
        }
      },
    }
  },
}
