/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eslintPluginNext from '@next/eslint-plugin-next'
import { config, type ConfigWithExtends } from 'typescript-eslint'

import type { Config } from './base'
import reactConfig from './react'

export default config(...reactConfig, {
  plugins: {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    '@next/next': eslintPluginNext,
  },
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  rules: {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    ...eslintPluginNext.configs.recommended.rules,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    ...eslintPluginNext.configs['core-web-vitals'].rules,
  },
  ignores: ['**/.next'],
} as ConfigWithExtends) as Config
