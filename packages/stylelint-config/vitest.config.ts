import { withSharedModules, type VitestConfig } from '../../vitest.config.ts'

/**
 * Sharing modules loads Stylelint, its plugins and the presets once per worker rather than once per
 * file. No file needs modules of its own
 */
const config: VitestConfig = withSharedModules([])

export default config
