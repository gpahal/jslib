import { configs as eslintPluginNodeConfigs } from 'eslint-plugin-n'
import { config } from 'typescript-eslint'

import type { Config } from './base'

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
export default config({
  files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
  extends: [eslintPluginNodeConfigs['flat/recommended']],
}) as Config
