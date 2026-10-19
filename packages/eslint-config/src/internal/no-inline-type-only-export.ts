/**
 * The `@gpahal/no-inline-type-only-export` rule: an `export { … }` whose specifiers are all types
 * is written `export type { … }`. Under `verbatimModuleSyntax`, `export { type A } from './a'`
 * compiles to `export {} from './a'`, which still loads `./a` for its side effects.
 * `unicorn/prefer-export-from` produces it from `import type { A } from './a'` and
 * `export type { A }`, and neither `@typescript-eslint/consistent-type-exports` nor
 * `import-x/consistent-type-specifier-style` reports it. The fix drops that load, so a module that
 * must run needs `import './a'`. An export with import attributes is reported without a fix
 */

import type { TSESLint } from '@typescript-eslint/utils'

import { getDocsUrl } from '@/internal/utils'

export const noInlineTypeOnlyExport: TSESLint.RuleModule<'typeOnly' | 'typeOnlyReexport'> = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description: 'Use `export type { … }` when every exported specifier is a type',
      url: getDocsUrl('own-rules'),
    },
    messages: {
      typeOnly: 'Every specifier is a type: use `export type { … }`',
      typeOnlyReexport:
        'Every specifier is a type: use `export type { … }`, since `export { type … } from` still loads the module for its side effects',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode
    return {
      ExportNamedDeclaration(node) {
        const { exportKind, specifiers } = node
        if (
          exportKind !== 'value' ||
          specifiers.length === 0 ||
          specifiers.some((specifier) => specifier.exportKind !== 'type')
        ) {
          return
        }
        // The `type` keyword that starts each specifier, and the token after it
        const keywords = specifiers.flatMap((specifier) => {
          const keyword = sourceCode.getTokenByRangeStart(specifier.range[0])
          const next = keyword && sourceCode.getTokenAfter(keyword)
          return keyword && next ? { keyword, next } : []
        })
        const exportToken = sourceCode.getFirstToken(node)
        // A comment after a `type` keyword would go with it. TypeScript rejects import attributes
        // on a type-only export
        const isFixable =
          exportToken !== null &&
          node.attributes.length === 0 &&
          keywords.length === specifiers.length &&
          keywords.every(({ keyword, next }) => !sourceCode.commentsExistBetween(keyword, next))
        context.report({
          node,
          // Only a re-export loads a module
          messageId: node.source === null ? 'typeOnly' : 'typeOnlyReexport',
          ...(isFixable && {
            fix: (fixer) => [
              fixer.insertTextAfter(exportToken, ' type'),
              ...keywords.map(({ keyword, next }) =>
                fixer.removeRange([keyword.range[0], next.range[0]]),
              ),
            ],
          }),
        })
      },
    }
  },
}
