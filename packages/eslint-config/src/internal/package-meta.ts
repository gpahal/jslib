// The build inlines these two fields, not the whole file
import { name, version } from '../../package.json' with { type: 'json' }

/**
 * This package's name and version, which its plugins and processor declare in their `meta`, so
 * ESLint's `--cache` tells one release's results from another's
 */
export const PACKAGE_META: { name: string; version: string } = { name, version }
