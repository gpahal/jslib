import eslintPluginAstro from 'eslint-plugin-astro'
import { config, parser as tsEslintParser, type ConfigWithExtends } from 'typescript-eslint'

import type { Config } from './base'

export default function astroConfig(project: string | Array<string>, tsconfigRootDir: string): Config {
  return config(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    ...eslintPluginAstro.configs.recommended,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    ...eslintPluginAstro.configs['jsx-a11y-recommended'],
    {
      files: ['*.astro'],
      languageOptions: {
        parserOptions: {
          parser: tsEslintParser,
          extraFileExtensions: ['.astro'],
          project,
          tsconfigRootDir,
        },
      },
      rules: {
        'react/jsx-key': 'off',
        'react/react-in-jsx-scope': 'off',
      },
    } as ConfigWithExtends,
  )
}
