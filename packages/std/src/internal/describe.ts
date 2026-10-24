/**
 * Describes values for error messages, for std's own modules. `describeValue` is public through
 * `@gpahal/std/errors`
 */

import { escapeControls } from '@/internal/escape'
import { lazy } from '@/internal/lazy'
import { hasPlainPrototype } from '@/internal/plain-prototype'
import { isObject } from '@/objects'

/**
 * The most characters of a string, a bigint's digits or a symbol's description that
 * {@link describeValue} keeps
 */
const MAX_DESCRIBED_LENGTH = 40

/**
 * Cut `text` to `maxLength` characters followed by `…`, without splitting a surrogate pair
 */
export function truncate(text: string, maxLength: number = MAX_DESCRIBED_LENGTH): string {
  if (text.length <= maxLength) {
    return text
  }
  const end = /[\uD800-\uDBFF]/.test(text.charAt(maxLength - 1)) ? maxLength - 1 : maxLength
  return `${text.slice(0, end)}…`
}

/**
 * Describe a value for an error message: `a function`, `an array`, `an object` for a plain object,
 * `` an object tagged `Arguments` `` for a plain object with another tag, `` an instance of `Map` ``
 * for another object, `an object that is not plain` for one whose prototype has no named
 * `constructor`, or the value in backticks, such as `` `"yes"` ``, `` `1n` `` or `` `-0` ``.
 * Strings are quoted as JSON and symbol descriptions escaped as JSON, so the result stays on one line, control and
 * format characters are escaped as `escapeControls` does, and long values are cut short with `…`.
 * A bigint of more than 10,000 bits is described by its size, such as `a 20000001-bit bigint`. It
 * never throws: an object it can't inspect, such as a revoked proxy, is `an object`
 */
export function describeValue(value: unknown): string {
  if (typeof value === 'function') {
    return 'a function'
  }
  if (isObject(value)) {
    // A proxy's traps can throw, as a revoked proxy's do, and describing a value never throws
    try {
      return describeObject(value)
    } catch {
      return 'an object'
    }
  }
  if (typeof value === 'string') {
    // JSON already escapes the backslashes, so escaping them again would double them
    return inBackticks(JSON.stringify(truncate(value)))
  }
  if (typeof value === 'symbol') {
    // Escaped as a string's contents, without its quotes, so a newline can't split the message
    const description = JSON.stringify(truncate(value.description ?? '')).slice(1, -1)
    return inBackticks(`Symbol(${description})`)
  }
  return typeof value === 'bigint' && isBigBigint(value)
    ? describeBigBigint(value)
    : code(describePrimitive(value))
}

function isBigBigint(value: bigint): boolean {
  const limit = getWrittenBigintLimit()
  return value >= limit || -value >= limit
}

/**
 * Can throw on a proxy
 */
function describeObject(value: object): string {
  if (Array.isArray(value)) {
    return 'an array'
  }
  if (!hasPlainPrototype(value)) {
    return describeInstance(value)
  }
  // As `isPlainObject` checks, so `arguments`, a module namespace or an object with a
  // `Symbol.toStringTag` isn't described as the plain object it isn't
  const tag = Object.prototype.toString.call(value).slice('[object '.length, -1)
  return tag === 'Object' ? 'an object' : `an object tagged ${code(truncate(tag))}`
}

/**
 * `text` in backticks, with the backslashes and backticks in it escaped. Backslashes go first, so a
 * name ending in `\` can't read as an escaped closing backtick
 */
export function code(text: string): string {
  return inBackticks(text.replaceAll('\\', '\\\\'))
}

/**
 * `text`, whose backslashes are already escaped, in backticks, with its backticks and control
 * characters escaped
 */
function inBackticks(text: string): string {
  return `\`${escapeControls(text, { keepBackslashes: true }).replaceAll('`', '\\`')}\``
}

/**
 * The most bits of a bigint whose digits {@link describeValue} writes. Writing a bigint in decimal
 * takes more than linear time, about 2 seconds for 20 million bits, so a bigger one is described by
 * its size
 */
const MAX_WRITTEN_BIGINT_BITS = 10_000

const getWrittenBigintLimit = lazy(() => 1n << BigInt(MAX_WRITTEN_BIGINT_BITS))

/**
 * Describe a bigint by its size in bits, which hexadecimal gives in linear time
 */
function describeBigBigint(value: bigint): string {
  const magnitude = value < 0n ? -value : value
  const hex = magnitude.toString(16)
  const bits = (hex.length - 1) * 4 + Number.parseInt(hex.charAt(0), 16).toString(2).length
  return `a ${value < 0n ? 'negative ' : ''}${bits}-bit bigint`
}

function describePrimitive(value: unknown): string {
  if (typeof value === 'bigint') {
    return `${truncate(String(value))}n`
  }
  return Object.is(value, -0) ? '-0' : String(value)
}

/**
 * Reads the constructor from the prototype's own data property, so no getter runs
 */
function describeInstance(value: object): string {
  const prototype: unknown = Object.getPrototypeOf(value)
  const constructor: unknown =
    prototype === null
      ? undefined
      : Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value
  const name: unknown = typeof constructor === 'function' ? constructor.name : undefined
  return typeof name === 'string' && name !== ''
    ? `an instance of ${code(truncate(name))}`
    : 'an object that is not plain'
}
