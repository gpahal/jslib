import css from '@eslint/css'
import { defineConfig } from 'eslint/config'
import { tailwind4 } from 'tailwind-csstree'

const FILES = ['**/*.css']

const cssConfig = defineConfig({
  files: FILES,
  plugins: { css },
  language: 'css/css',
  languageOptions: {
    customSyntax: tailwind4,
    tolerant: true,
  },
})

export default cssConfig
