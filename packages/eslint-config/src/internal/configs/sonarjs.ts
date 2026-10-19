import eslintPluginSonarjs from 'eslint-plugin-sonarjs'

import type { Scope } from '@/internal/globs'
import type { TypedConfig, TypedRules } from '@/internal/types'

/**
 * Examples hold placeholder secrets
 */
export const SONARJS_CODE_BLOCK_RULES: TypedRules = {
  'sonarjs/no-hardcoded-passwords': 'off',
  'sonarjs/no-hardcoded-secrets': 'off',
}

/**
 * `antislop` has the style rules. Not `no-try-promise`, whose cases `@typescript-eslint/return-await`
 * and `no-floating-promises` report
 */
export function sonarjs({
  files,
  typeAware,
}: {
  files: Array<string>
  typeAware: Required<Scope> | undefined
}): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/sonarjs/rules',
      files,
      plugins: { sonarjs: eslintPluginSonarjs },
      rules: {
        // `x =+ 1`, which assigns `+1`, for `x += 1`
        'sonarjs/non-existent-operator': 'error',
        // `assert.equal(a, a)`
        'sonarjs/no-same-argument-assert': 'error',
        'sonarjs/no-hardcoded-secrets': 'error',
        'sonarjs/no-hardcoded-passwords': 'error',
        // `rejectUnauthorized: false`, TLS before 1.2, weak ciphers, modes and hashes
        'sonarjs/unverified-certificate': 'error',
        'sonarjs/weak-ssl': 'error',
        'sonarjs/no-weak-cipher': 'error',
        'sonarjs/encryption-secure-mode': 'error',
        'sonarjs/hashing': 'error',
        // `jwt.sign(p, k, { algorithm: 'none' })` and `jwt.verify` that accepts `none`
        'sonarjs/insecure-jwt-token': 'error',
        // An XML parser that resolves external entities, as libxmljs's `noent: true`
        'sonarjs/xml-parser-xxe': 'error',
        // A cookie set with `httpOnly: false` or `secure: false`, as in cookie-session and express
        'sonarjs/cookie-no-httponly': 'error',
        'sonarjs/insecure-cookie': 'error',
      },
    },
    ...(typeAware
      ? [
          {
            name: 'gpahal/sonarjs/type-aware',
            ...typeAware,
            rules: {
              // `s.trim()` as a statement, which drops the trimmed string
              'sonarjs/no-ignored-return': 'error',
              // `===` between values of types that never match, which is always `false`
              'sonarjs/different-types-comparison': 'error',
              // `'key' in 'text'`, which throws
              'sonarjs/in-operator-type-error': 'error',
              // `assert.equal(1, '1')`, which can't pass
              'sonarjs/no-incompatible-assertion-types': 'error',
              // A template engine's escaping turned off, as Handlebars' `noEscape: true` or a
              // Mustache `escape` that returns its input
              'sonarjs/disabled-auto-escaping': 'error',
            },
          } satisfies TypedConfig,
        ]
      : []),
  ]
}
