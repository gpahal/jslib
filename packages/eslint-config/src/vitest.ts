import eslintPluginVitest from '@vitest/eslint-plugin'
import type { ESLint } from 'eslint'
import { defineConfig } from 'eslint/config'

const vitestConfig = defineConfig({
  files: ['**/*.test.{js,mjs,cjs,ts,jsx,tsx}'],
  languageOptions: {
    globals: {
      ...eslintPluginVitest.environments.env.globals,
    },
  },
  plugins: {
    vitest: eslintPluginVitest as unknown as ESLint.Plugin,
  },
  settings: {
    vitest: {
      typecheck: true,
    },
  },
  rules: eslintPluginVitest.configs.recommended.rules,
})

export default vitestConfig
