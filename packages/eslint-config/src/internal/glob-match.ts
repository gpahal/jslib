import { expandBraces } from '@gpahal/internal/globs'

import { createSegmentMatcher, hasSegmentMagic } from '@/internal/globs'
import { PREFIX } from '@/internal/utils'

/**
 * Outside a character class or group, since a dot inside an alternative, as in
 * `@(file.ts|file.json)`, doesn't constrain every match. Unknown syntax stays conservative
 */
function extensionBoundary(segment: string): number {
  let depth = 0
  let bracket = false
  let boundary = -1
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index]
    if (char === '\\') {
      return -1
    }
    if (char === '[') {
      bracket = true
      continue
    }
    if (char === ']') {
      bracket = false
      continue
    }
    if (bracket) continue
    if (char === '(') {
      depth += 1
      continue
    }
    if (char === ')') {
      depth -= 1
      if (depth < 0) return -1
      continue
    }
    if (depth !== 0) continue
    if (char === '|') return -1
    if (char === '.') boundary = index
  }
  return depth === 0 && !bracket ? boundary : -1
}

/**
 * Wildcards, negated groups and classes that can consume a dot could add another extension
 */
function isExtensionPattern(pattern: string): boolean {
  // Inside a name, since minimatch never matches a whole path segment of `.`
  const withoutClasses = pattern.replaceAll(/\[[a-z0-9!^-]+\]/gi, (group) =>
    createSegmentMatcher(`a${group}a`)('a.a') ? '.' : 'a',
  )
  const plain = withoutClasses.replaceAll(/[?*+@]\(/g, '(')
  return /^[\w()|-]+$/.test(plain)
}

/**
 * Inexact patterns may match, since a wildcard can consume the dot, as `tests/????` does `a.ts`
 */
function canExpandedMatchFile(glob: string, extensions: ReadonlyArray<string>): boolean {
  const segment = glob.slice(glob.lastIndexOf('/') + 1)
  if (!hasSegmentMagic(segment)) {
    return extensions.some((extension) => segment.endsWith(`.${extension}`))
  }
  const boundary = extensionBoundary(segment)
  if (boundary < 0) return true
  const pattern = segment.slice(boundary + 1)
  if (!isExtensionPattern(pattern)) return true
  const matches = createSegmentMatcher(pattern)
  return extensions.some((extension) => matches(extension))
}

/**
 * Through its brace expansions, as in `src/{client,server}.ts`
 *
 * @throws TypeError when the glob has more than 4096 characters, its braces nest more than 10 deep
 *   or they expand to more than 1000 globs
 */
export function canMatchFile(
  subjects: ReadonlyArray<string>,
  glob: string,
  extensions: ReadonlyArray<string>,
): boolean {
  return expandBraces(glob, { prefix: PREFIX, subjects }).some((expanded) =>
    canExpandedMatchFile(expanded, extensions),
  )
}

/**
 * Only a literal extension, as in `*.json`, rules the others out
 */
function canExpandedMatchOtherFile(glob: string, extensions: ReadonlyArray<string>): boolean {
  const segment = glob.slice(glob.lastIndexOf('/') + 1)
  if (!hasSegmentMagic(segment)) {
    return extensions.every((extension) => !segment.endsWith(`.${extension}`))
  }
  const boundary = extensionBoundary(segment)
  const extension = boundary < 0 ? undefined : segment.slice(boundary + 1)
  return extension === undefined || !/^[\w-]+$/.test(extension) || !extensions.includes(extension)
}

/**
 * As `src/**` and `src/*.{json,ts}` can for `['json']`
 *
 * @throws TypeError as {@link canMatchFile} does
 */
export function canMatchOtherFile(
  subjects: ReadonlyArray<string>,
  glob: string,
  extensions: ReadonlyArray<string>,
): boolean {
  return expandBraces(glob, { prefix: PREFIX, subjects }).some((expanded) =>
    canExpandedMatchOtherFile(expanded, extensions),
  )
}
