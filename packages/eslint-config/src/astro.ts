import eslintPluginAstro from 'eslint-plugin-astro'
import { config, parser as tsEslintParser, type ConfigWithExtends } from 'typescript-eslint'

import type { Config } from './base'

export default function astroConfig(tsconfigRootDir: string, tsconfigPaths: string | Array<string>): Config {
  return config(
    ...eslintPluginAstro.configs['flat/recommended'],
    ...eslintPluginAstro.configs['flat/jsx-a11y-recommended'],
    {
      files: ['**/*.astro'],
      languageOptions: {
        parserOptions: {
          sourceType: 'module',
          ecmaVersion: 'latest',
          parser: tsEslintParser,
          extraFileExtensions: ['.astro'],
          tsconfigRootDir,
          project: tsconfigPaths,
        },
      },
      rules: {
        'react/jsx-key': 'off',
        'react/react-in-jsx-scope': 'off',
      },
    } as ConfigWithExtends,
    {
      files: ['**/*.astro/*.ts'],
      languageOptions: {
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
    } as ConfigWithExtends,
  )
}
