import eslintPluginJson from '@eslint/json'
import eslintPluginPackageJson from 'eslint-plugin-package-json/experimental'

import { FIXTURE_IGNORES, PACKAGE_JSON_FILES } from '@/internal/configs/constants'
import type { TypedConfig } from '@/internal/types'

/**
 * eslint-plugin-package-json's recommended rules for `package.json` files. Its `experimental` entry
 * is the one whose rules run on `@eslint/json`'s language, which the `json` and `pnpm` areas parse
 * `package.json` with, so it sets the same plugin object
 */
export function packageJson(): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/package-json/rules',
      files: PACKAGE_JSON_FILES,
      ignores: FIXTURE_IGNORES,
      plugins: { 'package-json': eslintPluginPackageJson, json: eslintPluginJson },
      language: 'json/json',
      rules: {
        ...eslintPluginPackageJson.configs.recommended.rules,
        // prettier-plugin-packagejson sorts keys and collections, as `@gpahal/prettier-config` sets
        // it up. `order-properties` is in no config this uses
        'package-json/sort-collections': 'off',
        // A private package, such as an app or a monorepo's root, isn't published for its
        // description to show, or for other packages to import as CommonJS or ES modules by its
        // `type`
        'package-json/require-description': ['error', { ignorePrivate: true }],
        'package-json/require-type': ['error', { ignorePrivate: true }],
      },
    },
  ]
}
