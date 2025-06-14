import eslintPluginAstro from 'eslint-plugin-astro'

import { config, tsEslintParser, type ConfigArray, type ConfigWithExtends } from './common'

const FILES = ['**/*.astro']

export default function astroConfig(tsconfigRootDir: string, tsconfigPaths: string | Array<string>): ConfigArray {
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
      languageOptions: {
        sourceType: 'module',
        parserOptions: {
          sourceType: 'module',
          ecmaVersion: 'latest',
          parser: tsEslintParser,
          extraFileExtensions: ['.astro'],
          tsconfigRootDir,
          project: tsconfigPaths,
        },
      },
      processor: 'astro/client-side-ts',
      rules: {
        'react/jsx-key': 'off',
        'react/react-in-jsx-scope': 'off',
      },
    } as ConfigWithExtends,
    {
      files: FILES.map((file) => `${file}/*.ts`),
      languageOptions: {
        sourceType: 'module',
        parser: tsEslintParser,
        parserOptions: {
          sourceType: 'module',
          ecmaVersion: 'latest',
          parser: tsEslintParser,
        },
      },
    } as ConfigWithExtends,
  )
}
