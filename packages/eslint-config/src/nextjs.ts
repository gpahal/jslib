import eslintPluginNext from '@next/eslint-plugin-next'
import { defineConfig } from 'eslint/config'

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
})

export default nextjsConfig
