import type { MarkdownRuleDefinition } from '@eslint/markdown'
import type { Code } from 'mdast'

import { isRecord } from '@gpahal/std/objects'

import { getLoc, getMarkdownPreferencesRule, RULE_DOCS_URL } from '@/internal/markdown/rules/utils'
import { withReport } from '@/internal/utils'

const STOCK_RULE = getMarkdownPreferencesRule('canonical-code-block-language')

const FENCE_LANGUAGE_REGEX = /^(?:`{3,}|~{3,})[\t ]*(?<language>[^\t \r\n]+)/du

function isCode(node: unknown): node is Code {
  return isRecord(node) && node['type'] === 'code'
}

/**
 * Fixes a code block language that is an alias in its `languages` option to the canonical name. The
 * preset passes only single-language aliases, so `console`, `zsh` and SQL dialects stay.
 *
 * It's eslint-plugin-markdown-preferences' `canonical-code-block-language`, without the reports for
 * a language whose canonical name isn't a string. In 0.42.0 the rule looks a block's language up in
 * a plain object, so a language that is an `Object.prototype` key, such as ` ```constructor `,
 * finds a function, and its fix crashes the whole run with "TypeError: 'text' must be a string".
 * Its range ends at the language's first character other than a letter, digit or `_`, so its fix
 * turns ` ```c++ ` into ` ```cpp++ `, and this rule reports and replaces the whole language
 * instead. A language containing an escape or character reference is reported without a fix, since
 * its source differs from the decoded language. Switch to the plugin's rule once a release checks
 * its lookup and source ranges
 */
export const canonicalCodeBlockLanguage: MarkdownRuleDefinition<{
  RuleOptions: [{ languages?: Record<string, string> }?]
  MessageIds: 'useCanonical'
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'suggestion',
    docs: {
      description: 'Enforce canonical language names in code blocks',
      url: RULE_DOCS_URL,
    },
    fixable: 'code',
    messages: {
      useCanonical: 'Use the canonical language name `{{canonical}}` instead of `{{current}}`',
    },
    schema: [
      {
        type: 'object',
        properties: {
          languages: { type: 'object', additionalProperties: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const { sourceCode } = context
    const report: typeof context.report = (descriptor) => {
      const canonical = descriptor.data?.['canonical']
      if (typeof canonical !== 'string') {
        return
      }

      const node: unknown = 'node' in descriptor ? descriptor.node : undefined
      const match = isCode(node) ? FENCE_LANGUAGE_REGEX.exec(sourceCode.getText(node)) : null
      const languageIndices = match?.indices?.groups?.['language']
      if (match === null || languageIndices === undefined || !isCode(node)) {
        context.report({ ...descriptor, fix: undefined })
        return
      }

      const start = sourceCode.getRange(node)[0]
      const range: [number, number] = [start + languageIndices[0], start + languageIndices[1]]
      context.report({
        ...descriptor,
        loc: getLoc(sourceCode, ...range),
        fix:
          match.groups?.['language'] === node.lang
            ? (fixer) => fixer.replaceTextRange(range, canonical)
            : undefined,
      })
    }
    return STOCK_RULE.create(withReport(context, report))
  },
}
