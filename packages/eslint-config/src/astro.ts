/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

import eslintPluginAstro from 'eslint-plugin-astro'
import { config, type ConfigWithExtends } from 'typescript-eslint'

import type { Config } from './base'

export default config(
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  ...eslintPluginAstro.configs.recommended,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  ...eslintPluginAstro.configs['jsx-a11y-recommended'],
  {
    files: ['*.astro'],
    rules: {
      'react/jsx-key': 'off',
      'react/react-in-jsx-scope': 'off',
    },
    ignores: ['**/.astro'],
  } as ConfigWithExtends,
) as Config
