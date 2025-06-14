import { configs as eslintPluginNodeConfigs } from 'eslint-plugin-n'

import { config, type ConfigArray } from './common'

const nodeConfig: ConfigArray = config({
  files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
  extends: [eslintPluginNodeConfigs['flat/recommended']],
})

export default nodeConfig
