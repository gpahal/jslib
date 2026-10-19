import type { MarkdownSourceCode } from '@eslint/markdown'
import type { Nodes } from 'mdast'

import { getElements, getHtmlHeadingRank, parseHtmlNode } from '@/internal/markdown/rules/html'
import { getLoc, getRange, type Loc } from '@/internal/markdown/rules/utils'

export type Heading = {
  rank: number
  loc: Loc
}

/**
 * The headings of `node`, in document order: a Markdown heading, or every `<hN>` of an HTML node,
 * outside comments, each at its own location
 */
export function getHeadings(node: Nodes, sourceCode: MarkdownSourceCode): Array<Heading> {
  if (!node.position) {
    return []
  }
  if (node.type === 'heading') {
    return [{ rank: node.depth, loc: node.position }]
  }
  const parsed = node.type === 'html' ? parseHtmlNode(node, sourceCode) : undefined
  if (!parsed) {
    return []
  }
  const headings: Array<Heading> = []
  for (const element of getElements(parsed.tree)) {
    const rank = getHtmlHeadingRank(element)
    const elementRange = getRange(element)
    if (rank !== undefined && elementRange) {
      headings.push({
        rank,
        loc: getLoc(sourceCode, parsed.start + elementRange[0], parsed.start + elementRange[1]),
      })
    }
  }
  return headings
}
