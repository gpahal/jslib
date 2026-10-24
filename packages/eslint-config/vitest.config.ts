import { readFileSync } from 'node:fs'

import { withSharedModules } from '../../vitest.config.ts'
import type { VitestConfig } from '../../vitest.config.ts'

const UTILS_PATH = 'src/internal/utils.ts'

/**
 * `WARNING_CODES`, read from the source: importing the module would bundle it and its imports, such
 * as `@/` paths and `@gpahal/std`, into this config, and moving the list to a module of its own
 * would change the package's declarations
 *
 * @throws Error when the source has no `WARNING_CODES` array of codes.
 */
function readWarningCodes(): Array<string> {
  const source = readFileSync(new URL(UTILS_PATH, import.meta.url), 'utf8')
  const [, list = ''] = /^export const WARNING_CODES = \[([^\]]*)\] as const$/m.exec(source) ?? []
  const codes = list
    .matchAll(/'(GPAHAL_\w+)'/g)
    .map(([, code = '']) => code)
    .toArray()
  if (codes.length === 0) {
    // The repo's error shape, written by hand, since a Vitest config imports no workspace package
    throw new Error(
      `@gpahal/eslint-config: \`vitest.config.ts\`: \`${UTILS_PATH}\`: has no \`export const WARNING_CODES = [...] as const\` of codes. Write the list as quoted \`GPAHAL_*\` codes`,
    )
  }
  return codes
}

/**
 * Sharing modules loads the presets' plugins once per worker rather than once per file, which took
 * about a third of the suite's time. These files need modules of their own
 */
const config: VitestConfig = withSharedModules(
  [
    // `vi.mock` doesn't apply to a module another file already loaded
    'tests/default-project-discovery.test.ts',
    'tests/markdown-language.test.ts',
    // Lints a copy of the fixture with type information, whose project service options differ from
    // those another file already set in the process
    'tests/fix-output.test.ts',
  ],
  {
    // Tests that build configs for fixture projects trigger the setup warnings without checking
    // them. This stops only the printing: spies on `process.emitWarning` still see them, and
    // processes the tests spawn still print them
    execArgv: readWarningCodes().map((code) => `--disable-warning=${code}`),
  },
)

export default config
