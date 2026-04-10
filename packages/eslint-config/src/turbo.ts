import type { Linter } from 'eslint'
import eslintPluginTurbo from 'eslint-plugin-turbo'
import { defineConfig } from 'eslint/config'

const recommended = eslintPluginTurbo.configs!.recommended as Linter.Config

const turboConfig = defineConfig([
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx,astro}'],
    plugins: {
      turbo: eslintPluginTurbo,
    },
    settings: recommended.settings,
    rules: recommended.rules,
  },
  {
    files: ['**/*.md', '**/*.md/**'],
    rules: {
      'turbo/no-undeclared-env-vars': 'off',
    },
  },
])

export default turboConfig
