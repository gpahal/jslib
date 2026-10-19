import type { MarkdownRuleDefinition } from '@eslint/markdown'
import GithubSlugger from 'github-slugger'
import type { Root } from 'hast'
import type { Heading, Nodes } from 'mdast'
import type { Position } from 'unist'

import {
  getElements,
  getHtmlAttribute,
  getHtmlHeadingRank,
  getHtmlText,
  parseHtmlNode,
} from '@/internal/markdown/rules/html'
import { forEachNode } from '@/internal/markdown/rules/traverse'
import { RULE_DOCS_URL } from '@/internal/markdown/rules/utils'

// Adapted from `@eslint/markdown`'s `no-missing-link-fragments` (MIT)

/**
 * GitHub's links to lines of a file
 */
const GITHUB_LINE_REFERENCE_REGEX = /^L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/u
/**
 * As many site generators accept
 */
const CUSTOM_HEADING_ID_REGEX = /^\{#(?<id>[^}\s]+)\}$/u

/**
 * Not in inline code. Only the text from its last `{#` is matched, so a long run is read once
 */
function getCustomHeadingId(heading: Heading): string | undefined {
  const last = heading.children.at(-1)
  if (last?.type !== 'text') {
    return undefined
  }
  const text = last.value.trimEnd()
  return CUSTOM_HEADING_ID_REGEX.exec(text.slice(text.lastIndexOf('{#')))?.groups?.['id']
}
const GITHUB_ID_PREFIX = 'user-content-'

/**
 * Text, inline code and math, but not HTML or image alt text
 */
function getSluggedText(node: Nodes): string {
  if (node.type === 'html') {
    return ''
  }
  if ('children' in node) {
    return node.children.map((child) => getSluggedText(child as Nodes)).join('')
  }
  return 'value' in node ? node.value : ''
}

/**
 * `id` as written, the `name` of an `<a>`, and its headings' ids from their text
 */
function addHtmlIds(
  tree: Root,
  addExplicitId: (id: string) => void,
  addHeadingId: (text: string) => void,
): void {
  for (const element of getElements(tree)) {
    const name = element.tagName === 'a' ? getHtmlAttribute(element, 'name') : undefined
    for (const id of [getHtmlAttribute(element, 'id'), name]) {
      if (id !== undefined && id !== '') {
        addExplicitId(id)
      }
    }
    if (getHtmlHeadingRank(element) !== undefined) {
      addHeadingId(getHtmlText(element))
    }
  }
}

/**
 * Following GitHub. Heading ids share one slugger and match in any case. Explicit ids (`id`,
 * `name`, a trailing `{#id}`) match case-sensitively, as browsers do. Footnotes have `fn-x` and
 * `fnref-x`, the `user-content-` prefix is accepted, and `#top` and line links are always valid
 */
export const noMissingLinkFragments: MarkdownRuleDefinition<{
  RuleOptions: []
  MessageIds: 'missingFragment'
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'problem',
    docs: {
      description: 'Disallow link fragments that do not reference a heading or anchor',
      url: RULE_DOCS_URL,
    },
    messages: {
      missingFragment:
        'Unexpected link fragment `#{{fragment}}`, no heading or anchor in this document has that id',
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context
    return {
      root(root) {
        const explicitIds = new Set<string>()
        const generatedIds = new Set(['top'])
        const slugger = new GithubSlugger()
        const addExplicitId = (id: string) => {
          explicitIds.add(id)
        }
        const addHeadingId = (text: string) => {
          generatedIds.add(slugger.slug(text).toLowerCase())
        }
        const hasId = (id: string) => explicitIds.has(id) || generatedIds.has(id.toLowerCase())

        forEachNode(root, (node) => {
          if (node.type === 'heading') {
            const customId = getCustomHeadingId(node)
            if (customId === undefined) {
              addHeadingId(getSluggedText(node))
            } else {
              addExplicitId(customId)
            }
          } else if (node.type === 'html') {
            const parsed = parseHtmlNode(node, sourceCode)
            if (parsed) {
              addHtmlIds(parsed.tree, addExplicitId, addHeadingId)
            }
          }
        })
        forEachNode(root, (node) => {
          if (node.type !== 'footnoteDefinition') {
            return
          }
          const label = node.label ?? node.identifier
          generatedIds.add(`fn-${label}`.toLowerCase())
          generatedIds.add(`fnref-${label}`.toLowerCase())
        })

        const checkFragment = (fragment: string, loc: Position) => {
          let decoded = fragment
          try {
            decoded = decodeURIComponent(fragment)
          } catch {
            // An invalid escape sequence, such as `%E0%A4%A`: compare the fragment as written
          }
          if (GITHUB_LINE_REFERENCE_REGEX.test(decoded)) {
            return
          }
          const id = decoded.startsWith(GITHUB_ID_PREFIX)
            ? decoded.slice(GITHUB_ID_PREFIX.length)
            : decoded
          if (!hasId(decoded) && !hasId(id)) {
            context.report({ loc, messageId: 'missingFragment', data: { fragment } })
          }
        }
        forEachNode(root, (node) => {
          if (
            (node.type === 'link' || node.type === 'definition') &&
            node.url.startsWith('#') &&
            node.url !== '#' &&
            node.position
          ) {
            checkFragment(node.url.slice(1), node.position)
          }
        })
      },
    }
  },
}
