/**
 * Path options that also take a `file:` URL, such as `tailwindcss.entryPoint`.
 * Contract: an absolute `root` or none, and a value already checked to be a string or a `URL`
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { formatMessage, formatNames, getErrorReason } from '@gpahal/std/errors'

const FILE_URL_EXPECTED =
  "or a `file:` URL or URL string with an absolute path, such as `import.meta.resolve('./src/styles/global.css')`"

/**
 * What {@link resolvePathOrFileUrl} takes, for errors
 */
export const PATH_OR_FILE_URL_EXPECTED: string = `an absolute path or one relative to \`root\`, ${FILE_URL_EXPECTED}`

/**
 * For an option without `root`, whose tool resolves a relative path from the config file's folder
 */
export const PATH_OR_FILE_URL_WITHOUT_ROOT_EXPECTED: string = `an absolute path or one relative to the config file's folder, ${FILE_URL_EXPECTED}`

/**
 * A string that starts with a URL scheme of two or more characters, so not a Windows drive letter
 */
export const URL_SCHEME_REGEX: RegExp = /^[a-z][\d+.a-z-]+:/i

/**
 * A Windows path relative to a drive's current folder, such as `C:a.css`, which can't be resolved
 * against another folder. Rejected on every platform, for the same behavior on each
 */
const DRIVE_RELATIVE_REGEX = /^[a-z]:(?![\\/])/iu

/**
 * Whether `value` is a non-empty path that {@link resolvePathOrFileUrl} resolves against `root`
 */
export function isRelativePath(value: string): boolean {
  return (
    value !== '' &&
    !path.isAbsolute(value) &&
    !URL_SCHEME_REGEX.test(value) &&
    !DRIVE_RELATIVE_REGEX.test(value)
  )
}

/**
 * The absolute path of `value`: an absolute path, a path relative to `root`, or a `file:` URL or
 * URL string with an absolute path. For anything else, such as a drive-relative Windows path,
 * another scheme, `file:p(x)/a.css`, which a URL parser reads as `/p(x)/a.css`, or a relative path
 * without `root`, `onInvalid` is called with the parse error, if any
 */
export function resolvePathOrFileUrl(
  value: string | URL,
  root: string | undefined,
  onInvalid: (cause?: unknown) => never,
): string {
  if (typeof value === 'string' && !/^file:\//i.test(value)) {
    if (isRelativePath(value)) {
      return root === undefined ? onInvalid() : path.resolve(root, value)
    }
    return path.isAbsolute(value) ? value : onInvalid()
  }
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    return onInvalid(error)
  }
  if (url.protocol !== 'file:') {
    return onInvalid()
  }
  try {
    // Throws on a host other than `localhost`
    return fileURLToPath(url)
  } catch (error) {
    return onInvalid(error)
  }
}

export type PathOptionContext = {
  prefix: string
  /**
   * The option's name, such as `tailwindcss.entryPoint`
   */
  name: string
}

/**
 * {@link resolvePathOrFileUrl} of the option `name`
 *
 * @throws TypeError "<prefix>: `<name>`: expected <what it takes>, received `<value>`", with the
 *   whole value, and the parse error, if any, as the `cause`.
 */
export function resolvePathOption(
  value: string | URL,
  root: string | undefined,
  { prefix, name }: PathOptionContext,
): string {
  return resolvePathOrFileUrl(value, root, (cause) => {
    // The whole value, not `describeValue`, which cuts a long path short and gives only the class
    // of a `URL`
    throw new TypeError(
      formatMessage(
        prefix,
        [formatNames([name])],
        `expected ${root === undefined ? PATH_OR_FILE_URL_WITHOUT_ROOT_EXPECTED : PATH_OR_FILE_URL_EXPECTED}, received ${formatNames([String(value)])}`,
      ),
      cause === undefined ? undefined : { cause },
    )
  })
}

/**
 * {@link resolvePathOption} of an option that names a file, such as `tailwindcss.entryPoint`
 *
 * @throws TypeError as {@link resolvePathOption} does, "<prefix>: `<name>`: reading `<path>`
 *   failed: <reason>", with the filesystem error as the `cause`, when the path can't be read, as
 *   with a symlink loop, and "<prefix>: `<name>`: `<path>` isn't a file" when nothing or a folder
 *   is there.
 */
export function resolveFileOption(
  value: string | URL,
  root: string | undefined,
  context: PathOptionContext,
): string {
  const file = resolvePathOption(value, root, context)
  const fail = (description: string, cause?: unknown): never => {
    throw new TypeError(
      formatMessage(context.prefix, [formatNames([context.name])], description),
      cause === undefined ? undefined : { cause },
    )
  }
  let stats: fs.Stats | undefined
  try {
    stats = fs.statSync(file, { throwIfNoEntry: false })
  } catch (error) {
    return fail(`reading ${formatNames([file])} failed: ${getErrorReason(error)}`, error)
  }
  return stats?.isFile() === true ? file : fail(`${formatNames([file])} isn't a file`)
}
