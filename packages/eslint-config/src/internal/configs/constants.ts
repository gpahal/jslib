/**
 * Area constants that `areas.ts` reads, apart from the config modules, which import plugins only
 * when an area is on
 */

import { CODE_BLOCK_FILES, CODE_EXTNS } from '@/internal/files'
import type { TypedRules } from '@/internal/types'

/**
 * An example may export an anonymous default, and its virtual file is named by number or meta
 */
export const UNICORN_CODE_BLOCK_RULES: TypedRules = {
  'unicorn/no-anonymous-default-export': 'off',
  'unicorn/filename-case': 'off',
}

/**
 * Skipped with every file under them, whatever options you give: folders such as `__tests__`,
 * router segments (`[postId]`, `[...slug]`, `(marketing)`, `@modal`), and files tools name
 */
export const FILENAME_CASE_IGNORES: ReadonlyArray<string> = [
  '^__[a-z]+__$',
  String.raw`^\[.+\]`,
  String.raw`^\(.+\)$`,
  '^@',
  String.raw`^(?:vite|next)-env\.d\.ts$`,
  // Test setup files, whose names follow the test tools' docs
  String.raw`^(?:(?:vitest|jest|test)[-.]setup|setup(?:Tests|-tests))\.(?:${CODE_EXTNS.join('|')})$`,
  // ESLint 10 lints text without a file name, as from `eslint --stdin`, as `__placeholder__.js`,
  // which unicorn's check of virtual file names misses
  String.raw`^__placeholder__\.js$`,
]

export const E18E_RULE_SET_DEFAULTS = {
  modernization: true,
  moduleReplacements: false,
  performanceImprovements: true,
} as const

/**
 * Examples may export an anonymous default and import packages the project doesn't install
 */
export const IMPORTS_CODE_BLOCK_RULES: TypedRules = {
  'import-x/no-anonymous-default-export': 'off',
  'import-x/no-unresolved': 'off',
  'import-x/no-extraneous-dependencies': 'off',
}

/**
 * A disable comment in a Markdown file needs a reason too
 */
export const ESLINT_COMMENTS_MARKDOWN_RULES: TypedRules = {
  '@eslint-community/eslint-comments/require-description': ['error', { ignore: ['eslint-enable'] }],
}

/**
 * Examples often write JSON with comments
 */
export const CODE_BLOCK_JSON_FILES: Array<string> = CODE_BLOCK_FILES.map((glob) => `${glob}/*.json`)

/**
 * Skipped by the `packageJson` and `pnpm` areas, presets and `rules` alike
 */
export const FIXTURE_IGNORES: Array<string> = ['**/fixtures/**', '**/__fixtures__/**']

export const PACKAGE_JSON_FILES: Array<string> = ['**/package.json']

export const PNPM_FILES: Array<string> = ['**/package.json', '**/pnpm-workspace.yaml']
