import type { FileSpecs, Scope } from '@/internal/globs'
import { named, withSetup } from '@/internal/naming'
import { importPeers, interopDefault } from '@/internal/peers'
import type { TypedConfig } from '@/internal/types'

export const VITEST_PEERS: Array<string> = ['@vitest/eslint-plugin']

export async function vitest({
  files,
  typeAware,
}: {
  files: FileSpecs
  /**
   * For the `typecheck` setting; `undefined` without type information
   */
  typeAware: Required<Scope> | undefined
}): Promise<Array<TypedConfig>> {
  const eslintPluginVitest = await importPeers('vitest', VITEST_PEERS, async () =>
    interopDefault(import('@vitest/eslint-plugin')),
  )
  return withSetup('vitest', [
    ...named('vitest', { files }, [eslintPluginVitest.configs.recommended]),
    {
      name: 'gpahal/vitest/rules',
      files,
      languageOptions: {
        globals: eslintPluginVitest.environments.env.globals,
      },
      rules: {
        // A second argument is a message that names the failing case: `expect(value, 'why')`
        'vitest/valid-expect': ['error', { maxArgs: 2 }],
        // `expect` and `assert`, their members such as `assert.equal`, and helpers named `expect…`
        // or `assert…`, such as `expectTypeOf` and `assertType`. A `*` also matches nothing
        'vitest/expect-expect': ['error', { assertFunctionNames: ['expect*', 'assert*'] }],
        // `test` at the top level, and `it` inside `describe`
        'vitest/consistent-test-it': ['error', { fn: 'test', withinDescribe: 'it' }],
        'vitest/prefer-to-be': 'error',
        // A warning, not an error: `test.skip` is often deliberate
        'vitest/no-disabled-tests': 'warn',
        // A test that runs only sometimes reports nothing when it doesn't: use `test.skipIf`
        'vitest/no-conditional-tests': 'error',
        'vitest/prefer-hooks-on-top': 'error',
        'vitest/no-duplicate-hooks': 'error',
        'vitest/require-to-throw-message': 'error',
        // Removing `.only` would hide that a suite was focused, or one in use, so it only reports
        'vitest/no-focused-tests': ['error', { fixable: false }],
        // `vi.mock` inside a test or function is hoisted to the top of the file
        'vitest/hoisted-apis-on-top': 'error',
        'vitest/max-nested-describe': 'error',
      },
    },
    // Rules use type information with this setting, and crash where there is none, such as in
    // JavaScript files without `typeAware.javascript`, as `vitest/unbound-method` does
    ...(typeAware
      ? [
          {
            name: 'gpahal/vitest/typecheck',
            files,
            ignores: typeAware.ignores,
            settings: {
              vitest: {
                typecheck: true,
              },
            },
            rules: {
              // `@typescript-eslint/unbound-method`, which is off in test files, but allows
              // `expect(object.method)`. Added in 1.6.13, the peer range's floor
              'vitest/unbound-method': 'error',
            },
          } satisfies TypedConfig,
        ]
      : []),
  ])
}
