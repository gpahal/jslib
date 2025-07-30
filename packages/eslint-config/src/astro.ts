import eslintPluginAstro from 'eslint-plugin-astro'
import globals from 'globals'

import { config, tsEslintParser, type ConfigArray, type ConfigWithExtends } from './common'

const FILES = ['*.astro', '**/*.astro']

export default function astroConfig(tsconfigRootDir: string): ConfigArray {
  return config(
    ...eslintPluginAstro.configs['flat/recommended'].map((config) => ({
      files: FILES,
      ...config,
    })),
    ...eslintPluginAstro.configs['flat/jsx-a11y-recommended'].map((config) => ({
      files: FILES,
      ...config,
    })),
    {
      files: FILES,
      processor: 'astro/client-side-ts',
      rules: {
        'react/jsx-key': 'off',
        'react/react-in-jsx-scope': 'off',
      },
    } as ConfigWithExtends,
    {
      files: FILES.map((file) => `${file}/*.ts`),
      languageOptions: {
        globals: {
          ...globals.builtin,
          ...globals.es2022,
          ...globals.node,
        },
        sourceType: 'module',
        parser: tsEslintParser,
        parserOptions: {
          sourceType: 'module',
          ecmaVersion: 'latest',
          parser: tsEslintParser,
          tsconfigRootDir,
          projectService: true,
        },
      },
    } as ConfigWithExtends,
  )
}
