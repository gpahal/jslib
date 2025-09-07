import { configs as eslintPluginNodeConfigs } from 'eslint-plugin-n'
import { defineConfig } from 'eslint/config'

const nodeConfig = defineConfig({
  files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
  extends: [eslintPluginNodeConfigs['flat/recommended']],
})

export default nodeConfig
