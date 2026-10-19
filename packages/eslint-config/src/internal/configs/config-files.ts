import { CONFIG_FILES, SCRIPT_FILES } from '@/internal/files'
import type { TypedConfig } from '@/internal/types'

/**
 * Config files often default-export an anonymous object and are named by their tool
 */
export function configFilesExemptions(): Array<TypedConfig> {
  return [
    {
      name: 'gpahal/config-files/rules',
      files: CONFIG_FILES,
      rules: {
        'import-x/no-anonymous-default-export': 'off',
        'unicorn/no-anonymous-default-export': 'off',
        'unicorn/filename-case': 'off',
      },
    },
    // Scripts, command-line tools and config files run in a terminal, where printing is the output
    {
      name: 'gpahal/config-files/console',
      files: [...SCRIPT_FILES, ...CONFIG_FILES],
      rules: {
        'no-console': 'off',
      },
    },
  ]
}
