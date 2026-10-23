import { buildConfig } from '@/internal/define'
import type { StylelintConfig } from '@/internal/rules'

export { defineConfig } from '@/internal/define'
export type { StylelintConfigOptions } from '@/internal/options'
export { replace } from '@/internal/rules'
export type {
  Replaced,
  StylelintConfig,
  StylelintExtendedConfig,
  StylelintExtends,
  StylelintOverride,
  StylelintRules,
} from '@/internal/rules'

/**
 * The config with the default options, for `extends: ['@gpahal/stylelint-config']`. Under
 * `extends`, a rule you set replaces the preset's whole setting, its `disableFix` and `ignore*`
 * lists included, so prefer `defineConfig`. Importing this module builds the static preset
 */
const config: StylelintConfig = buildConfig({ root: import.meta.dirname })

export default config
