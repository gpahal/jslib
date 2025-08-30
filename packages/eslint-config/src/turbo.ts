import eslintPluginTurbo from 'eslint-plugin-turbo'

import { config, type ConfigArray, type ConfigWithExtends } from './common'

const turboConfig: ConfigArray = config({
  files: ['**/*.{js,mjs,cjs,jsx,ts,tsx,astro}'],
  plugins: {
    turbo: eslintPluginTurbo,
  },
  settings: eslintPluginTurbo.configs.recommended.settings,
  rules: eslintPluginTurbo.configs.recommended.rules,
} as ConfigWithExtends)

export default turboConfig
