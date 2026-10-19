import type { Config } from 'stylelint'

import { buildConfig } from '@/internal/define'

/**
 * The config for Tailwind CSS v4, for `extends: ['@gpahal/stylelint-config/tailwindcss']`. Under
 * `extends`, a rule you set replaces the preset's whole setting, so prefer `defineConfig`. See
 * https://github.com/gpahal/jslib/tree/main/packages/stylelint-config#declaration-empty-line-before
 * for the rule to configure in place of `declaration-empty-line-before`, as in the default config
 */
const config: Config = buildConfig({ root: import.meta.dirname, tailwindcss: true })

export default config
