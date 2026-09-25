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
  rules: {
    ...eslintPluginVitest.configs.recommended.rules,
    // A second argument is a message that names the failing case: `expect(value, 'why')`
    'vitest/valid-expect': ['error', { maxArgs: 2 }],
    // Helpers named `expect…` assert too
    'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expect*'] }],
  },
})

export default vitestConfig
