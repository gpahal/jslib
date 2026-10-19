import type * as sorter from '@ianvs/prettier-plugin-sort-imports'

/**
 * Compiled by typecheck. When upstream declares options, remove the require cast in sorterKeys
 * in src/internal/options.ts, then remove this canary
 */
// @ts-expect-error - The sorter exports options at runtime, but its declarations omit it
export type SorterOptions = typeof sorter.options
