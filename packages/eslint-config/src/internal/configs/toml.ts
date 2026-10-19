import eslintPluginToml from 'eslint-plugin-toml'

import { TOML_FILES } from '@/internal/files'
import { named, nameUpstreamConfigs } from '@/internal/naming'
import type { TypedConfig } from '@/internal/types'

/**
 * eslint-plugin-toml's recommended rules, and its layout rules from its `standard` config, since
 * Prettier doesn't format TOML. Their fixes change only whitespace, commas and key quotes, which
 * leave the data the same
 */
export function toml(): Array<TypedConfig> {
  return [
    ...named('toml', { files: TOML_FILES }, [
      nameUpstreamConfigs('recommended', eslintPluginToml.configs['flat/recommended']),
    ]),
    {
      name: 'gpahal/toml/rules',
      files: TOML_FILES,
      rules: {
        'toml/array-bracket-newline': 'error',
        // `["a", "b"]`, as in Cargo's and Python's docs
        'toml/array-bracket-spacing': ['error', 'never'],
        // One line, or one element per line
        'toml/array-element-newline': ['error', 'consistent'],
        'toml/comma-style': 'error',
        'toml/indent': 'error',
        'toml/inline-table-curly-spacing': 'error',
        'toml/key-spacing': 'error',
        'toml/no-space-dots': 'error',
        'toml/padding-line-between-tables': 'error',
        'toml/quoted-keys': 'error',
        // `#:schema`, the directive of the Taplo and Tombi language servers, which names the file's
        // JSON schema
        'toml/spaced-comment': ['error', 'always', { markers: [':schema'] }],
        'toml/table-bracket-spacing': 'error',
      },
    },
  ]
}
