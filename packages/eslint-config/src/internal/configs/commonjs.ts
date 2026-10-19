import globals from 'globals'

import { CODE_BLOCK_FILES, COMMONJS_FILES } from '@/internal/files'
import type { FileSpecs } from '@/internal/globs'
import type { TypedConfig, TypedRules } from '@/internal/types'

/**
 * The TypeScript parser, which parses JavaScript too, accepts ESM syntax in a script
 */
function noEsmRule(message: string): TypedRules {
  return {
    '@gpahal/no-esm-in-commonjs': [
      'error',
      ...[
        'ImportDeclaration',
        'ExportNamedDeclaration',
        'ExportDefaultDeclaration',
        'ExportAllDeclaration',
        "MetaProperty[meta.name='import']",
      ].map((selector) => ({ selector, message })),
    ],
  }
}

/**
 * typescript-eslint's base config overrides ESLint's `sourceType` for `.cjs`, so it's set again
 */
const SCRIPT_LANGUAGE_OPTIONS = {
  sourceType: 'commonjs',
  // The function scope that Node wraps the file in
  parserOptions: { ecmaFeatures: { globalReturn: true } },
} as const

/**
 * `verbatimModuleSyntax` requires `import = require` and `export =` in `.cts` files, and CommonJS
 * has no top-level `await`
 */
export function commonjsExemptions({ files }: { files: FileSpecs }): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/commonjs/rules',
      files: [...COMMONJS_FILES, ...files],
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
        'unicorn/prefer-module': 'off',
        'unicorn/prefer-top-level-await': 'off',
      },
    },
  ]
}

/**
 * `@types/node` declares CommonJS's globals, so TypeScript passes `__dirname` in an ES module, where
 * it throws. As globals, `unicorn/prefer-module` reports them. The node preset repeats this after
 * eslint-plugin-n's `flat/recommended-module`, which turns them off
 */
export function esmTypescriptGlobals(name: string): TypedConfig {
  return {
    name,
    files: ['**/*.{ts,mts,tsx}'],
    ignores: CODE_BLOCK_FILES,
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'writable',
      },
    },
  }
}

export function commonjs({ files }: { files: FileSpecs }): Array<TypedConfig> {
  return [
    esmTypescriptGlobals('gpahal/commonjs/esm-typescript-globals'),
    {
      name: 'gpahal/commonjs/globals',
      files: [...COMMONJS_FILES, ...files],
      languageOptions: {
        globals: globals.node,
      },
    },
    // Not `.cts` files, where TypeScript compiles `import` to `require()`
    {
      name: 'gpahal/commonjs/cjs',
      files: ['**/*.cjs'],
      languageOptions: SCRIPT_LANGUAGE_OPTIONS,
      rules: noEsmRule('`.cjs` files are CommonJS: use `require()` and `module.exports`'),
    },
    ...(files.length > 0
      ? [
          {
            name: 'gpahal/commonjs/js',
            files,
            ignores: CODE_BLOCK_FILES,
            languageOptions: SCRIPT_LANGUAGE_OPTIONS,
            rules: noEsmRule(
              '`commonjs` makes this file CommonJS: use `require()` and `module.exports`',
            ),
          } satisfies TypedConfig,
        ]
      : []),
  ]
}
