import type { defineConfig } from 'eslint/config'

export { parser as tsEslintParser, configs as tsEslintConfigs } from 'typescript-eslint'

export type Config = ReturnType<typeof defineConfig>[number]

export type ConfigWithExtends = Parameters<typeof defineConfig>[number]

export type ConfigFn = (project: string | Array<string>) => ConfigWithExtends
