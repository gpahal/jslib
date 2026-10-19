import eslintPluginJsdoc from 'eslint-plugin-jsdoc'

import { CODE_BLOCK_FILES } from '@/internal/files'
import type { TypedConfig } from '@/internal/types'

/**
 * Tags that tools read, test environments and JSX pragmas, and TSDoc's `@defaultValue`.
 * `@typeParam` isn't one, so `jsdoc/check-tag-names` reports it in favor of `@template`
 */
const DEFINED_TAGS = [
  'vitest-environment',
  'jest-environment',
  'jsxImportSource',
  'jsx',
  'jsxFrag',
  'jsxRuntime',
  'defaultValue',
]

/**
 * Checks what JSDoc blocks say, such as `@param` names that no longer match the parameters. Their
 * layout is `@gpahal/comment-layout`'s, and TypeScript holds the types, so no rule requires a block
 * or a type, though a `@property` tag needs a description. In TypeScript files, a `@returns` tag
 * needs one too, and a block holds no types and no tags that TypeScript makes redundant. In
 * JavaScript files, the types in a block are checked. Code blocks in Markdown are examples
 */
export function jsdoc({
  files,
  typedFiles,
}: {
  files: Array<string>
  /**
   * The files with TypeScript syntax, `.astro` files included with the `astro` preset
   */
  typedFiles: Array<string>
}): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/jsdoc/rules',
      files,
      ignores: CODE_BLOCK_FILES,
      plugins: { jsdoc: eslintPluginJsdoc },
      rules: {
        'jsdoc/check-access': 'error',
        'jsdoc/check-param-names': 'error',
        'jsdoc/check-property-names': 'error',
        'jsdoc/check-tag-names': ['error', { definedTags: DEFINED_TAGS }],
        'jsdoc/check-types': 'error',
        'jsdoc/empty-tags': 'error',
        'jsdoc/implements-on-classes': 'error',
        'jsdoc/no-defaults': 'error',
        // A `* item` line is a Markdown list item, which comment-layout also writes when it merges
        // `// * item` lines into a doc block
        'jsdoc/no-multi-asterisks': ['error', { allowWhitespace: true }],
        'jsdoc/require-param-name': 'error',
        'jsdoc/require-property': 'error',
        'jsdoc/require-property-description': 'error',
        'jsdoc/require-property-name': 'error',
        'jsdoc/require-returns-check': 'error',
        'jsdoc/require-yields-check': 'error',
      },
    },
    {
      name: 'gpahal/jsdoc/rules-typescript',
      files: typedFiles,
      ignores: CODE_BLOCK_FILES,
      rules: {
        'jsdoc/check-tag-names': ['error', { typed: true, definedTags: DEFINED_TAGS }],
        // TypeScript holds the types
        'jsdoc/check-types': 'off',
        'jsdoc/no-types': 'error',
        // Not in JavaScript, where `@returns {Promise<void>}` may only give `checkJs` the type
        'jsdoc/require-returns-description': 'error',
      },
    },
  ]
}
