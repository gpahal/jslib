import eslintPluginNode from 'eslint-plugin-n'
import { defineConfig } from 'eslint/config'

const nodeConfig = defineConfig({
  files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
  extends: [eslintPluginNode.configs['flat/recommended']],
})

export default nodeConfig
