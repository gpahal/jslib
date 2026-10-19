import type { MarkdownRuleDefinition } from '@eslint/markdown'
import type { Nodes, Paragraph } from 'mdast'
import type { Node, Parent } from 'unist'

import { RULE_DOCS_URL } from '@/internal/markdown/rules/utils'

// Ported from remark-lint-no-emphasis-as-heading (MIT)

/**
 * The punctuation that ends a sentence or a lead-in, as markdownlint's MD036 lists it by default
 */
const TRAILING_PUNCTUATION = new Set('.,;:!?。，；：！？')

function textOf(node: Nodes): string {
  if ('value' in node) {
    return node.value
  }
  return 'children' in node ? node.children.map((child) => textOf(child)).join('') : ''
}

/**
 * Reports a paragraph of only emphasis or strong text followed by another paragraph, which reads as
 * a heading but isn't one. As markdownlint's MD036 does, emphasis that ends in punctuation, such as
 * a bold lead-in `**Note:**` or an italic sentence, isn't a heading, and neither is a paragraph in a
 * list item
 */
export const noEmphasisAsHeading: MarkdownRuleDefinition<{
  RuleOptions: []
  MessageIds: 'emphasisAsHeading'
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'suggestion',
    docs: {
      description: 'Disallow emphasis or strong text used as a heading',
      url: RULE_DOCS_URL,
    },
    messages: {
      emphasisAsHeading: 'Unexpected {{type}} introducing a section, expected a heading instead',
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context
    // Each parent's children by index, built once, since a lookup per paragraph is quadratic in
    // the number of siblings
    const indexes = new Map<Parent, Map<Node, number>>()
    const getNextSibling = (node: Paragraph): Node | undefined => {
      const parent = sourceCode.getParent(node)
      if (parent === undefined) {
        return undefined
      }
      let parentIndexes = indexes.get(parent)
      if (parentIndexes === undefined) {
        parentIndexes = new Map(parent.children.map((child, index) => [child, index]))
        indexes.set(parent, parentIndexes)
      }
      const index = parentIndexes.get(node)
      return index === undefined ? undefined : parent.children[index + 1]
    }
    const isInListItem = (node: Node): boolean => {
      for (let parent = sourceCode.getParent(node); parent; parent = sourceCode.getParent(parent)) {
        if (parent.type === 'listItem') {
          return true
        }
      }
      return false
    }
    return {
      paragraph(node: Paragraph) {
        const [head] = node.children
        if (
          node.children.length !== 1 ||
          !node.position ||
          (head?.type !== 'emphasis' && head?.type !== 'strong')
        ) {
          return
        }
        if (
          getNextSibling(node)?.type !== 'paragraph' ||
          TRAILING_PUNCTUATION.has(textOf(head).trimEnd().at(-1) ?? '') ||
          isInListItem(node)
        ) {
          return
        }
        context.report({
          loc: node.position,
          messageId: 'emphasisAsHeading',
          data: { type: head.type },
        })
      },
    }
  },
}
