import path from 'node:path'

import { Minimatch } from 'minimatch'

/**
 * As ESLint and typescript-eslint match. picomatch differs: it reads `[!a]` as `!` or `a`, and
 * differs on `a\b`, `a[/]b` and `?` against `.`
 */
const MINIMATCH_OPTIONS = { dot: true } as const

/**
 * A config with only these and `ignores` ignores its files for every config
 */
export const GLOBAL_IGNORES_KEYS: ReadonlySet<string> = new Set(['ignores', 'name', 'basePath'])

export function unescapeGlob(glob: string): string {
  return glob.replaceAll(/\\(.)/g, '$1')
}

/**
 * Compiling a glob costs far more than matching it, and checking a config compiles the same globs
 * for every config object it walks. A `Minimatch` keeps no state between matches
 */
const COMPILED_GLOBS = new Map<string, Minimatch>()

function compileGlob(glob: string): Minimatch {
  let matcher = COMPILED_GLOBS.get(glob)
  if (matcher === undefined) {
    matcher = new Minimatch(glob, MINIMATCH_OPTIONS)
    COMPILED_GLOBS.set(glob, matcher)
  }
  return matcher
}

export function createGlobMatcher(
  globs: string | ReadonlyArray<string>,
): (path: string) => boolean {
  const matchers = (typeof globs === 'string' ? [globs] : globs).map((glob) => compileGlob(glob))
  return (filePath) => matchers.some((matcher) => matcher.match(filePath))
}

/**
 * A positive glob matches it, and no negated one does
 */
export function createListMatcher(globs: ReadonlyArray<string>): (file: string) => boolean {
  const { positive, negated } = splitGlobs(globs)
  if (positive.length === 0) {
    return () => false
  }
  const isPositive = createGlobMatcher(positive)
  const isNegated = negated.length === 0 ? () => false : createGlobMatcher(negated)
  return (file) => isPositive(file) && !isNegated(file)
}

export function hasGlobMagic(glob: string): boolean {
  return compileGlob(glob).hasMagic()
}

const GLOB_SPECIAL_CHAR = /[!()*+?@[\\\]{|}]/

/**
 * Escaped as minimatch reads it. A leading `#` is escaped too, since minimatch reads it as a
 * comment. Separators must already be `/`, since a backslash escapes
 */
export function escapeGlob(filePath: string): string {
  return filePath
    .replaceAll(new RegExp(GLOB_SPECIAL_CHAR, 'g'), String.raw`\$&`)
    .replace(/^#/, String.raw`\#`)
}

/**
 * Relative to `root`
 */
export function folderGlob(root: string, dir: string): string {
  const relative = path.relative(root, dir).split(path.sep).join('/')
  return relative === '' ? '**' : `${escapeGlob(relative)}/**`
}

export function isLiteralGlob(glob: string): boolean {
  return !GLOB_SPECIAL_CHAR.test(glob.replaceAll(/\\./g, ''))
}

/**
 * A file matches an inner array when it matches every glob in it
 */
export type FileSpecs = Array<string | Array<string>>

export function intersectFiles(files: FileSpecs, patterns: ReadonlyArray<string>): FileSpecs {
  return files.flatMap((file) => patterns.map((pattern) => [...[file].flat(), pattern]))
}

export function intersectFileSpecs(a: FileSpecs, b: FileSpecs): FileSpecs {
  return a.flatMap((left) => b.map((right) => [...[left].flat(), ...[right].flat()]))
}

export function isSameFiles(a: FileSpecs, b: FileSpecs): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function splitGlobs(globs: ReadonlyArray<string>): {
  positive: Array<string>
  negated: Array<string>
} {
  return {
    positive: globs.filter((glob) => !glob.startsWith('!')),
    negated: globs.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1)),
  }
}

/**
 * ESLint negates a `!` glob in an inner array, so a file one matches matches none
 */
export function withNegatedGlobs(files: FileSpecs, negated: ReadonlyArray<string>): FileSpecs {
  return negated.length === 0
    ? files
    : files.map((file) => [...[file].flat(), ...negated.map((glob) => `!${glob}`)])
}

/**
 * So `['e2e/**', '!e2e/unit/**']` leaves `e2e/unit/**`
 */
export function withoutGlobFiles(files: FileSpecs, globs: ReadonlyArray<string>): FileSpecs {
  const { positive, negated } = splitGlobs(globs)
  return positive.length === 0
    ? files
    : [...withNegatedGlobs(files, positive), ...intersectFiles(files, negated)]
}

export function globsAsFiles(globs: ReadonlyArray<string>): FileSpecs {
  const { positive, negated } = splitGlobs(globs)
  return withNegatedGlobs(positive, negated)
}

/**
 * The negated globs last, since a later `!` glob un-ignores a file in a config's `ignores`
 */
export function globsAsIgnores(globs: ReadonlyArray<string>): Array<string> {
  const { positive, negated } = splitGlobs(globs)
  return [...positive, ...negated.map((glob) => `!${glob}`)]
}

export type Scope = {
  files: FileSpecs
  ignores?: Array<string>
}

/**
 * Dotfiles match, as in ESLint
 */
function matchesSegment(segment: string, name: string): boolean {
  return createGlobMatcher(segment)(name)
}

/**
 * Rebases `glob` from an ancestor down to a folder, given the folder names in between. A path
 * matched only at or above the folder drops, as ESLint never ignores its base path
 */
function rebaseGlobDown(glob: string, folders: ReadonlyArray<string>): Array<string> {
  const isNegated = glob.startsWith('!')
  // A run of `**` matches what one does, and only the first may match no folder, so `**/**/a`
  // would never match `a` right under the folder
  const segments = (isNegated ? glob.slice(1) : glob)
    .split('/')
    .filter((segment, index, all) => segment !== '**' || all[index - 1] !== '**')
  let states: Array<Array<string>> = [segments]
  for (const name of folders) {
    const next = new Map<string, Array<string>>()
    const add = (segments: Array<string>) => next.set(segments.join('/'), segments)
    for (const segments of states) {
      const [head, ...rest] = segments
      if (head === '**') {
        add(segments)
        if (rest[0] !== undefined && rest[0] !== '' && matchesSegment(rest[0], name)) {
          add(rest.slice(1))
        }
      } else if (head !== undefined && head !== '' && matchesSegment(head, name)) {
        add(rest)
      }
    }
    states = next.values().toArray()
  }
  return states
    .map((segments) => segments.join('/'))
    .filter((rebased) => rebased !== '')
    .map((rebased) => (isNegated ? `!${rebased}` : rebased))
}

/**
 * Prefixed for a `basePath` under `root`, rebased down for one above it, and none for one beside
 * it, since `glob` matches nothing under `root` then
 */
export function rebaseGlob(glob: string, basePath: string, root: string): Array<string> {
  if (isInside(basePath, root)) {
    const down = path.relative(root, basePath).split(path.sep).join('/')
    if (down === '') {
      return [glob]
    }
    const isNegated = glob.startsWith('!')
    return [`${isNegated ? '!' : ''}${escapeGlob(down)}/${isNegated ? glob.slice(1) : glob}`]
  }
  return isInside(root, basePath)
    ? rebaseGlobDown(glob, path.relative(basePath, root).split(path.sep))
    : []
}

/**
 * Joins as an extglob alternation, such as `@(a|b)/dist/`. A `|` in a name is `[|]`, since
 * minimatch splits an alternation at an escaped `|` too
 */
export function joinSiblingGlob(names: ReadonlyArray<string>, glob: string): string {
  const isNegated = glob.startsWith('!')
  const escaped = names.map((name) =>
    names.length === 1 ? escapeGlob(name) : escapeGlob(name).replaceAll(String.raw`\|`, '[|]'),
  )
  const prefix = names.length === 1 ? (escaped[0] ?? '') : `@(${escaped.join('|')})`
  return `${isNegated ? '!' : ''}${prefix}/${isNegated ? glob.slice(1) : glob}`
}

export function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..')
}
