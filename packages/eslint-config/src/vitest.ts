/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

import eslintPluginVitest from 'eslint-plugin-vitest'
import { config } from 'typescript-eslint'

import type { Config } from './base'

export default config({
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
}) as Config
