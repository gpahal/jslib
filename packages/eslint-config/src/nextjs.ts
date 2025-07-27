// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eslintPluginNext from '@next/eslint-plugin-next'

import { config, type ConfigArray, type ConfigWithExtends } from './common'
import reactConfig, { FILES } from './react'

const nextjsConfig: ConfigArray = config(...reactConfig, {
  files: FILES,
  plugins: {
    '@next/next': eslintPluginNext,
  },

  rules: {
    ...eslintPluginNext.configs.recommended.rules,

    ...eslintPluginNext.configs['core-web-vitals'].rules,
  },
} as ConfigWithExtends)

export default nextjsConfig
