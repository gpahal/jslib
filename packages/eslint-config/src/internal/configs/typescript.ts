import { configs as tsEslintConfigs } from 'typescript-eslint'

import { untypedCoreConfigs, unusedVarsOptions } from '@/internal/configs/typescript-core'
import { CODE_BLOCK_FILES, CONFIG_FILES, SCRIPT_FILES } from '@/internal/files'
import { intersectFileSpecs } from '@/internal/globs'
import type { FileSpecs, Scope } from '@/internal/globs'
import { named } from '@/internal/naming'
import type { TypedConfig, TypedRules } from '@/internal/types'

/**
 * Code blocks are excerpts that define what they don't use and show values, as `value.length > 0`
 */
export const TYPESCRIPT_CODE_BLOCK_RULES: TypedRules = {
  '@typescript-eslint/no-unused-expressions': 'off',
  '@typescript-eslint/no-unused-vars': 'off',
}

/**
 * `node:test`'s tests, suites and hooks, which its runner awaits, and React Router's `navigate()`,
 * which returns `void | Promise<void>`, so it has no `.catch()`, and its errors go to the router
 */
function knownSafeCalls(): Array<{
  from: 'package'
  package: string
  name: string | [string, ...Array<string>]
}> {
  return [
    {
      from: 'package',
      package: 'node:test',
      name: ['test', 'it', 'describe', 'suite', 'before', 'after', 'beforeEach', 'afterEach'],
    },
    { from: 'package', package: 'react-router', name: 'NavigateFunction' },
    { from: 'package', package: 'react-router-dom', name: 'NavigateFunction' },
  ]
}

export function typescriptExemptions({ testFiles }: { testFiles: FileSpecs }): Array<TypedConfig> {
  return [
    // Tests assert what they know about their fixtures, where a failed assertion fails the test
    {
      name: 'gpahal/typescript/test-code',
      files: testFiles,
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unsafe-type-assertion': 'off',
        // `expect(object.method).toHaveBeenCalled()` passes a method without its `this`
        '@typescript-eslint/unbound-method': 'off',
        // `new Promise((resolve) => server.close(resolve))` and `mockImplementation(() => {})`
        'no-promise-executor-return': 'off',
        'no-empty-function': 'off',
        '@typescript-eslint/no-empty-function': 'off',
      },
    },
  ]
}

export type TypescriptAreaOptions = {
  files: Array<string>
  untyped: Scope
  typedFiles: Array<string>
  /**
   * `undefined` without type information
   */
  typeAware: Required<Scope> | undefined
  nonTestFiles: FileSpecs
  testFiles: FileSpecs
  library?: boolean | undefined
  exhaustiveSwitch?: 'default' | 'strict' | undefined
  strictBooleanExpressions?: boolean | undefined
  /**
   * `unicorn/prefer-optional-catch-binding` then reports unused catch bindings
   */
  isUnicornOn?: boolean | undefined
}

/**
 * typescript-eslint's configs enable its rules on JavaScript files too, parsed as TypeScript
 */
export function typescript({
  files,
  untyped,
  typedFiles,
  typeAware,
  nonTestFiles,
  testFiles,
  library = false,
  exhaustiveSwitch = 'strict',
  strictBooleanExpressions = true,
  isUnicornOn = false,
}: TypescriptAreaOptions): Array<TypedConfig> {
  return [
    ...named('typescript', { files }, [
      tsEslintConfigs.strictTypeChecked,
      tsEslintConfigs.stylisticTypeChecked,
    ]),
    ...untypedCoreConfigs(untyped),
    {
      name: 'gpahal/typescript/rules',
      files,
      rules: {
        '@typescript-eslint/no-unused-vars': ['error', unusedVarsOptions(isUnicornOn)],
        // Reads an optional parameter, unlike the core rule
        '@typescript-eslint/default-param-last': 'error',
        // A guard or a narrowing check states what a non-null assertion only claims
        '@typescript-eslint/no-non-null-assertion': 'error',
        // `eslint-recommended` leaves it to `allowUnreachableCode: false`, which framework templates'
        // tsconfigs don't set
        'no-unreachable': 'error',
      },
    },
    // JavaScript files have no type syntax to check, and the fixes of `prefer-readonly` and
    // `consistent-type-exports` write type syntax
    {
      name: 'gpahal/typescript/rules-ts',
      files: typedFiles,
      rules: {
        '@typescript-eslint/array-type': ['error', { default: 'generic' }],
        // Report-only, as `REPORT_ONLY_RULES` records. `patchTypeDefinitions` drops the report where
        // only an interface can augment
        '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
        // A separate `import type { A } from 'a'`, which drops with its specifiers when they go
        // unused and never loads the module
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
        ],
        // `import { type A } from 'a'` compiles to `import 'a'` under `verbatimModuleSyntax` and in
        // bundlers such as esbuild. `import-x/consistent-type-specifier-style` replaces it where the
        // imports area is on
        '@typescript-eslint/no-import-type-side-effects': 'error',
        // `method(): void` is bivariant in its parameters, `method: () => void` isn't
        '@typescript-eslint/method-signature-style': ['error', 'property'],
        '@typescript-eslint/prefer-readonly': 'error',
        // A separate `export type { A }`, like the imports
        '@typescript-eslint/consistent-type-exports': [
          'error',
          { fixMixedExportsWithInlineTypeSpecifier: false },
        ],
        '@typescript-eslint/no-unsafe-type-assertion': 'error',
        // `export { type A } from 'a'` compiles to the side-effect re-export `export {} from 'a'`
        '@gpahal/no-inline-type-only-export': 'error',
        // The typescript-eslint rule also sees unused `private` members
        'no-unused-private-class-members': 'off',
        '@typescript-eslint/no-unused-private-class-members': 'error',
      },
    },
    ...(typeAware
      ? [
          // For the JavaScript files with type information too
          {
            name: 'gpahal/typescript/type-aware',
            ...typeAware,
            rules: {
              '@typescript-eslint/promise-function-async': 'error',
              // `promise-function-async` makes functions async that have nothing to await
              '@typescript-eslint/require-await': 'off',
              // `||` also replaces `''` and `0`, which is often the point for strings and numbers
              '@typescript-eslint/prefer-nullish-coalescing': [
                'error',
                { ignorePrimitives: { string: true, number: true } },
              ],
              // `undefined`, `null` and objects usually don't print as expected
              '@typescript-eslint/restrict-template-expressions': [
                'error',
                {
                  allowAny: false,
                  allowArray: false,
                  allowBoolean: true,
                  allowNever: false,
                  allowNullish: false,
                  allowNumber: true,
                  allowRegExp: true,
                },
              ],
              '@typescript-eslint/no-confusing-void-expression': [
                'error',
                { ignoreArrowShorthand: true },
              ],
              '@typescript-eslint/switch-exhaustiveness-check': [
                'error',
                exhaustiveSwitch === 'strict'
                  ? { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true }
                  : { considerDefaultExhaustiveForUnions: true },
              ],
              // A promise returned inside `try` without `await` rejects outside it
              '@typescript-eslint/return-await': ['error', 'in-try-catch'],
              // `strict-boolean-expressions` and `no-unnecessary-condition` report `if (promise)`
              '@typescript-eslint/no-misused-promises': ['error', { checksConditionals: false }],
              // `void promise` drops its rejection, which kills a Node process
              '@typescript-eslint/no-floating-promises': [
                'error',
                {
                  ignoreVoid: false,
                  checkThenables: true,
                  allowForKnownSafeCalls: knownSafeCalls(),
                },
              ],
              // A type predicate that the argument's type already settles is a dead check too
              '@typescript-eslint/no-unnecessary-condition': [
                'error',
                { checkTypePredicates: true },
              ],
              // A method taken off its object, as in `callback(this.handle)`, loses its `this`
              '@typescript-eslint/unbound-method': 'error',
              // It asks for `re.exec(s)` where `unicorn/prefer-regexp-test` and
              // `e18e/prefer-regex-test` ask for `re.test(s)` in a condition, and `s.match(re)` reads
              // as well elsewhere
              '@typescript-eslint/prefer-regexp-exec': 'off',
            },
          } satisfies TypedConfig,
          // Before the areas' `rules`, so `rulesTypeAware` options apply in tests too
          {
            name: 'gpahal/typescript/type-aware-tests',
            files: intersectFileSpecs(typeAware.files, testFiles),
            ignores: typeAware.ignores,
            rules: {
              // An assertion of what the types already say is the point of a test
              '@typescript-eslint/no-unnecessary-condition': [
                'error',
                { checkTypePredicates: false },
              ],
            },
          } satisfies TypedConfig,
        ]
      : []),
    ...(typeAware && strictBooleanExpressions
      ? [
          {
            name: 'gpahal/typescript/strict-boolean-expressions',
            ...typeAware,
            rules: {
              // `if (count)` takes `0` for a missing value, and a nullable string's `''` and missing
              // value are both false. A missing optional boolean is false
              '@typescript-eslint/strict-boolean-expressions': [
                'error',
                { allowNumber: false, allowNullableBoolean: true },
              ],
            },
          } satisfies TypedConfig,
        ]
      : []),
    ...(library
      ? [
          {
            name: 'gpahal/typescript/library',
            files: nonTestFiles,
            ignores: [...CONFIG_FILES, ...SCRIPT_FILES, ...CODE_BLOCK_FILES],
            rules: {
              '@typescript-eslint/explicit-module-boundary-types': 'error',
              // `isolatedDeclarations` needs types it can't infer, such as an exported regex's
              '@typescript-eslint/no-inferrable-types': 'off',
            },
          } satisfies TypedConfig,
        ]
      : []),
  ]
}
