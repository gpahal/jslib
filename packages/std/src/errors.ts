/**
 * Error helpers. Contract: the error getters and `toError` accept any thrown value and never throw,
 * reading inner errors 100 levels deep and 10 `cause`s, stopping at a cycle. `assertNever` and
 * `invariant` take any value and throw a `TypeError`. `describeValue` takes any value and never
 * throws. The other formatting helpers take trusted values from the developer's own code
 */

import { code, describeValue, truncate } from '@/internal/describe'
import { escapeControls } from '@/internal/escape'
import { isObject } from '@/objects'

export { describeValue } from '@/internal/describe'

/**
 * A base class for custom errors, whose non-enumerable `name` is the name of the class it's
 * constructed from, or `'Error'` for an anonymous class.
 *
 * Minifiers rename classes. To keep a subclass's name, set it on the prototype:
 * `Object.defineProperty(MyError.prototype, 'name', { value: 'MyError' })`
 */
export class CustomError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options)
    // An own property would hide a `name` that the subclass set on its prototype
    if (!Object.hasOwn(new.target.prototype, 'name')) {
      Object.defineProperty(this, 'name', {
        value: new.target.name === '' ? 'Error' : new.target.name,
        writable: true,
        enumerable: false,
        configurable: true,
      })
    }
  }
}

function isPrimitive(
  value: unknown,
): value is string | number | bigint | boolean | symbol | null | undefined {
  return value == null || (typeof value !== 'object' && typeof value !== 'function')
}

/**
 * Get a non-empty message from a thrown value. Never throws. It gives the `message` of an error or
 * an error-like object, or a primitive as a string. A `message` that isn't a primitive counts as
 * blank.
 *
 * The inner errors of an `AggregateError` or a `SuppressedError`, from any realm, add their
 * messages, joined with `; ` and cut to 10,000 characters. They follow a non-blank own message and
 * `: `, leaving out `'Unknown error'` and messages it already holds, or replace a blank one. Nesting
 * past 100 levels gives `…`, and one call reads at most 10,000 inner errors.
 *
 * Another blank message falls back to the first non-blank message in the `cause` chain, up to 10
 * causes, then a `name` other than `'Error'`, then `'Unknown error'`. The message is raw, so use
 * {@link getErrorReason} to embed it in a message or log
 *
 * @example
 * ```ts
 * import { getErrorMessage } from '@gpahal/std/errors'
 *
 * getErrorMessage(new AggregateError([new Error('a'), new Error('b')])) // 'a; b'
 * getErrorMessage(new AggregateError([new Error('a')], 'failed')) // 'failed: a'
 * getErrorMessage(new Error('', { cause: new Error('disk full') })) // 'disk full'
 * ```
 */
export function getErrorMessage(error: unknown): string {
  return getErrorMessageInternal(
    error,
    {
      beingRead: new Set(),
      messages: new Map(),
      cutMessages: new Map(),
      cuts: 0,
      cycleSkips: 0,
      reads: 0,
      searchBudget: MAX_HELD_SEARCH_LENGTH,
    },
    0,
  )
}

const MAX_AGGREGATED_MESSAGE_LENGTH = 10_000

/**
 * Recursing deeper could overflow the stack, which the catch-all in
 * {@link getErrorMessageInternal} would turn into `'Unknown error'`
 */
const MAX_AGGREGATE_DEPTH = 100

/**
 * A message read while a cycle was skipped isn't cached, so without this limit a graph whose errors
 * share a back-reference takes time exponential in its depth
 */
const MAX_INNER_ERROR_READS = 10_000

type AggregatesState = {
  /**
   * So an `AggregateError` that contains itself doesn't recurse forever
   */
  beingRead: Set<object>
  /**
   * Joined messages that neither the depth cap nor a cycle cut, reused at any depth, so nested
   * aggregates that share errors take linear time
   */
  messages: Map<object, string>
  /**
   * Joined messages that the depth cap cut, by depth. Reused only at that depth, since a shallower
   * read reaches more of the errors
   */
  cutMessages: Map<object, Map<number, string>>
  /**
   * Lets a read tell whether one inside it was cut
   */
  cuts: number
  /**
   * Reads skipped for a cycle. A message read with a skip isn't cached, since it depends on which
   * errors were being read
   */
  cycleSkips: number
  reads: number
  searchBudget: number
}

function getErrorMessageInternal(
  error: unknown,
  aggregates: AggregatesState,
  depth: number,
): string {
  // It usually runs in a `catch` block, where throwing would hide the original error
  try {
    const message = getMessage(error)
    if (message === undefined) {
      return 'Unknown error'
    }
    if (message.trim() !== '') {
      return withAggregatedMessage(message, error, aggregates, depth)
    }
    const aggregated = getAggregatedMessage(error, aggregates, depth)
    if (aggregated !== undefined) {
      return aggregated
    }
    const causeMessage = getCauseMessage(error, aggregates, depth)
    if (causeMessage !== undefined) {
      return causeMessage
    }
    const name: unknown = isObject(error) ? Reflect.get(error, 'name') : undefined
    return typeof name === 'string' && name !== 'Error' && name.trim() !== ''
      ? name
      : 'Unknown error'
  } catch {
    return 'Unknown error'
  }
}

const MAX_CAUSE_DEPTH = 10

/**
 * The first non-blank message in `error`'s `cause` chain, with a cause's inner errors read as for
 * the error itself. A nullish cause or a read that throws ends the chain
 */
function getCauseMessage(
  error: unknown,
  aggregates: AggregatesState,
  depth: number,
): string | undefined {
  const seen = new Set<unknown>([error])
  let current = error
  for (let causes = 0; causes < MAX_CAUSE_DEPTH && isObject(current); causes++) {
    let cause: unknown
    let message: string | undefined
    try {
      cause = Reflect.get(current, 'cause')
      if (cause == null || seen.has(cause)) {
        return undefined
      }
      seen.add(cause)
      message = getMessage(cause)
      message =
        message?.trim() === ''
          ? getAggregatedMessage(cause, aggregates, depth)
          : message === undefined
            ? undefined
            : withAggregatedMessage(message, cause, aggregates, depth)
    } catch {
      return undefined
    }
    if (message !== undefined && message.trim() !== '') {
      return message
    }
    current = cause
  }
  return undefined
}

/**
 * The ES2024 lib doesn't declare `SuppressedError`. Read on each use, so bundlers can drop it
 */
function getSuppressedErrorClass(): unknown {
  return Reflect.get(globalThis, 'SuppressedError')
}

/**
 * An own `errors` array, as an `AggregateError` has, or an own `error` and `suppressed`, as a
 * `SuppressedError` has. The `[object Error]` tag catches errors from other realms, and
 * `instanceof` catches a subclass with its own `Symbol.toStringTag`
 */
function getInnerErrors(value: unknown): Array<unknown> | undefined {
  if (!isObject(value)) {
    return undefined
  }
  const SuppressedErrorClass = getSuppressedErrorClass()
  const isErrorLike =
    value instanceof AggregateError ||
    (typeof SuppressedErrorClass === 'function' && value instanceof SuppressedErrorClass) ||
    Object.prototype.toString.call(value) === '[object Error]'
  if (!isErrorLike) {
    return undefined
  }
  if (Object.hasOwn(value, 'errors')) {
    const errors: unknown = Reflect.get(value, 'errors')
    if (Array.isArray(errors)) {
      return errors as Array<unknown>
    }
  }
  return Object.hasOwn(value, 'error') && Object.hasOwn(value, 'suppressed')
    ? [Reflect.get(value, 'error'), Reflect.get(value, 'suppressed')]
    : undefined
}

/**
 * `message`, `error`'s non-blank message, followed by `: ` and the messages of its inner errors
 * that `message` doesn't already hold
 */
function withAggregatedMessage(
  message: string,
  error: unknown,
  aggregates: AggregatesState,
  depth: number,
): string {
  const errors = getInnerErrors(error)
  if (errors === undefined || errors.length === 0) {
    return message
  }
  if (depth >= MAX_AGGREGATE_DEPTH) {
    // Counted as a cut, so an error containing this one isn't reused at a shallower depth
    aggregates.cuts++
    return `${message}: …`
  }
  const aggregated = getAggregatedMessage(error, aggregates, depth, message)
  return aggregated === undefined || aggregated === '' ? message : `${message}: ${aggregated}`
}

/**
 * The messages of an error's inner errors joined with `; `, or `undefined` for no inner errors or
 * a cycle. With `outerMessage`, it leaves out messages that it already holds and `'Unknown error'`,
 * so it can give `''`. The caches assume an error's message is the same on each read, which a
 * getter could break
 */
function getAggregatedMessage(
  error: unknown,
  aggregates: AggregatesState,
  depth: number,
  outerMessage?: string,
): string | undefined {
  const errors = getInnerErrors(error)
  if (errors === undefined || !isObject(error)) {
    return undefined
  }
  if (aggregates.beingRead.has(error)) {
    aggregates.cycleSkips++
    return undefined
  }
  const known = aggregates.messages.get(error)
  if (known !== undefined) {
    return known
  }
  const knownCut = aggregates.cutMessages.get(error)?.get(depth)
  if (knownCut !== undefined) {
    aggregates.cuts++
    return knownCut
  }
  if (errors.length === 0) {
    return undefined
  }
  if (depth >= MAX_AGGREGATE_DEPTH) {
    aggregates.cuts++
    return '…'
  }
  const cutsBefore = aggregates.cuts
  const cycleSkipsBefore = aggregates.cycleSkips
  aggregates.beingRead.add(error)
  try {
    let joined = ''
    let isFirst = true
    // Inner errors often share a message, as when one failure rejects every call
    const held = new Map<string, boolean>()
    for (const item of errors) {
      if (aggregates.reads >= MAX_INNER_ERROR_READS) {
        // Counted as a cut, so the message isn't reused as whole
        aggregates.cuts++
        joined += isFirst ? '…' : '; …'
        break
      }
      aggregates.reads++
      const itemMessage = getErrorMessageInternal(item, aggregates, depth + 1)
      if (outerMessage !== undefined && isHeldByMemo(held, outerMessage, itemMessage, aggregates)) {
        continue
      }
      joined += (isFirst ? '' : '; ') + itemMessage
      isFirst = false
      if (joined.length > MAX_AGGREGATED_MESSAGE_LENGTH) {
        joined = truncate(joined, MAX_AGGREGATED_MESSAGE_LENGTH)
        break
      }
    }
    if (aggregates.cycleSkips === cycleSkipsBefore) {
      if (aggregates.cuts === cutsBefore) {
        aggregates.messages.set(error, joined)
      } else {
        const byDepth = aggregates.cutMessages.get(error) ?? new Map<number, string>()
        byDepth.set(depth, joined)
        aggregates.cutMessages.set(error, byDepth)
      }
    }
    return joined
  } finally {
    aggregates.beingRead.delete(error)
  }
}

function isHeldByMemo(
  held: Map<string, boolean>,
  outerMessage: string,
  message: string,
  aggregates: AggregatesState,
): boolean {
  let isHeld = held.get(message)
  if (isHeld === undefined) {
    isHeld = isHeldBy(outerMessage, message, aggregates)
    held.set(message, isHeld)
  }
  return isHeld
}

/**
 * Whether an inner error's message adds nothing to its outer error's: `'Unknown error'`, or text
 * that `outerMessage` holds as whole words, with or without a lead such as `<package>: `
 */
function isHeldBy(outerMessage: string, message: string, aggregates: AggregatesState): boolean {
  if (message === 'Unknown error' || holdsWords(outerMessage, message, aggregates)) {
    return true
  }
  const tail = /^[^\s:]+: (.+)$/su.exec(message)?.[1]
  return tail !== undefined && holdsWords(outerMessage, tail, aggregates)
}

/**
 * Tested on whole code points, since a letter outside the Basic Multilingual Plane is two UTF-16
 * units, neither of them a letter
 */
const STARTS_WITH_WORD_CHAR_REGEX = /^[\p{L}\p{N}_]/u
const ENDS_WITH_WORD_CHAR_REGEX = /[\p{L}\p{N}_]$/u

/**
 * A search retries from each match whose ends touch other word characters, so it can take time
 * quadratic in the length
 */
const MAX_HELD_TEXT_LENGTH = 10_000

/**
 * The total {@link holdsWords} scans in one call of {@link getErrorMessage}. One search can scan
 * about a million characters, so without it each of 10,000 inner messages could
 */
const MAX_HELD_SEARCH_LENGTH = 1_000_000

/**
 * Whether `text` holds the non-empty `part` as whole words, so `failed` doesn't hold `a`. Too long
 * an input or an exhausted budget gives `false`
 */
function holdsWords(text: string, part: string, aggregates: AggregatesState): boolean {
  if (text.length > MAX_HELD_TEXT_LENGTH || part.length > MAX_HELD_TEXT_LENGTH) {
    return false
  }
  const startsWithWord = STARTS_WITH_WORD_CHAR_REGEX.test(part)
  const endsWithWord = ENDS_WITH_WORD_CHAR_REGEX.test(part.slice(-2))
  let from = 0
  while (aggregates.searchBudget > 0) {
    const index = text.indexOf(part, from)
    aggregates.searchBudget -= (index === -1 ? text.length : index + part.length) - from
    if (index === -1) {
      return false
    }
    from = index + 1
    const end = index + part.length
    if (
      (!startsWithWord ||
        !ENDS_WITH_WORD_CHAR_REGEX.test(text.slice(Math.max(0, index - 2), index))) &&
      (!endsWithWord || !STARTS_WITH_WORD_CHAR_REGEX.test(text.slice(end, end + 2)))
    ) {
      return true
    }
  }
  return false
}

/**
 * `''` for an object whose `message` is nullish or not a primitive, and `undefined` for a value
 * that is neither an object nor a primitive
 */
function getMessage(error: unknown): string | undefined {
  if (isObject(error)) {
    const message: unknown = Reflect.get(error, 'message')
    if (typeof message === 'string') {
      return message
    }
    return message != null && isPrimitive(message) ? String(message) : ''
  }
  return isPrimitive(error) ? String(error) : undefined
}

/**
 * Get the message of a thrown value, as {@link getErrorMessage} does, without a final period, to
 * follow a description such as `` reading `a.css` failed: `` in {@link formatMessage}. An ellipsis,
 * a lone period and an abbreviation such as `e.g.` keep their period. Control and format
 * characters and line breaks are escaped as `escapeControls` does, keeping backslashes, since
 * native messages such as `JSON.parse`'s can quote untrusted input. Never throws.
 *
 * @example
 * ```ts
 * import { getErrorReason } from '@gpahal/std/errors'
 *
 * getErrorReason(new Error('Cannot find module.')) // 'Cannot find module'
 * ```
 */
export function getErrorReason(error: unknown): string {
  const message = getErrorMessage(error)
  return escapeControls(
    message.length > 1 &&
      message.endsWith('.') &&
      !message.endsWith('..') &&
      !DOTTED_ABBREVIATION_REGEX.test(message)
      ? message.slice(0, -1)
      : message,
    // A Windows path in a message keeps its single backslashes
    { keepBackslashes: true },
  )
}

/**
 * An abbreviation of dotted single letters, such as `e.g.`, but not a number such as `22.1.`
 */
const DOTTED_ABBREVIATION_REGEX = /(?:^|[^\p{L}\p{N}.])(?:\p{L}\.){2,}$/u

/**
 * Get the string `code` of a thrown value, such as Node's `'ENOENT'`, or `undefined`. Never throws
 *
 * @example
 * ```ts
 * import { getErrorCode } from '@gpahal/std/errors'
 *
 * const error: unknown = Object.assign(new Error('missing'), { code: 'ENOENT' })
 * getErrorCode(error) // 'ENOENT'
 * ```
 */
export function getErrorCode(error: unknown): string | undefined {
  try {
    const code: unknown = isObject(error) ? Reflect.get(error, 'code') : undefined
    return typeof code === 'string' ? code : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether `value` is an error from any realm
 */
function isError(value: unknown): value is Error {
  if (value instanceof Error) {
    return true
  }
  // ES2026, newer than std's ES2024 lib
  const isErrorNative: unknown = Reflect.get(Error, 'isError')
  if (typeof isErrorNative === 'function') {
    return Reflect.apply(isErrorNative, Error, [value]) === true
  }
  return isObject(value) && Object.prototype.toString.call(value) === '[object Error]'
}

/**
 * Turn a thrown value into an `Error`. An error from any realm is returned as it is. Any other
 * value gives `new Error(getErrorMessage(value), { cause: value })`. Never throws
 *
 * @example
 * ```ts
 * import { toError } from '@gpahal/std/errors'
 *
 * const error = new TypeError('bad')
 * toError(error) === error // true
 * toError('failed').message // 'failed'
 * toError({ code: 1 }).cause // { code: 1 }
 * ```
 */
export function toError(value: unknown): Error {
  try {
    if (isError(value)) {
      return value
    }
  } catch {
    // A revoked proxy, or one whose traps throw, isn't an error
  }
  return new Error(getErrorMessage(value), { cause: value })
}

/**
 * Throw for a value that the types say can't exist, as in the `default` of an exhaustive `switch`.
 * A call with anything but `never` is a compile error, so a missed member is caught when it's
 * added. At runtime it throws a `TypeError` describing the value, or with `message` when given
 *
 * @example
 * ```ts
 * import { assertNever } from '@gpahal/std/errors'
 *
 * function area(shape: { kind: 'square'; side: number } | { kind: 'circle'; radius: number }) {
 *   switch (shape.kind) {
 *     case 'square':
 *       return shape.side ** 2
 *     case 'circle':
 *       return Math.PI * shape.radius ** 2
 *     default:
 *       return assertNever(shape)
 *   }
 * }
 * ```
 */
export function assertNever(value: never, message?: string): never {
  throw new TypeError(
    message ??
      formatMessage(
        '@gpahal/std',
        ['`assertNever`'],
        `expected no value, received ${describeValue(value)}`,
      ),
  )
}

/**
 * Throw a `TypeError` with `message` unless `condition` is truthy, narrowing `condition` for the
 * code after the call. The message is used as it is, so give it the repo's shape. A function
 * `message` is called only when the condition fails. A `message` that isn't a string or a function
 * returning one throws a `TypeError` about it instead
 *
 * @example
 * ```ts
 * import { invariant } from '@gpahal/std/errors'
 *
 * function getPort(ports: ReadonlyMap<string, number>, name: string): number {
 *   const port = ports.get(name)
 *   invariant(port !== undefined, () => `@scope/app: \`${name}\`: expected a known port`)
 *   return port
 * }
 *
 * getPort(new Map([['web', 80]]), 'web') // 80
 * ```
 */
export function invariant(condition: unknown, message: string | (() => string)): asserts condition {
  const untypedMessage: unknown = message
  if (typeof untypedMessage !== 'string' && typeof untypedMessage !== 'function') {
    throw new TypeError(
      formatMessage(
        '@gpahal/std',
        ['`invariant`', '`message`'],
        `expected a string or a function, received ${describeValue(untypedMessage)}`,
      ),
    )
  }
  const holds = Boolean(condition)
  if (holds) {
    return
  }
  const text: unknown = typeof message === 'function' ? message() : message
  if (typeof text !== 'string') {
    throw new TypeError(
      formatMessage(
        '@gpahal/std',
        ['`invariant`', '`message`'],
        `expected a function that returns a string, received a result of ${describeValue(text)}`,
      ),
    )
  }
  throw new TypeError(text)
}

export type FormatNamesOptions = {
  /**
   * The word between the last two names, such as `and` in `` `a`, `b` and `c` ``. Without it,
   * every name is joined with `, `
   */
  conjunction?: 'and' | 'or' | undefined
}

function checkString(caller: string, subject: string, value: unknown): void {
  if (typeof value !== 'string') {
    throw new TypeError(
      formatMessage(
        '@gpahal/std',
        [caller, code(subject)],
        `expected a string, received ${describeValue(value)}`,
      ),
    )
  }
}

function checkStrings(caller: string, subject: string, value: unknown): void {
  if (!Array.isArray(value)) {
    throw new TypeError(
      formatMessage(
        '@gpahal/std',
        [caller, code(subject)],
        `expected an array, received ${describeValue(value)}`,
      ),
    )
  }
  for (const [index, item] of (value as Array<unknown>).entries()) {
    checkString(caller, `${subject}[${index}]`, item)
  }
}

/**
 * Format names as a list for an error message, each in backticks: `` `a`, `b` ``, or with a
 * `conjunction`, `` `a`, `b` and `c` ``. Backticks in names are escaped. Arguments of the wrong type
 * throw a `TypeError`
 */
export function formatNames(
  names: ReadonlyArray<string>,
  options: FormatNamesOptions = {},
): string {
  // Not std's `checkOptions`, whose message helper imports this module
  const untypedOptions: unknown = options
  if (typeof untypedOptions !== 'object' || untypedOptions === null) {
    throw new TypeError(
      formatMessage(
        '@gpahal/std',
        ['`formatNames`', '`options`'],
        `expected an object, received ${describeValue(options)}`,
      ),
    )
  }
  checkStrings('`formatNames`', 'names', names)
  const { conjunction } = options
  const untypedConjunction: unknown = conjunction
  if (
    untypedConjunction !== undefined &&
    untypedConjunction !== 'and' &&
    untypedConjunction !== 'or'
  ) {
    throw new TypeError(
      formatMessage(
        '@gpahal/std',
        ['`formatNames`', '`options.conjunction`'],
        `expected \`"and"\`, \`"or"\` or \`undefined\`, received ${describeValue(untypedConjunction)}`,
      ),
    )
  }
  const quoted = names.map((name) => code(name))
  if (conjunction === undefined || quoted.length < 2) {
    return quoted.join(', ')
  }
  const last = quoted.pop() ?? ''
  return `${quoted.join(', ')} ${conjunction} ${last}`
}

/**
 * One problem that {@link formatMessageList} reports: its subjects, outer first, and what's wrong
 */
export type MessageItem = {
  subjects: ReadonlyArray<string>
  description: string
}

/**
 * An error message in the repo's shape, `<prefix>: <subject>: <description>`. `prefix` is the
 * package name. Subjects go outer first, each a backticked name or path or a short noun phrase. The
 * description starts lowercase and has no final period. A wrong value reads as
 * `expected <what>, received <describeValue(value)>`, and a hint follows as a sentence, as in
 * "expected an object, received `false`. Pass `typeAware: false`"
 *
 * @example
 * ```ts
 * import { describeValue, formatMessage } from '@gpahal/std/errors'
 *
 * formatMessage('@scope/config', ['options', '`quotes`'], `expected "single" or "double", received ${describeValue(1)}`) // '@scope/config: options: `quotes`: expected "single" or "double", received `1`'
 * ```
 */
export function formatMessage(
  prefix: string,
  subjects: ReadonlyArray<string>,
  description: string,
): string {
  return [prefix, ...subjects, description].join(': ')
}

function checkMessageListArguments(prefix: unknown, subjects: unknown, items: unknown): void {
  const caller = '`formatMessageList`'
  checkString(caller, 'prefix', prefix)
  checkStrings(caller, 'subjects', subjects)
  if (!Array.isArray(items)) {
    throw new TypeError(
      formatMessage(
        '@gpahal/std',
        [caller, '`items`'],
        `expected an array, received ${describeValue(items)}`,
      ),
    )
  }
  for (const [index, item] of (items as Array<unknown>).entries()) {
    if (typeof item !== 'object' || item === null) {
      throw new TypeError(
        formatMessage(
          '@gpahal/std',
          [caller, `\`items[${index}]\``],
          `expected an object, received ${describeValue(item)}`,
        ),
      )
    }
    checkStrings(caller, `items[${index}].subjects`, Reflect.get(item, 'subjects'))
    checkString(caller, `items[${index}].description`, Reflect.get(item, 'description'))
  }
}

/**
 * An error message for several problems. One problem gives a {@link formatMessage} of `subjects`
 * and its own subjects. Several give `<prefix>: <subject>: <n> issues` followed by an indented
 * `<subject>: <description>` line for each, with a multiline description's later lines indented
 * further. Empty `items` or arguments of the wrong type throw a `TypeError`
 */
export function formatMessageList(
  prefix: string,
  subjects: ReadonlyArray<string>,
  items: ReadonlyArray<MessageItem>,
): string {
  checkMessageListArguments(prefix, subjects, items)
  const [first] = items
  if (first === undefined) {
    throw new TypeError(
      formatMessage(
        '@gpahal/std',
        ['`formatMessageList`', '`items`'],
        'expected at least one item, received an empty array',
      ),
    )
  }
  if (items.length === 1) {
    return formatMessage(prefix, [...subjects, ...first.subjects], first.description)
  }
  const lines = items.map(
    (item) =>
      `  ${[...item.subjects, item.description].join(': ').replaceAll(/\r\n?|\n/g, '$&    ')}`,
  )
  return [formatMessage(prefix, subjects, `${items.length} issues`), ...lines].join('\n')
}
