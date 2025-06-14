// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eslintPluginNext from '@next/eslint-plugin-next'

import { config, type ConfigArray, type ConfigWithExtends } from './common'
import reactConfig, { FILES } from './react'

const nextjsConfig: ConfigArray = config(...reactConfig, {
  files: FILES,
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
} as ConfigWithExtends)

export default nextjsConfig
