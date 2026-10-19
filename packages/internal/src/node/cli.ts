/**
 * What the packages' command-line tools share: the version that `--version` prints and the text of
 * an error that ends a run. Contract: a `package.json` URL of the calling package, and any thrown
 * value, whose messages are untrusted
 */

import { styleText } from 'node:util'

import { describeValue, formatMessage, getErrorMessage } from '@gpahal/std/errors'
import { escapeControls } from '@gpahal/std/strings'

import { readJsonFile } from '@/node/json'

/**
 * The `version` of the `package.json` at `manifestUrl`, as
 * `new URL('../package.json', import.meta.url)` from a package's `build/` or `src/`, read without a
 * leading UTF-8 BOM
 *
 * @throws If it can't be read, or has no string `version`.
 */
export async function readPackageVersion(prefix: string, manifestUrl: URL): Promise<string> {
  let manifest: unknown
  try {
    manifest = readJsonFile(manifestUrl)
  } catch (error) {
    throw new Error(formatMessage(prefix, ['`package.json`'], 'failed to read'), { cause: error })
  }
  const version: unknown =
    typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'version') : undefined
  if (typeof version !== 'string') {
    throw new TypeError(
      formatMessage(
        prefix,
        ['`package.json`', '`version`'],
        `expected a string, received ${describeValue(version)}`,
      ),
    )
  }
  return version
}

/**
 * Includes errors from other realms where the runtime has `Error.isError`
 */
function isError(value: unknown): value is Error {
  if (value instanceof Error) {
    return true
  }
  // ES2026, newer than the lib this package compiles with
  const isErrorNative: unknown = Reflect.get(Error, 'isError')
  return (
    typeof isErrorNative === 'function' && Reflect.apply(isErrorNative, Error, [value]) === true
  )
}

function readCause(value: unknown): unknown {
  try {
    return isError(value) ? Reflect.get(value, 'cause') : undefined
  } catch {
    return undefined
  }
}

function readName(value: unknown): string | undefined {
  try {
    const name: unknown = isError(value) ? Reflect.get(value, 'name') : undefined
    return typeof name === 'string' && name.trim() !== '' ? name : undefined
  } catch {
    return undefined
  }
}

/**
 * An error's causes, outermost first, each once, from errors of any realm. A `cause` getter that
 * throws ends the chain
 */
export function getCauses(error: unknown): Array<unknown> {
  const causes: Array<unknown> = []
  const seen = new Set<unknown>([error])
  let cause = readCause(error)
  while (cause != null && !seen.has(cause)) {
    causes.push(cause)
    seen.add(cause)
    cause = readCause(cause)
  }
  return causes
}

export type FormatCliErrorOptions = {
  /**
   * Whether to add a `  Caused by: <name>: <message>` line for each cause. Default is `true`. Leave
   * them out when they can hold secrets, such as a URL's credentials
   */
  causes?: boolean | undefined
  /**
   * The stream the text is written to, whose color support decides whether `error` is red
   */
  stream: NodeJS.WritableStream
}

const LINE_BREAK_REGEX = /\r?\n/u

/**
 * `  Caused by: <name>: <message>`, with the message's other lines indented below it, so a line
 * break in one, such as in a path inside Node's error, can't fake a line of its own
 */
function formatCause(cause: unknown): Array<string> {
  const message = getErrorMessage(cause)
  const name = readName(cause)
  const [first = '', ...rest] = (
    name === undefined || name === message ? message : `${name}: ${message}`
  ).split(LINE_BREAK_REGEX)
  return [`  Caused by: ${first}`, ...rest.map((line) => `    ${line}`)]
}

/**
 * The text a command-line tool writes for an error that ends its run, as `error: <message>\n`,
 * with its causes. Never throws. The message is `getErrorMessage`'s. Control characters are escaped
 * line by line, so an argument or path in a message can't rewrite the terminal
 */
export function formatCliError(
  error: unknown,
  { causes = true, stream }: FormatCliErrorOptions,
): string {
  const lines = [
    ...getErrorMessage(error).split(LINE_BREAK_REGEX),
    ...(causes ? getCauses(error) : []).flatMap((cause) => formatCause(cause)),
  ]
  const message = lines.map((line) => escapeControls(line, { keepBackslashes: true })).join('\n')
  return `${styleText('red', 'error', { stream })}: ${message}\n`
}
