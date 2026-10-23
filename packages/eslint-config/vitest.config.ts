import { withSharedModules, type VitestConfig } from '../../vitest.config.ts'

/**
 * Sharing modules loads the presets' plugins once per worker rather than once per file, which took
 * about a third of the suite's time. These files need modules of their own
 */
const config: VitestConfig = withSharedModules([
  // `vi.mock` doesn't apply to a module another file already loaded
  'tests/default-project-discovery.test.ts',
  'tests/markdown-language.test.ts',
  // Lints with the repository's config, whose project service options differ from those another
  // file already set in the process
  'tests/fix-output.test.ts',
])

export default config
