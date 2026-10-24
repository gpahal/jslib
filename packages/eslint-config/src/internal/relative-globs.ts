/**
 * Checks of globs that ESLint matches against paths relative to `root`
 */

import path from 'node:path'

import { formatNames } from '@gpahal/std/errors'
import { trimEnd } from '@gpahal/std/strings'

import { fail } from '@/internal/utils'

/**
 * Never matches a path relative to `root`, on any platform
 */
const WINDOWS_ABSOLUTE_REGEX = /^(?:[a-z]:[/\\]|[/\\]{2}[^/\\])/i

/**
 * The path from `root` when the glob starts with `root`'s path, or else the glob without its `/`,
 * as for `/lib/**` written as `.gitignore` anchors a rule
 */
function describeAbsoluteFix(negation: string, pattern: string, root: string | undefined): string {
  const prefix = root === undefined ? undefined : `${trimEnd(root.split(path.sep).join('/'), '/')}/`
  const fixed =
    prefix !== undefined && pattern.startsWith(prefix) && pattern.length > prefix.length
      ? pattern.slice(prefix.length)
      : pattern.replace(/^\/+/, '')
  return `Write \`${negation}${fixed}\``
}

const PATH_SEGMENT_START = /^[\p{L}\p{N}_]$/u

/**
 * A `\` before a letter, digit, `_` or `**` reads as a separator, as in `src\lib`. Before any other
 * character, such as `\*`, it escapes it
 */
function hasBackslashSeparator(glob: string): boolean {
  // Each match is a `\` and the character it escapes, so an escaped `\` is one match
  for (const match of glob.matchAll(/\\(.?)/gsu)) {
    const escaped = match[1] ?? ''
    if (PATH_SEGMENT_START.test(escaped) || (escaped === '*' && glob[match.index + 2] === '*')) {
      return true
    }
  }
  return false
}

/**
 * A glob that starts with `/` or `..` would match nothing, since ESLint lints no file outside
 * `root`, and a `\` separator escapes the next character instead. It also throws on a Windows drive letter
 * or UNC prefix. `root` is for the fix of a glob that starts with `/`
 */
export function checkRelativeGlobs(name: string, globs: ReadonlyArray<string>, root: string): void {
  checkRelativeGlobsAt([formatNames([name])], globs, root)
}

/**
 * As {@link checkRelativeGlobs}. Without `root`, the fix of a glob that starts with `/` drops the
 * `/`
 */
export function checkRelativeGlobsAt(
  subjects: ReadonlyArray<string>,
  globs: ReadonlyArray<string>,
  root: string | undefined,
): void {
  for (const glob of globs) {
    if (glob === '' || glob === '!') {
      fail(subjects, `glob \`${glob}\` ${glob === '' ? 'is empty' : 'is a `!` with no glob'}`)
    }

    const negation = glob.startsWith('!') ? '!' : ''
    const pattern = glob.slice(negation.length)
    if (WINDOWS_ABSOLUTE_REGEX.test(pattern)) {
      fail(
        subjects,
        `glob \`${glob}\` starts with a drive letter or a UNC prefix, but globs are relative to \`root\` and use \`/\` separators. Write it relative to \`root\`, as in \`src/**\``,
      )
    }
    if (hasBackslashSeparator(glob)) {
      fail(
        subjects,
        `glob \`${glob}\` has a \`\\\` separator. Use \`/\` separators; a \`\\\` escapes a glob character, as in \`\\*\``,
      )
    }
    if (pattern.startsWith('/')) {
      fail(
        subjects,
        `glob \`${glob}\` starts with \`/\`, but globs are relative to \`root\`. ${describeAbsoluteFix(negation, pattern, root)}`,
      )
    }
    if (pattern.split('/').find((segment) => segment !== '.') === '..') {
      fail(
        subjects,
        `glob \`${glob}\` starts with \`..\`, but globs are relative to \`root\` and match only files under it`,
      )
    }
  }
}
