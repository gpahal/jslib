import type { Rule } from 'eslint'

import { getDocsUrl } from '@/internal/utils'

/**
 * The Unicode bidirectional embedding, override and isolate controls, by code point, which can make
 * text display in another order than it's read, as in Trojan Source (CVE-2021-42574). The implicit
 * marks, such as U+200F RIGHT-TO-LEFT MARK, reorder nothing on their own and aren't listed
 */
const BIDI_CONTROL_NAMES: ReadonlyMap<number, string> = new Map([
  [0x20_2a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x20_2b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x20_2c, 'POP DIRECTIONAL FORMATTING'],
  [0x20_2d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x20_2e, 'RIGHT-TO-LEFT OVERRIDE'],
  [0x20_66, 'LEFT-TO-RIGHT ISOLATE'],
  [0x20_67, 'RIGHT-TO-LEFT ISOLATE'],
  [0x20_68, 'FIRST STRONG ISOLATE'],
  [0x20_69, 'POP DIRECTIONAL ISOLATE'],
])

const BIDI_CONTROL_REGEX = /[\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu

/**
 * Reports each bidirectional control character in a file's text, in any language, comments and
 * strings included, without a fix, since only the author knows which order was meant. It runs on
 * the root node of each language, whatever its type
 */
export const noBidiCharacters: Rule.RuleModule = {
  meta: {
    type: 'problem',
    // `*` lets user-config validation and ESLint run it in every language
    languages: ['*'],
    docs: {
      description: 'Disallow Unicode bidirectional control characters',
      url: getDocsUrl('own-rules'),
    },
    messages: {
      bidiCharacter:
        'Unexpected {{codePoint}} {{name}}, which can make the text display in another order than it runs. Remove it, or in a string, write it as the escape `\\u{{hex}}`',
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context
    return {
      [sourceCode.ast.type]() {
        for (const match of sourceCode.text.matchAll(BIDI_CONTROL_REGEX)) {
          const codePoint = match[0].codePointAt(0) ?? 0
          const hex = codePoint.toString(16).toUpperCase()
          context.report({
            loc: {
              start: sourceCode.getLocFromIndex(match.index),
              end: sourceCode.getLocFromIndex(match.index + 1),
            },
            messageId: 'bidiCharacter',
            data: {
              codePoint: `U+${hex}`,
              name: BIDI_CONTROL_NAMES.get(codePoint) ?? '',
              hex,
            },
          })
        }
      },
    }
  },
}
