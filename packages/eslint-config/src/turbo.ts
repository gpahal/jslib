import eslintPluginTurbo from 'eslint-plugin-turbo'
import { defineConfig } from 'eslint/config'

const turboConfig = defineConfig([
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx,astro}'],
    plugins: {
      turbo: eslintPluginTurbo,
    },
    settings: eslintPluginTurbo.configs.recommended.settings,
    rules: eslintPluginTurbo.configs.recommended.rules,
  },
  {
    files: ['**/*.md', '**/*.md/**'],
    rules: {
      'turbo/no-undeclared-env-vars': 'off',
    },
  },
])

export default turboConfig
