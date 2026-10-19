/**
 * Reads JSON files, such as package manifests. A leaf module, so any other module can import it.
 * Contract: paths from the packages' own code
 */

import fs from 'node:fs'

/**
 * The parsed JSON file at `file`, without a leading UTF-8 BOM, which Node's resolvers skip too, so
 * a manifest that resolves also reads
 *
 * @throws The read's error, or the `SyntaxError` of `JSON.parse`, for the caller to keep as the
 *   `cause` of its own error.
 */
export function readJsonFile(file: string | URL): unknown {
  const text = fs.readFileSync(file, 'utf8')
  return JSON.parse(text.startsWith('\u{FEFF}') ? text.slice(1) : text)
}
