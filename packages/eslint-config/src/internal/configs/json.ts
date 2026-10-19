import eslintPluginJson from '@eslint/json'

import { CODE_BLOCK_JSON_FILES } from '@/internal/configs/constants'
import type { TypedConfig } from '@/internal/types'

/**
 * `.json` files that their tools read with comments and trailing commas allowed: TypeScript's, VS
 * Code's settings, and Dev Containers'
 */
const JSONC_JSON_TRAILING_COMMA_FILES = [
  '**/tsconfig.json',
  '**/tsconfig.*.json',
  '**/tsconfig-*.json',
  '**/jsconfig.json',
  '**/jsconfig.*.json',
  '**/jsconfig-*.json',
  '**/.vscode/*.json',
  '**/.devcontainer.json',
  '**/.devcontainer/devcontainer.json',
  '**/.devcontainer/*/devcontainer.json',
]

/**
 * `.json` files that their tools read with comments allowed
 */
const JSONC_FILES = [
  ...JSONC_JSON_TRAILING_COMMA_FILES,
  '**/turbo.json',
  '**/biome.json',
  '**/typedoc.json',
  '**/api-extractor*.json',
  '**/wrangler.json',
  '**/deno.json',
  '**/.oxlintrc.json',
]

export function json(): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/json/json',
      files: ['**/*.json'],
      ignores: ['**/package-lock.json', ...JSONC_FILES, ...CODE_BLOCK_JSON_FILES],
      plugins: { json: eslintPluginJson },
      language: 'json/json',
      rules: eslintPluginJson.configs.recommended.rules,
    },
    {
      name: 'gpahal/json/jsonc',
      files: ['**/*.jsonc', ...JSONC_FILES, ...CODE_BLOCK_JSON_FILES],
      plugins: { json: eslintPluginJson },
      language: 'json/jsonc',
      rules: eslintPluginJson.configs.recommended.rules,
    },
    {
      name: 'gpahal/json/jsonc-trailing-commas',
      // Every `.jsonc` file too, code blocks such as `README.md/0.jsonc` included: VS Code's JSONC
      // accepts trailing commas, and Prettier adds them to a block, which keeps Markdown's
      // `trailingComma`
      files: ['**/*.jsonc', ...JSONC_JSON_TRAILING_COMMA_FILES],
      languageOptions: {
        allowTrailingCommas: true,
      },
    },
    {
      name: 'gpahal/json/json5',
      files: ['**/*.json5'],
      plugins: { json: eslintPluginJson },
      language: 'json/json5',
      rules: eslintPluginJson.configs.recommended.rules,
    },
  ]
}
