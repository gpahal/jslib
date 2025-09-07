import eslintPluginNext from '@next/eslint-plugin-next'
import { defineConfig } from 'eslint/config'

import { type ConfigWithExtends } from './common'
import reactConfig, { FILES } from './react'

const nextjsConfig = defineConfig(reactConfig, {
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
