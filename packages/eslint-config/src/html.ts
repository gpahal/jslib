import * as eslintParserHtml from '@html-eslint/parser'
import { defineConfig } from 'eslint/config'

const FILES = ['**/*.html']

const htmlConfig = defineConfig({
  files: FILES,
  languageOptions: {
    parser: eslintParserHtml,
  },
})

export default htmlConfig
