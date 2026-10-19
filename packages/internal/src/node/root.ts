/**
 * The check of the `root` option that each config package's `defineConfig` requires. Contract: a
 * package name as the prefix and a string as the root
 */

import fs from 'node:fs'
import path from 'node:path'

import { describeValue, formatMessage, formatNames, getErrorReason } from '@gpahal/std/errors'

function statRoot(prefix: string, file: string): fs.Stats | undefined {
  try {
    return fs.statSync(file, { throwIfNoEntry: false })
  } catch (error) {
    throw new TypeError(
      formatMessage(
        prefix,
        ['`root`'],
        `reading ${formatNames([file])} failed: ${getErrorReason(error)}`,
      ),
      { cause: error },
    )
  }
}

/**
 * Check that `root` is an existing absolute folder with read and search access.
 * Relative paths, which would resolve against `process.cwd()`, fail here
 *
 * @throws TypeError naming `root`, as in `` <prefix>: `root`: path `/a` isn't a folder ``
 */
export function checkRoot(prefix: string, root: string): void {
  if (!path.isAbsolute(root)) {
    throw new TypeError(
      formatMessage(
        prefix,
        ['`root`'],
        `expected an absolute path, such as \`import.meta.dirname\`, received ${describeValue(root)}`,
      ),
    )
  }
  if (statRoot(prefix, root)?.isDirectory() !== true) {
    throw new TypeError(
      formatMessage(prefix, ['`root`'], `path ${formatNames([root])} isn't a folder`),
    )
  }
  try {
    fs.accessSync(root, fs.constants.R_OK | fs.constants.X_OK)
  } catch (error) {
    throw new TypeError(
      formatMessage(
        prefix,
        ['`root`'],
        `reading ${formatNames([root])} failed: ${getErrorReason(error)}`,
      ),
      { cause: error },
    )
  }
}
