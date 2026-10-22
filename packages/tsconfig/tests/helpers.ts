import { readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * The package's folder, which holds the presets
 */
export const PACKAGE_DIR = path.join(import.meta.dirname, '..')

/**
 * The file names of the presets: the package's JSON files other than its manifest and tsconfig
 */
export const PRESETS = readdirSync(PACKAGE_DIR).filter(
  (name) => name.endsWith('.json') && name !== 'package.json' && name !== 'tsconfig.json',
)
