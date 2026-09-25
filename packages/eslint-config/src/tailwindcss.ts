import eslintPluginBetterTailwindcss from 'eslint-plugin-better-tailwindcss'
import { defineConfig } from 'eslint/config'

import { omitUndefinedValues } from '@gpahal/std/objects'

import type { Config } from './common'

const FILES = ['**/*.{js,mjs,cjs,jsx,ts,tsx}']
const ASTRO_FILES = ['*.astro', '**/*.astro']
const HTML_FILES = ['**/*.html']
const CSS_FILES = ['**/*.css']

export type TailwindcssConfigOptions = {
  /**
  Path to the css entry file, eg. `src/styles/index.css`
  */
  entryPoint?: string
  /**
  Path to the `tsconfig.json` file, used to resolve path aliases
  */
  tsconfig?: string
  /**
  Working directory used to resolve tailwindcss and its config files. Useful in monorepos
  */
  cwd?: string
  /**
  Detect tailwind v4 custom component classes to avoid false `no-unknown-classes` reports
  */
  detectComponentClasses?: boolean
}

export default function tailwindcssConfig(options: TailwindcssConfigOptions = {}): Array<Config> {
  return defineConfig(
    {
      files: [...FILES, ...ASTRO_FILES, ...HTML_FILES, ...CSS_FILES],
      extends: [eslintPluginBetterTailwindcss.configs.recommended],
      settings: {
        'better-tailwindcss': omitUndefinedValues(options),
      },
      rules: {
        // Handled by prettier via `prettier-plugin-tailwindcss`
        'better-tailwindcss/enforce-consistent-class-order': 'off',
        'better-tailwindcss/enforce-consistent-line-wrapping': 'off',
      },
    },
    {
      files: ASTRO_FILES,
      rules: {
        // prettier-plugin-tailwindcss can't sort classes in .astro files: it doesn't support the AST of
        // prettier-plugin-astro 1.x
        'better-tailwindcss/enforce-consistent-class-order': 'warn',
      },
    },
  )
}
