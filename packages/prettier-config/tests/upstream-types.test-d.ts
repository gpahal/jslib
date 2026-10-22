import type * as sorter from '@ianvs/prettier-plugin-sort-imports'

/**
 * Compiled by typecheck. When upstream declares options, remove the require cast in loadSorter
 * in src/internal/plugins.ts, then remove this canary
 */
// @ts-expect-error - The sorter exports options at runtime, but its declarations omit it
export type SorterOptions = typeof sorter.options
