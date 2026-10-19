import type { Config } from 'stylelint'

import { isArray, toArray } from '@gpahal/std/arrays'
import { omitUndefinedValues } from '@gpahal/std/objects'

import type { StylelintExtends, StylelintOverride, StylelintReferenceFile } from '@/internal/rules'

type Override = NonNullable<Config['overrides']>[number]

type ReferenceFile = Extract<NonNullable<Config['referenceFiles']>, Array<unknown>>[number]

/**
 * Stylelint accepts config objects in extends, which its declarations omit
 */
export function toStylelintExtends(extended: StylelintExtends): NonNullable<Config['extends']> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Stylelint supports object extends at runtime; consumer tests cover both forms
  return copyArray(extended) as NonNullable<Config['extends']>
}

/**
 * A mutable copy of an array, which Stylelint's types want, or else the value
 */
function copyArray<T>(value: T | ReadonlyArray<T>): T | Array<T>
function copyArray(value: unknown): unknown {
  return isArray(value) ? [...value] : value
}

/**
 * A reference file as Stylelint types it: without the keys set to `undefined`, and with a mutable
 * array of files
 */
export function toReferenceFile(file: string | StylelintReferenceFile): ReferenceFile {
  if (typeof file === 'string') {
    return file
  }
  const { files, ...entry } = omitUndefinedValues(file)
  return { ...entry, files: copyArray(files) }
}

/**
 * Your override without its rules, as Stylelint types it: without the keys set to `undefined`, and
 * with mutable arrays
 */
export function toOverride({
  files,
  extends: extended,
  plugins,
  ignoreFiles,
  processors,
  referenceFiles,
  rules: _rules,
  ...override
}: StylelintOverride): Override {
  return {
    ...omitUndefinedValues(override),
    files: copyArray(files),
    ...(extended !== undefined && { extends: toStylelintExtends(extended) }),
    ...(plugins !== undefined && { plugins: isArray(plugins) ? toArray(plugins).flat() : plugins }),
    ...(ignoreFiles !== undefined && { ignoreFiles: copyArray(ignoreFiles) }),
    ...(processors !== undefined && { processors: [...processors] }),
    ...(referenceFiles !== undefined && {
      referenceFiles: toArray(referenceFiles).map((file) => toReferenceFile(file)),
    }),
  }
}
