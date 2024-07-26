/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eslintPluginTailwindcss from 'eslint-plugin-tailwindcss'
import { config } from 'typescript-eslint'

import type { Config } from './base'

export default config(
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
  ...eslintPluginTailwindcss.configs['flat/recommended'],
  {
    rules: {
      'tailwindcss/enforces-negative-arbitrary-values': 'error',
      'tailwindcss/enforces-shorthand': 'error',
      'tailwindcss/no-contradicting-classname': 'error',
    },
  },
) as Config
