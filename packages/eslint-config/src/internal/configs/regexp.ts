import { configs as eslintPluginRegexpConfigs } from 'eslint-plugin-regexp'

import { named } from '@/internal/naming'
import type { TypedConfig } from '@/internal/types'

export function regexp({ files }: { files: Array<string> }): Array<TypedConfig> {
  return [
    ...named('regexp', { files }, [
      { ...eslintPluginRegexpConfigs['flat/recommended'], name: 'recommended' },
    ]),
    {
      name: 'gpahal/regexp/rules',
      files,
      rules: {
        // A regex that is quadratic in its input's length when it moves along a string that
        // doesn't match, as `/a+b/` does on a long run of `a`s
        'regexp/no-super-linear-move': 'error',
      },
    },
  ]
}
