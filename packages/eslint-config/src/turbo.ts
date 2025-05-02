/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eslintPluginTurbo from 'eslint-plugin-turbo'
import { config, type ConfigWithExtends } from 'typescript-eslint'

import type { Config } from './base'

export default config({
  files: ['**/*.{js,mjs,cjs,jsx,ts,tsx,astro}'],
  plugins: {
    turbo: eslintPluginTurbo,
  },
  settings: eslintPluginTurbo.configs.recommended.settings,
  rules: eslintPluginTurbo.configs.recommended.rules,
} as ConfigWithExtends) as Config
