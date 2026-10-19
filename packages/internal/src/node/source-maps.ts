/**
 * The source maps of the builds, which the root `tsdown.config.ts` completes and
 * `assertBuildIsCurrent` from `@gpahal/internal/node/testing` checks, so both resolve and hash
 * sources the same way. The root config imports this module by path, and std's build loads that
 * config, so it imports no workspace package. Contract: parsed JSON from the builds' own maps
 */

import { createHash } from 'node:crypto'
import path from 'node:path'

export type SourceMap = {
  sourceRoot?: string | undefined
  sources: Array<string>
  sourcesContent?: Array<string | null> | undefined
  names?: Array<string> | undefined
  mappings?: string | undefined
  /**
   * The SHA-256 of each TypeScript source, in hex, and `null` for the others, such as
   * `package.json`
   */
  x_sourceHashes?: Array<string | null> | undefined
}

export function isSourceMap(value: unknown): value is SourceMap {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const sources: unknown = Reflect.get(value, 'sources')
  const sourceRoot: unknown = Reflect.get(value, 'sourceRoot')
  return (
    Array.isArray(sources) &&
    sources.every((source) => typeof source === 'string') &&
    (sourceRoot === undefined || typeof sourceRoot === 'string')
  )
}

/**
 * The absolute path of `source`, a source of the map at `mapPath`, resolved against the map's
 * `sourceRoot`
 */
export function resolveSourcePath(mapPath: string, map: SourceMap, source: string): string {
  return path.resolve(path.dirname(mapPath), map.sourceRoot ?? '', source)
}

export function isHashedSource(source: string): boolean {
  return /\.[cm]?ts$/.test(source)
}

export function hashSource(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Whether the `/`-separated `names` match the glob segments `patterns`, a `*` or `**` matching dot
 * names too, as npm's `dot: true` does
 */
function matchesSegments(names: ReadonlyArray<string>, patterns: ReadonlyArray<string>): boolean {
  const [pattern, ...restPatterns] = patterns
  if (pattern === undefined) {
    return names.length === 0
  }
  if (pattern === '**') {
    return (
      names.some((_, index) => matchesSegments(names.slice(index), restPatterns)) ||
      matchesSegments([], restPatterns)
    )
  }
  const [name, ...restNames] = names
  // `matchesGlob` doesn't match a wildcard against a leading `.`, so a shared first character
  // makes the name's `.`, if any, an inner one
  return (
    name !== undefined &&
    path.matchesGlob(`x${name}`, `x${pattern}`) &&
    matchesSegments(restNames, restPatterns)
  )
}

/**
 * Whether a package publishes the file at the `/`-separated `relativePath`, relative to its folder, given
 * its `package.json` `files`. As with npm, an entry matches a file or a folder holding it, with
 * wildcards matching dot names, a `!` entry excludes, and the last matching entry wins.
 * `package.json` is always published
 */
export function isPublishedFile(
  relativePath: string,
  files: ReadonlyArray<string> | undefined,
): boolean {
  if (files === undefined || relativePath === 'package.json') {
    return true
  }
  const names = relativePath.split('/')
  let isPublished = false
  for (const entry of files) {
    const isExcluded = entry.startsWith('!')
    const patterns = (isExcluded ? entry.slice(1) : entry)
      .replace(/^\.?\//, '')
      .replace(/\/$/, '')
      .split('/')
    // The path or a folder holding it
    if (names.some((_, index) => matchesSegments(names.slice(0, index + 1), patterns))) {
      isPublished = !isExcluded
    }
  }
  return isPublished
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Remove the sources that `isDropped` picks from `map`, with their `sourcesContent`. The segments
 * that pointed at them keep their generated column but map to nothing, so a tool such as
 * TypeScript's go-to-definition stays in the generated file instead of opening a missing source.
 * Call it before computing anything indexed by source, such as `x_sourceHashes`
 */
export function dropSources(map: SourceMap, isDropped: (source: string) => boolean): void {
  const kept = map.sources.map((source) => !isDropped(source))
  if (kept.every(Boolean)) {
    return
  }
  const newIndexes: Array<number | undefined> = []
  let next = 0
  for (const isKept of kept) {
    newIndexes.push(isKept ? next++ : undefined)
  }
  if (map.mappings !== undefined) {
    // The generated column is relative to the previous segment on the line. The source, original
    // line, original column and name are relative to the previous segment that has them, across
    // lines, so they're decoded to absolute values, and encoded again against the segments kept
    const previousIn = [0, 0, 0, 0]
    const previousOut = [0, 0, 0, 0]
    map.mappings = map.mappings
      .split(';')
      .map((line) =>
        line
          .split(',')
          .map((segment) => {
            if (segment === '') {
              return segment
            }
            const [column = 0, ...deltas] = decodeVlqs(segment)
            const absolute = deltas.map((delta, index) => {
              previousIn[index] = (previousIn[index] ?? 0) + delta
              return previousIn[index]
            })
            const [source] = absolute
            const newSource = source === undefined ? undefined : newIndexes[source]
            // The column delta is kept, since every segment stays
            if (newSource === undefined) {
              return encodeVlq(column)
            }
            absolute[0] = newSource
            return (
              encodeVlq(column) +
              absolute
                .map((value, index) => {
                  const delta = value - (previousOut[index] ?? 0)
                  previousOut[index] = value
                  return encodeVlq(delta)
                })
                .join('')
            )
          })
          .join(','),
      )
      .join(';')
  }
  map.sources = map.sources.filter((_source, index) => kept[index] === true)
  if (map.sourcesContent !== undefined) {
    map.sourcesContent = map.sourcesContent.filter((_content, index) => kept[index] === true)
  }
}

function decodeVlqs(segment: string): Array<number> {
  const values: Array<number> = []
  let value = 0
  let shift = 0
  for (const char of segment) {
    const digit = BASE64_CHARS.indexOf(char)
    if (digit === -1) {
      // The repo's error shape, written by hand, since this module imports no workspace package
      throw new TypeError(
        `@gpahal/internal: source map \`mappings\`: expected base64 VLQs, received \`${JSON.stringify(char)}\``,
      )
    }
    value += (digit & 31) * 2 ** shift
    if ((digit & 32) === 0) {
      values.push((value % 2 === 1 ? -(value - 1) : value) / 2)
      value = 0
      shift = 0
    } else {
      shift += 5
    }
  }
  return values
}

function encodeVlq(value: number): string {
  let rest = value < 0 ? -value * 2 + 1 : value * 2
  let output = ''
  do {
    let digit = rest % 32
    rest = Math.floor(rest / 32)
    if (rest > 0) {
      digit |= 32
    }
    output += BASE64_CHARS.charAt(digit)
  } while (rest > 0)
  return output
}
