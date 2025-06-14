import eslintPluginVitest from '@vitest/eslint-plugin'

import { config, type ConfigArray } from './common'

const vitestConfig: ConfigArray = config({
  files: ['**/*.test.{js,mjs,cjs,ts,jsx,tsx}'],
  languageOptions: {
    globals: {
      ...eslintPluginVitest.environments.env.globals,
    },
  },
  plugins: {
    vitest: eslintPluginVitest,
  },
  settings: {
    vitest: {
      typecheck: true,
    },
  },
  rules: eslintPluginVitest.configs.recommended.rules,
})

export default vitestConfig
