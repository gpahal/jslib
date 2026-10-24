import { buildConfig } from '@/internal/define'
import type { StylelintConfig } from '@/internal/rules'

/**
 * The config for Tailwind CSS v4, for `extends: ['@gpahal/stylelint-config/tailwindcss']`. Under
 * `extends`, a rule you set replaces the preset's whole setting, its `disableFix` and `ignore*`
 * lists included, so prefer `defineConfig`
 */
const config: StylelintConfig = buildConfig({ root: import.meta.dirname, tailwindcss: true })

export default config
