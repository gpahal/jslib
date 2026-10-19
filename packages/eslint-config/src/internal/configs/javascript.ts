import eslint from '@eslint/js'
import globals from 'globals'

import { JAVASCRIPT_PARSER } from '@/internal/configs/typescript-core'
import { named } from '@/internal/naming'
import type { TypedConfig, TypedRules } from '@/internal/types'

/**
 * Code blocks are excerpts that use what they don't define and define what they don't use
 */
export const JAVASCRIPT_CODE_BLOCK_RULES: TypedRules = {
  // Examples print what they show
  'no-console': 'off',
  'no-undef': 'off',
  // An object-literal excerpt, as `resolve: { alias: [] }`, parses as a labelled block, and the
  // fix of `no-unused-labels` deletes its key
  'no-labels': 'off',
  'no-lone-blocks': 'off',
  'no-unused-labels': 'off',
  // The Markdown file's own lint reads the text of its code blocks
  '@gpahal/no-bidi-characters': 'off',
}

export const JAVASCRIPT_ASTRO_SCRIPT_RULES: TypedRules = {
  '@gpahal/no-bidi-characters': 'off',
}

/**
 * typescript-eslint's default
 */
export const DEFAULT_PROJECT_FILE_MATCH_COUNT = 8

/**
 * Node's globals leave out the CommonJS ones, which ESM lacks. `defaultProjectFileCount` may raise
 * the default project's limit. With `javascriptOnly`, `JAVASCRIPT_PARSER` parses the JavaScript
 * files, with JSX on, as typescript-eslint's parser has it
 */
export function javascriptLanguageOptions({
  files,
  root,
  typeAware = true,
  allowDefaultProject,
  defaultProjectFileCount = 0,
  javascriptOnly = false,
}: {
  files: Array<string>
  root: string
  typeAware?: boolean | undefined
  allowDefaultProject?: Array<string> | undefined
  defaultProjectFileCount?: number | undefined
  javascriptOnly?: boolean | undefined
}): TypedConfig {
  // The project service keeps matched files across config reloads, so leave room for new files until
  // the editor restarts its server. typescript-eslint keeps the first limit for the process, so
  // steps of 16 keep it stable as config files are added
  const maxFileCount =
    Math.ceil((Math.max(defaultProjectFileCount, DEFAULT_PROJECT_FILE_MATCH_COUNT) + 8) / 16) * 16
  return {
    name: 'gpahal/javascript/language-options',
    files,
    languageOptions: {
      ...(javascriptOnly && { parser: JAVASCRIPT_PARSER }),
      globals: { ...globals.builtin, ...globals.nodeBuiltin },
      parserOptions: {
        tsconfigRootDir: root,
        ...(javascriptOnly && { ecmaFeatures: { jsx: true } }),
        ...(typeAware && {
          projectService: allowDefaultProject === undefined || {
            allowDefaultProject,
            maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: maxFileCount,
          },
        }),
      },
    },
  }
}

export function javascript({ files }: { files: Array<string> }): Array<TypedConfig> {
  return [
    ...named('javascript', { files }, [eslint.configs.recommended]),
    {
      name: 'gpahal/javascript/rules',
      files,
      rules: {
        'accessor-pairs': ['error', { enforceForClassMembers: true, setWithoutGet: true }],
        'array-callback-return': 'error',
        'default-case-last': 'error',
        'default-param-last': 'error',
        // `== null` matches `null` and `undefined`
        eqeqeq: ['error', 'smart'],
        'grouped-accessor-pairs': 'error',
        'guard-for-in': 'error',
        'new-cap': ['error', { capIsNew: false, newIsCap: true, properties: true }],
        // These block the page, and are often debugging left behind
        'no-alert': 'error',
        'no-caller': 'error',
        'no-cond-assign': ['error', 'always'],
        'no-console': ['error', { allow: ['warn', 'error'] }],
        'no-constructor-return': 'error',
        'no-eval': 'error',
        'no-extend-native': 'error',
        'no-extra-bind': 'error',
        'no-labels': ['error', { allowLoop: false, allowSwitch: false }],
        'no-lone-blocks': 'error',
        // `@typescript-eslint/no-loop-func` is deprecated, since the core rule reads TypeScript
        'no-loop-func': 'error',
        'no-multi-str': 'error',
        'no-new': 'error',
        'no-new-func': 'error',
        'no-new-wrappers': 'error',
        'no-object-constructor': 'error',
        'no-octal-escape': 'error',
        'no-promise-executor-return': 'error',
        'no-proto': 'error',
        'no-restricted-properties': [
          'error',
          {
            property: '__defineGetter__',
            message: 'Use `Object.defineProperty` instead.',
          },
          {
            property: '__defineSetter__',
            message: 'Use `Object.defineProperty` instead.',
          },
          {
            property: '__lookupGetter__',
            message: 'Use `Object.getOwnPropertyDescriptor` instead.',
          },
          {
            property: '__lookupSetter__',
            message: 'Use `Object.getOwnPropertyDescriptor` instead.',
          },
        ],
        'no-return-assign': ['error', 'always'],
        'no-script-url': 'error',
        'no-self-compare': 'error',
        'no-sequences': 'error',
        'no-template-curly-in-string': 'error',
        'no-undef-init': 'error',
        'no-unneeded-ternary': 'error',
        'no-unmodified-loop-condition': 'error',
        'no-unreachable-loop': 'error',
        'no-useless-call': 'error',
        'no-useless-computed-key': 'error',
        'no-useless-rename': 'error',
        'no-useless-return': 'error',
        'no-var': 'error',
        // A method can't be a constructor: `{ Widget: function () {} }` with `new o.Widget()`
        'object-shorthand': ['error', 'always', { avoidQuotes: true, ignoreConstructors: true }],
        'prefer-const': 'error',
        'prefer-exponentiation-operator': 'error',
        'prefer-object-spread': 'error',
        // `eslint-recommended` turns it on only in TypeScript files
        'prefer-rest-params': 'error',
        'prefer-spread': 'error',
        'prefer-template': 'error',
        radix: 'error',
        'symbol-description': 'error',
        'use-isnan': ['error', { enforceForIndexOf: true }],
        yoda: ['error', 'never'],
      },
    },
  ]
}

/**
 * Trojan Source hides in config files and docs too
 */
export function bidiCharacters({ files }: { files: Array<string> }): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/javascript/bidi-characters',
      files,
      // A config with `files` makes ESLint lint them, and the `json` area leaves this one unlinted
      ignores: ['**/package-lock.json'],
      rules: {
        '@gpahal/no-bidi-characters': 'error',
      },
    },
  ]
}

export function linterOptions(): TypedConfig {
  return {
    name: 'gpahal/linter-options',
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
  }
}
