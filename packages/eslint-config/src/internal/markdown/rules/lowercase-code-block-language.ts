import type { MarkdownRuleDefinition } from '@eslint/markdown'
import type { Code } from 'mdast'

import { getLoc, RULE_DOCS_URL } from '@/internal/markdown/rules/utils'

/**
 * A code fence's opening run and the spaces after it, before the info string
 */
const FENCE_REGEX = /(?:`{3,}|~{3,})[\t ]*/uy

/**
 * The language name at the start of a code block's `lang`, before any meta joined to it without a
 * space, as in ` ```jsx:title=src/App.jsx `
 */
const LANGUAGE_REGEX = /^[\w+#-]*/u

/**
 * Reports a code block whose language isn't lower-case, as in ` ```JS `, and fixes it to lower
 * case, leaving the rest of `lang`, such as `:title=src/App.jsx`.
 * `@gpahal/markdown/canonical-code-block-language` then renames an alias, as in ` ```JavaScript `,
 * which it matches only in lower case. A language with an escape or a character reference in its
 * source is reported without a fix
 */
export const lowercaseCodeBlockLanguage: MarkdownRuleDefinition<{
  RuleOptions: []
  MessageIds: 'lowercase'
}> = {
  meta: {
    languages: ['markdown/*'],
    type: 'suggestion',
    docs: {
      description: 'Enforce lower-case language names in code blocks',
      url: RULE_DOCS_URL,
    },
    fixable: 'code',
    messages: {
      lowercase: 'Use the lowercase language name `{{lowercase}}` instead of `{{current}}`',
    },
    schema: [],
  },
  create(context) {
    const { text } = context.sourceCode
    return {
      code(node: Code) {
        const { position } = node
        const start = position?.start.offset
        const lang = node.lang == null ? undefined : LANGUAGE_REGEX.exec(node.lang)?.[0]
        if (
          lang === undefined ||
          position === undefined ||
          start === undefined ||
          lang === lang.toLowerCase()
        ) {
          return
        }
        const lowercase = lang.toLowerCase()
        FENCE_REGEX.lastIndex = start
        const fence = FENCE_REGEX.exec(text)
        const langStart = start + (fence?.[0].length ?? 0)
        const langEnd = langStart + lang.length
        const hasSource = fence !== null && text.slice(langStart, langEnd) === lang
        context.report({
          loc: hasSource ? getLoc(context.sourceCode, langStart, langEnd) : position,
          messageId: 'lowercase',
          data: { lowercase, current: lang },
          fix: hasSource
            ? (fixer) => fixer.replaceTextRange([langStart, langEnd], lowercase)
            : null,
        })
      },
    }
  },
}
