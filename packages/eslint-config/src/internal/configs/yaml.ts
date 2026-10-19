import eslintPluginYml from 'eslint-plugin-yml'

import { YAML_FILES } from '@/internal/files'
import { named, nameUpstreamConfigs } from '@/internal/naming'
import type { TypedConfig } from '@/internal/types'

/**
 * eslint-plugin-yml's recommended rules without the formatting ones, which Prettier owns
 */
export function yaml(): Array<TypedConfig> {
  return [
    ...named('yaml', { files: YAML_FILES }, [
      nameUpstreamConfigs('recommended', eslintPluginYml.configs['flat/recommended']),
      nameUpstreamConfigs('prettier', eslintPluginYml.configs['flat/prettier']),
    ]),
    {
      name: 'gpahal/yaml/rules',
      files: YAML_FILES,
      rules: {
        // An empty value is `null`, which configs such as GitHub Actions' `workflow_dispatch:` use
        'yml/no-empty-mapping-value': 'off',
      },
    },
  ]
}
