import type { TSESLint } from '@typescript-eslint/utils'
import { config as tsEslintConfig, type InfiniteDepthConfigWithExtends } from 'typescript-eslint'

export { parser as tsEslintParser, configs as tsEslintConfigs } from 'typescript-eslint'

type TsEslintConfig = TSESLint.FlatConfig.Config

export type Config = Omit<TsEslintConfig, 'languageOptions'> & {
  languageOptions?: Omit<TSESLint.FlatConfig.LanguageOptions, 'ecmaVersion' | 'parserOptions'> & {
    ecmaVersion?: number | string
    parserOptions?: Omit<TSESLint.FlatConfig.ParserOptions, 'ecmaVersion'> & {
      ecmaVersion?: number | string
    }
  }
}

export type ConfigWithExtends = Config & {
  extends?: Array<ConfigWithExtends>
}

export type ConfigArray = Array<Config>

export function config(...configs: Array<ConfigWithExtends>): ConfigArray {
  return tsEslintConfig(...(configs as Array<InfiniteDepthConfigWithExtends>))
}

export type ConfigFn = (project: string | Array<string>) => ConfigArray
