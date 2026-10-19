/**
 * The `typescript` area's configs for a JavaScript-only project, which loads neither
 * typescript-eslint nor TypeScript
 */

import { createRequire } from 'node:module'

import type * as TypescriptEslintParser from '@typescript-eslint/parser'

import { clonePlain } from '@gpahal/std/objects'

import { TYPED_CODE_FILES, UNTYPED_CODE_FILES } from '@/internal/files'
import { intersectFiles, type FileSpecs, type Scope } from '@/internal/globs'
import { PACKAGE_META } from '@/internal/package-meta'
import { isRuleOn } from '@/internal/rules'
import type { TypedConfig, TypedRules } from '@/internal/types'

/**
 * Replaced by typescript-eslint's type-checked configs. `no-implied-eval`, `no-throw-literal` and
 * `prefer-promise-reject-errors` report `setTimeout('code')`, `throw 'text'` and `reject('text')`
 */
const UNTYPED_CORE_RULES: TypedRules = {
  'no-implied-eval': 'error',
  'no-throw-literal': 'error',
  'prefer-promise-reject-errors': 'error',
}

/**
 * Replaced by the stylistic type-checked config. Not in TypeScript code, whose index signatures
 * `object['key']` may be written for. `dot-notation` gets that config's options
 */
const UNTYPED_JAVASCRIPT_CORE_RULES: TypedRules = {
  'dot-notation': ['error', { allowKeywords: true, allowPattern: '' }],
}

/**
 * So the core rules run where `disableTypeChecked` turns typescript-eslint's off
 */
export function untypedCoreConfigs(untyped: Scope): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/typescript/untyped-core-rules',
      files: [...untyped.files],
      ...(untyped.ignores && { ignores: [...untyped.ignores] }),
      rules: clonePlain(UNTYPED_CORE_RULES),
    },
    {
      name: 'gpahal/typescript/untyped-javascript-core-rules',
      files: intersectFiles(untyped.files, UNTYPED_CODE_FILES),
      ...(untyped.ignores && { ignores: [...untyped.ignores] }),
      rules: clonePlain(UNTYPED_JAVASCRIPT_CORE_RULES),
    },
  ]
}

/**
 * With `isUnicornOn`, an unused `catch (error)` is left to `unicorn/prefer-optional-catch-binding`
 */
export function unusedVarsOptions(isUnicornOn: boolean): Record<string, unknown> {
  return {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_',
    ...(isUnicornOn && { caughtErrors: 'none' }),
    destructuredArrayIgnorePattern: '^_',
    ignoreRestSiblings: true,
  }
}

export const JAVASCRIPT_ONLY_CODE_BLOCK_RULES: TypedRules = {
  'no-unused-expressions': 'off',
  'no-unused-vars': 'off',
}

/**
 * For a JavaScript-only project's TypeScript code blocks and dot-folder files. A copy, since
 * importing the config loads typescript-eslint; a test checks it against the installed one
 */
export const ESLINT_RECOMMENDED_TYPESCRIPT_RULES: TypedRules = {
  'constructor-super': 'off',
  'getter-return': 'off',
  'no-class-assign': 'off',
  'no-const-assign': 'off',
  'no-dupe-args': 'off',
  'no-dupe-class-members': 'off',
  'no-dupe-keys': 'off',
  'no-func-assign': 'off',
  'no-import-assign': 'off',
  'no-new-native-nonconstructor': 'off',
  'no-new-symbol': 'off',
  'no-obj-calls': 'off',
  'no-redeclare': 'off',
  'no-setter-return': 'off',
  'no-this-before-super': 'off',
  'no-undef': 'off',
  'no-unreachable': 'off',
  'no-unsafe-negation': 'off',
  'no-var': 'error',
  'no-with': 'off',
  'prefer-const': 'error',
  'prefer-rest-params': 'error',
  'prefer-spread': 'error',
}

/**
 * typescript-eslint's parser, loaded on first parse, and espree from ESLint's own dependencies
 */
const loaded: {
  typescriptEslintParser?: typeof TypescriptEslintParser
  espree?: { parse: (code: string, options?: unknown) => unknown }
} = {}

/**
 * Loads typescript-eslint and TypeScript only when it first parses a file
 */
const LAZY_TYPESCRIPT_PARSER: {
  meta: { name: string; version: string }
  parseForESLint: typeof TypescriptEslintParser.parseForESLint
} = {
  meta: { name: `${PACKAGE_META.name}/typescript-parser`, version: PACKAGE_META.version },
  parseForESLint: (code, options) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `require` returns `any`, and this is the parser module
    loaded.typescriptEslintParser ??= createRequire(import.meta.url)(
      '@typescript-eslint/parser',
    ) as typeof TypescriptEslintParser
    return loaded.typescriptEslintParser.parseForESLint(code, options)
  },
}

/**
 * Without loading it, for import-x, which parses TypeScript files such as a `.d.ts` with it
 */
export function resolveTypescriptParserPath(): string {
  return createRequire(import.meta.url).resolve('@typescript-eslint/parser')
}

/**
 * Falls back to typescript-eslint's parser for what espree rejects, such as decorators or ESM in a
 * CommonJS file. espree's error stays when neither parses the file
 */
export const JAVASCRIPT_PARSER: {
  meta: { name: string; version: string }
  parseForESLint: (code: string, options?: Record<string, unknown> | null) => { ast: unknown }
} = {
  meta: { name: `${PACKAGE_META.name}/javascript-parser`, version: PACKAGE_META.version },
  parseForESLint: (code, options) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `require` returns `any`, and this is espree
    loaded.espree ??= createRequire(createRequire(import.meta.url).resolve('eslint'))(
      'espree',
    ) as NonNullable<typeof loaded.espree>
    try {
      return { ast: loaded.espree.parse(code, options) }
    } catch (error) {
      try {
        return LAZY_TYPESCRIPT_PARSER.parseForESLint(code, options ?? undefined)
      } catch {
        throw error
      }
    }
  },
}

/**
 * With the options the presets give their twins, but `no-unused-vars`, which depends on `unicorn`
 */
const CORE_TWIN_RULES: TypedRules = {
  'no-unused-vars': 'error',
  'no-unused-expressions': [
    'error',
    { allowShortCircuit: false, allowTaggedTemplates: false, allowTernary: false },
  ],
  'no-array-constructor': 'error',
  'no-useless-constructor': 'error',
  'no-empty-function': ['error', { allow: [] }],
  'default-param-last': 'error',
}

export function javascriptOnlyTypescript({
  untyped,
  isUnicornOn = false,
}: {
  untyped: Scope
  isUnicornOn?: boolean | undefined
}): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/typescript/typescript-eslint/base',
      files: [...TYPED_CODE_FILES],
      languageOptions: { parser: LAZY_TYPESCRIPT_PARSER, sourceType: 'module' },
      // typescript-eslint's configs turn these off, since they misread TypeScript syntax
      rules: Object.fromEntries(Object.keys(CORE_TWIN_RULES).map((rule) => [rule, 'off'])),
    },
    {
      name: 'gpahal/typescript/typescript-eslint/eslint-recommended',
      files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
      rules: clonePlain(ESLINT_RECOMMENDED_TYPESCRIPT_RULES),
    },
    ...untypedCoreConfigs(untyped),
    {
      name: 'gpahal/typescript/rules',
      files: [...UNTYPED_CODE_FILES],
      rules: {
        ...clonePlain(CORE_TWIN_RULES),
        'no-unused-vars': ['error', unusedVarsOptions(isUnicornOn)],
        'no-unreachable': 'error',
      },
    },
  ]
}

function isDropped([rule, entry]: [string, unknown]): boolean {
  return rule.startsWith('@typescript-eslint/') && isRuleOn(entry)
}

/**
 * None registers the plugin. Entries that turn one off stay, which ESLint takes without it
 */
export function withoutTypescriptEslintRules(configs: Array<TypedConfig>): Array<TypedConfig> {
  return configs.map((config) => {
    const entries = Object.entries(config.rules ?? {})
    return entries.some(isDropped)
      ? { ...config, rules: Object.fromEntries(entries.filter((pair) => !isDropped(pair))) }
      : config
  })
}

export function javascriptOnlyExemptions({
  testFiles,
}: {
  testFiles: FileSpecs
}): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/typescript/test-code',
      files: testFiles,
      rules: {
        // `new Promise((resolve) => server.close(resolve))` and `mockImplementation(() => {})`
        'no-promise-executor-return': 'off',
        'no-empty-function': 'off',
      },
    },
  ]
}
