/**
 * Brace expansion for the glob options of the config packages. Contract: globs from the
 * developer's own code
 */

import { expand } from 'brace-expansion'

import { formatMessage, formatNames } from '@gpahal/std/errors'
import { shorten } from '@gpahal/std/strings'

/**
 * The most globs that a glob's braces may expand to, which keeps a range such as `{1..100000}` from
 * making a check slow
 */
export const MAX_EXPANSIONS = 1000

/**
 * The most characters a glob may have. With {@link MAX_EXPANSIONS}, it bounds the total length of
 * the expansions, so brace-expansion's own cap on that length can be lifted
 */
const MAX_GLOB_LENGTH = 4096

const MAX_BRACE_DEPTH = 10

const MAX_SHOWN_GLOB_LENGTH = 40

export type ExpandBracesContext = {
  prefix: string
  /**
   * Where the glob is, such as `` ['`testFiles`'] ``
   */
  subjects: ReadonlyArray<string>
}

/**
 * Unicode's Private Use Area, from which {@link hideEscapes} picks a marker
 */
const PRIVATE_USE_START = 0xe0_00
const PRIVATE_USE_END = 0xf8_ff

/**
 * `glob` with each escape hidden from brace-expansion, and a function that restores them.
 * brace-expansion drops the `\` of `\{`, `\}`, `\,`, `\.` and `\\`, so a matcher would read
 * `\{a,b}` as braces again. Each escape becomes the escaped code point in base 36 between markers
 * the glob doesn't have. A glob has at most {@link MAX_GLOB_LENGTH} characters, so one is free
 */
function hideEscapes(glob: string): { hidden: string; restore: (expanded: string) => string } {
  if (!glob.includes('\\')) {
    return { hidden: glob, restore: (expanded) => expanded }
  }
  let code = PRIVATE_USE_START
  while (code < PRIVATE_USE_END && glob.includes(String.fromCodePoint(code))) {
    code++
  }
  const marker = String.fromCodePoint(code)
  const hidden = glob.replaceAll(
    /\\([\s\S])/gu,
    (_match, char: string) => `${marker}${char.codePointAt(0)?.toString(36) ?? ''}${marker}`,
  )
  const markerRegex = new RegExp(`${marker}([0-9a-z]+)${marker}`, 'gu')
  return {
    hidden,
    restore: (expanded) =>
      expanded.replaceAll(
        markerRegex,
        (_match, digits: string) => `\\${String.fromCodePoint(Number.parseInt(digits, 36))}`,
      ),
  }
}

/**
 * The globs that `glob` expands to, with minimatch's brace expansion, which ESLint follows. Escapes
 * stay, so a matcher reads each glob as it reads `glob`. A `!` that expansion puts first is escaped,
 * so `{!a,b}` gives `\!a`, the name `!a`, as minimatch reads it, not a negation, and a leading
 * extglob is wrapped instead, so `{!(a),b}` gives `@(!(a))` and `b`.
 *
 * Stylelint 17 matches with micromatch, which differs in places: it reads `a{1..10}.css` as
 * `a[1-10].css` and `"{a,b}".css` literally. stylelint-config passes the original globs to
 * Stylelint and uses the expansion only to classify and bound them
 *
 * @throws TypeError when the glob has more than 4096 characters, its braces nest more than 10 deep
 *   or they expand to more than 1000 globs, such as "@scope/config: `testFiles`: glob `{1..2000}`
 *   expands to more than 1000 globs. List fewer alternatives", or when a non-empty glob expands to
 *   none, as `{,}` does.
 */
export function expandBraces(
  glob: string,
  { prefix, subjects }: ExpandBracesContext,
): Array<string> {
  const fail = (description: string) =>
    new TypeError(
      formatMessage(
        prefix,
        subjects,
        `glob ${formatNames([shorten(glob, MAX_SHOWN_GLOB_LENGTH)])} ${description}`,
      ),
    )
  if (glob.length > MAX_GLOB_LENGTH) {
    throw fail(`has more than ${MAX_GLOB_LENGTH} characters`)
  }
  if (scanBraces(glob).depth > MAX_BRACE_DEPTH) {
    throw fail(`nests braces more than ${MAX_BRACE_DEPTH} deep`)
  }
  // brace-expansion's default `maxLength` drops the expansions past it without an error. The
  // limits above bound the length instead
  const { hidden, restore } = hideEscapes(glob)
  const globs = expand(hidden, { max: MAX_EXPANSIONS + 1, maxLength: Number.MAX_SAFE_INTEGER })
  if (globs.length > MAX_EXPANSIONS) {
    throw fail(`expands to more than ${MAX_EXPANSIONS} globs. List fewer alternatives`)
  }
  // brace-expansion drops empty alternatives, so `{,}` gives no globs, which would match nothing
  // without an error
  if (glob !== '' && globs.length === 0) {
    throw fail('expands to an empty glob')
  }
  // minimatch reads `{!a,b}` as the names `!a` and `b`, but ESLint and Stylelint read a glob that
  // starts with `!` as a negation, so a `!` that expansion puts first is escaped
  const isNegated = glob.startsWith('!')
  return globs.map((expanded) =>
    !isNegated && expanded.startsWith('!') ? keepNonNegated(restore(expanded)) : restore(expanded),
  )
}

/**
 * `glob`, which starts with a `!` that isn't a negation, written so a matcher doesn't read it as
 * one. A leading extglob is wrapped, since escaping its `!` would make it a name
 */
function keepNonNegated(glob: string): string {
  if (glob.startsWith('!(')) {
    const end = findGroupEnd(glob, 1)
    if (end !== undefined) {
      return `@(${glob.slice(0, end + 1)})${glob.slice(end + 1)}`
    }
  }
  return `\\${glob}`
}

/**
 * The index of the `)` that closes the `(` at `start`, skipping escaped characters
 */
function findGroupEnd(glob: string, start: number): number | undefined {
  let depth = 0
  for (let index = start; index < glob.length; index++) {
    switch (glob.charAt(index)) {
      case '\\': {
        index++
        break
      }
      case '(': {
        depth++
        break
      }
      case ')': {
        depth--
        if (depth === 0) {
          return index
        }
        break
      }
      // No default
    }
  }
  return undefined
}

/**
 * The braces of `glob`, skipping the ones a backslash escapes: how deep they nest, and the indexes
 * of the `{` that no later `}` closes. An unclosed brace counts toward the depth, which can only
 * overstate it
 */
export function scanBraces(glob: string): { depth: number; unclosed: Array<number> } {
  const open: Array<number> = []
  let depth = 0
  for (let index = 0; index < glob.length; index++) {
    switch (glob.charAt(index)) {
      case '\\': {
        index++
        break
      }
      case '{': {
        open.push(index)
        depth = Math.max(depth, open.length)
        break
      }
      case '}': {
        open.pop()
        break
      }
      default: {
        break
      }
    }
  }
  return { depth, unclosed: open }
}
