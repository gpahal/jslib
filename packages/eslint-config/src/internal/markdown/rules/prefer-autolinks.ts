import type { MarkdownRuleDefinition, MarkdownSourceCode } from '@eslint/markdown'
import type { Link, Nodes } from 'mdast'
import { toString } from 'mdast-util-to-string'

import { isRecord } from '@gpahal/std/objects'

import { getMarkdownPreferencesRule, RULE_DOCS_URL } from '@/internal/markdown/rules/utils'
import { withReport } from '@/internal/utils'

const STOCK_RULE = getMarkdownPreferencesRule('prefer-autolinks')

/**
 * As CommonMark defines it
 */
const AUTOLINK_URL_REGEX = /^[a-z][\d+.a-z-]{1,31}:[^\p{Cc}\s<>]*$/iu

/**
 * As `&amp;`, `&#38;` or `&#x26;`
 */
const CHARACTER_REFERENCE_REGEX = /&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/i

export function isLink(node: unknown): node is Link {
  return isRecord(node) && node['type'] === 'link'
}

function isInTableCell(sourceCode: MarkdownSourceCode, node: Nodes): boolean {
  for (let parent = sourceCode.getParent(node); parent; parent = sourceCode.getParent(parent)) {
    if (parent.type === 'tableCell') {
      return true
    }
  }
  return false
}

/**
 * An autolink's URL without `|` in a table cell, in an inline link or a bare URL whose source is
 * its text, without a character reference
 */
function canBeAutolink(sourceCode: MarkdownSourceCode, node: Link): boolean {
  const source = sourceCode.getText(node)
  return (
    AUTOLINK_URL_REGEX.test(node.url) &&
    !(node.url.includes('|') && isInTableCell(sourceCode, node)) &&
    (source.startsWith('[') || source === toString(node)) &&
    !CHARACTER_REFERENCE_REGEX.test(node.url)
  )
}

/**
 * So `@gpahal/markdown/no-bare-urls` can leave it out
 */
export function isAutolinkableBareUrl(sourceCode: MarkdownSourceCode, node: Link): boolean {
  return sourceCode.getText(node) === node.url && canBeAutolink(sourceCode, node)
}

/**
 * eslint-plugin-markdown-preferences' `prefer-autolinks` for links that can be autolinks. In 0.42.0
 * its `<url>` fix turned `[LICENSE](LICENSE)` into an HTML tag. A URL with `|` in a table cell is
 * skipped, since parsers disagree on `\|` in an autolink, and so is a URL with a character
 * reference, which an autolink resolves again, as `<https://a.dev/&lt;>` links to `/<`. Switch to
 * the plugin's rule once a release checks the URL
 */
export const preferAutolinks: MarkdownRuleDefinition<{
  RuleOptions: []
  MessageIds: 'useAutolinkInsteadGFMAutolink' | 'useAutolinkInsteadInlineLink'
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'layout',
    docs: {
      description: 'Enforce the use of autolinks for URLs that can be autolinks',
      url: RULE_DOCS_URL,
    },
    fixable: 'code',
    messages: {
      useAutolinkInsteadGFMAutolink: 'Use an autolink, `<URL>`, instead of a bare URL',
      useAutolinkInsteadInlineLink:
        'Use an autolink, `<URL>`, instead of an inline link with the same URL',
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context
    const report: typeof context.report = (descriptor) => {
      const node: unknown = 'node' in descriptor ? descriptor.node : undefined
      if (isLink(node) && canBeAutolink(sourceCode, node)) {
        context.report(descriptor)
      }
    }
    return STOCK_RULE.create(withReport(context, report))
  },
}
