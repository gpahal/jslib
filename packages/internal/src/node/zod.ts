/**
 * Zod Mini schemas for plain data, and a check that throws a `TypeError` naming each issue in the
 * repo's error shape (see `formatMessage` in `@gpahal/std/errors`). Contract: trusted values from
 * the developer's own code. Types and unknown keys are checked, but hostile getters, proxies and
 * iterators aren't defended against
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import type * as z from 'zod/mini'

import { describeValue, formatMessage, formatMessageList, formatNames } from '@gpahal/std/errors'
import type { MessageItem } from '@gpahal/std/errors'
import { once } from '@gpahal/std/functions'
import { isPlainObject } from '@gpahal/std/objects'
import { escapeControls, shorten } from '@gpahal/std/strings'

import { joinList } from '@/lists'

/**
 * Zod Mini, loaded on the first call rather than on import, so a package whose import builds no
 * schema, such as a preset's default config, doesn't pay Zod's load time. Build schemas only inside
 * functions. `require` of Zod's ES module returns the instance that `import` gives, so its schemas
 * mix with those of modules that import Zod
 */
export const loadZod: () => typeof z = once(
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Zod Mini's namespace, which `import type` types
  () => createRequire(import.meta.url)(fileURLToPath(import.meta.resolve('zod/mini'))) as typeof z,
)

export type ExpectedOptions = {
  /**
   * What the value is expected to be, such as `an object`. Each schema has a default
   */
  expected?: string | undefined
  /**
   * A sentence after the error, such as how to fix it
   */
  hint?: string | undefined
}

/**
 * A Zod error map for a schema's own error: "expected `<expected>`, received `<value>`", then
 * `hint` as a sentence. In a union's `error`, it's the error when the value fits none of the
 * union's types
 */
export function expectedError(expected: string, hint?: string): z.core.$ZodErrorMap {
  return (issue) =>
    `expected ${expected}, received ${describeValue(issue.input)}${hint === undefined ? '' : `. ${hint}`}`
}

/**
 * Marks a {@link typeCheck} issue, which a union counts as a type mismatch. `z.refine` issues have
 * the same `custom` code and aren't marked
 */
const TYPE_CHECK_PARAM = 'gpahalTypeCheck'

/**
 * A value of type `T`, which `check` tells, with {@link expectedError}'s message. Use it rather
 * than `z.custom` for a check of the value's type, such as a function or a URL: in a union, its
 * failure counts as the branch rejecting the value's type, so the union gives its own error
 */
export function typeCheck<T>(
  check: (value: unknown) => boolean,
  { expected, hint }: ExpectedOptions & { expected: string },
): z.ZodMiniType<T, T> {
  const z = loadZod()
  return z.custom<T>(check, {
    error: expectedError(expected, hint),
    params: { [TYPE_CHECK_PARAM]: expected },
  })
}

/**
 * A plain object, as `isPlainObject` from `@gpahal/std/objects` has it. Its output is a shallow
 * copy of the object's own keys without a prototype, so a JSON `__proto__` key stays an own key,
 * and spreading the output can't replace a prototype
 */
export function plainObject({ expected = 'an object', hint }: ExpectedOptions = {}): z.ZodMiniType<
  Record<string, unknown>,
  Record<string, unknown>
> {
  const z = loadZod()
  return z.pipe(
    typeCheck<Record<string, unknown>>(isPlainObject, { expected, hint }),
    z.transform(withoutPrototype<Record<string, unknown>>),
  )
}

export type StrictObjectOptions = ExpectedOptions & {
  /**
   * What the error for an unknown key calls keys, such as `option`. Default is `key`
   */
  noun?: string | undefined
}

/**
 * A plain object with the keys of `shape` and no other. An unknown key fails, and so does an
 * enumerable symbol key, which Zod's own object schemas skip. Only own keys are read, and the output
 * is a copy of them without a prototype, so a key left out reads `undefined`, not an inherited
 * value
 */
export function strictObject<Shape extends z.core.$ZodShape>(
  shape: Shape,
  { noun = 'key', expected = 'an object', hint }: StrictObjectOptions = {},
): z.ZodMiniType<
  z.output<z.ZodMiniObject<Shape, z.core.$strict>>,
  z.input<z.ZodMiniObject<Shape, z.core.$strict>>
> {
  const z = loadZod()
  const names = Object.keys(shape)
  const known =
    names.length === 0 ? `It takes no ${noun}s` : `Known ${noun}s: ${formatNames(names)}`
  const unknown = `unknown ${noun}. ${known}`
  const object = z.strictObject(shape, {
    error: (issue) => (issue.code === 'unrecognized_keys' ? unknown : undefined),
  })
  // The plain object that `object` checks, typed as what `object` takes, so the pipe takes that.
  // `z.pipe` stops at any issue but `unrecognized_keys`, so the symbol keys use it, and the
  // object's own issues are reported with them
  const withoutSymbolKeys = typeCheck<z.input<typeof object>>(isPlainObject, {
    expected,
    hint,
  }).check(
    z.superRefine((value, context) => {
      const keys: Array<PropertyKey> = Object.getOwnPropertySymbols(value).filter((key) =>
        Object.prototype.propertyIsEnumerable.call(value, key),
      )
      if (keys.length > 0) {
        context.addIssue({
          code: 'unrecognized_keys',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Zod types the keys as strings, but it only passes them on, and `toMessageItems` formats symbols
          keys: keys as Array<string>,
          message: unknown,
          input: value,
        })
      }
    }),
  )
  // Zod reads each key with `input[key]`, which finds inherited values, such as a polluted
  // `Object.prototype.root` or the `constructor` function
  const ownKeys = z.transform(withoutPrototype<z.input<typeof object>>) as z.ZodMiniType<
    z.input<typeof object>,
    z.input<typeof object>
  >
  // Zod's output inherits from `Object.prototype`, so a key left out would read an inherited value
  const ownOutput = z.transform(withoutPrototype<z.output<typeof object>>) as z.ZodMiniType<
    z.output<typeof object>,
    z.output<typeof object>
  >
  return z.pipe(z.pipe(z.pipe(withoutSymbolKeys, ownKeys), object), ownOutput)
}

/**
 * A spread defines each key, so a `__proto__` key stays an own key rather than setting the
 * prototype
 */
function withoutPrototype<T extends object>(value: T): T {
  return { __proto__: null, ...value }
}

export function stringOrStrings(): z.ZodMiniType<string | Array<string>, string | Array<string>> {
  const z = loadZod()
  return z.union([z.string(), z.array(z.string())], {
    error: expectedError('a string or an array of strings'),
  })
}

export type AssertValidContext = {
  prefix: string
  /**
   * The first subject of each issue, such as `face 2`
   */
  subject?: string | undefined
  /**
   * The subject of an issue of the value itself, after `subject`, such as `options`. An issue of a
   * key has its path instead. Without `subject`, it heads a list of several issues
   */
  rootSubject?: string | undefined
  /**
   * Where the value is, such as `['overrides', 0]`. One issue's path continues it, as in
   * `overrides[0].files`; several issues are listed under it
   */
  path?: ReadonlyArray<PropertyKey> | undefined
}

/**
 * Check `value` against `schema`, for values that the types rule out but JavaScript callers can
 * still pass, and return what `schema` outputs. Read the output rather than `value`: each
 * {@link strictObject} and {@link plainObject} outputs a copy of its own keys without a prototype,
 * so an inherited value is never read as a key left out. Arrays are copied too, and other values,
 * such as functions, keep their identity. The schema's input and output types must match, so a
 * coercing schema, or one with a default, fails to compile.
 *
 * @example
 * ```ts
 * import * as z from 'zod/mini'
 * import { assertValid, strictObject } from '@gpahal/internal/node/zod'
 *
 * const schema = strictObject({ quotes: z.optional(z.enum(['single', 'double'])) }, { noun: 'option' })
 * const options: unknown = { quotes: 'single' }
 * const { quotes } = assertValid(schema, options, { prefix: '@scope/config' })
 * ```
 *
 * @throws TypeError if `value` fails `schema`, in the shape of `formatMessageList` from
 *   `@gpahal/std/errors`: `context.subject`, if any, then the backticked path of each issue, or
 *   `context.rootSubject` for an issue of the value itself, such as "@scope/config: `quotes`:
 *   expected `"single"` or `"double"`, received `1`". Each issue is listed once, and at most 20
 *   are. For a failed union, only the issues of the branches that took the value's type are
 *   reported, or the union's own error when none did. The `ZodError` is the `cause`.
 */
export function assertValid<T>(
  schema: z.ZodMiniType<T, NoInfer<T>>,
  value: unknown,
  context: AssertValidContext,
): T {
  const result = schema.safeParse(value, { error: ERROR_MAP })
  if (result.success) {
    return result.data
  }
  const { prefix, subject, rootSubject, path = [] } = context
  const subjects = subject === undefined ? [] : [subject]
  const items = toMessageItems(result.error.issues, []).map((item) =>
    rootSubject !== undefined && item.subjects.length === 0
      ? { ...item, subjects: [rootSubject] }
      : item,
  )
  const isSingle = uniqueIssues(items).length === 1
  if (path.length > 0) {
    if (isSingle) {
      return failWith(prefix, subjects, toMessageItems(result.error.issues, path), result.error)
    }
    subjects.push(inBackticks(formatPath(path)))
  } else if (!isSingle && rootSubject !== undefined && subjects.length === 0) {
    subjects.push(rootSubject)
  }
  return failWith(prefix, subjects, items, result.error)
}

function failWith(
  prefix: string,
  subjects: ReadonlyArray<string>,
  items: ReadonlyArray<IssueMessageItem>,
  cause: z.core.$ZodError,
): never {
  throw new TypeError(formatIssues(prefix, subjects, items), { cause })
}

/**
 * The most issues {@link assertValid} lists, so a wrong object of many keys stays readable
 */
const MAX_ISSUES = 20

type IssueMessageItem = MessageItem & {
  /**
   * The original keys, before the displayed path shortens them
   */
  path: ReadonlyArray<PropertyKey>
}

/**
 * `items` as `formatMessageList` gives them, each once, and at most {@link MAX_ISSUES} of them
 */
function formatIssues(
  prefix: string,
  subjects: ReadonlyArray<string>,
  items: ReadonlyArray<IssueMessageItem>,
): string {
  const unique = uniqueIssues(items)
  const message = formatMessageList(prefix, subjects, unique.slice(0, MAX_ISSUES))
  if (unique.length <= MAX_ISSUES) {
    return message
  }
  // Only the count line differs: `formatMessageList` counts the issues it lists
  const header = formatMessage(prefix, subjects, `${MAX_ISSUES} issues`)
  return `${formatMessage(prefix, subjects, `${unique.length} issues, the first ${MAX_ISSUES} shown`)}${message.slice(header.length)}`
}

/**
 * Each issue once, by its path and description
 */
function uniqueIssues(items: ReadonlyArray<IssueMessageItem>): Array<IssueMessageItem> {
  const symbols = new Map<symbol, number>()
  return new Map(
    items.map((item) => {
      const path = item.path.map((key) => {
        if (typeof key !== 'symbol') {
          return key
        }
        let token = symbols.get(key)
        if (token === undefined) {
          token = symbols.size
          symbols.set(key, token)
        }
        return { symbol: token }
      })
      return [JSON.stringify([path, item.description]), item] as const
    }),
  )
    .values()
    .toArray()
}

function codeName(text: string): string {
  return formatNames([text])
}

/**
 * Zod's English messages, for the issues {@link ERROR_MAP} doesn't word. `zod/mini` has none until
 * a locale is loaded, and loading one with `z.config` would change every other user of Zod
 */
const getEnglishErrorMap = once(() => loadZod().locales.en().localeError)

const TYPE_NAMES: Readonly<Record<string, string>> = {
  array: 'an array',
  boolean: 'a boolean',
  // A required key whose schema takes any value, such as `deferred()`, left out or `undefined`
  nonoptional: 'a value',
  number: 'a number',
  object: 'an object',
  string: 'a string',
}

function getTypeName(type: string): string {
  return (Object.hasOwn(TYPE_NAMES, type) ? TYPE_NAMES[type] : undefined) ?? codeName(type)
}

/**
 * Zod's issues in the repo's error shape, for the schemas without their own error. Other issues,
 * such as `invalid_format`, keep Zod's English message, lowercased, and a format issue names the
 * value, as in "invalid string: must match pattern /^a/, received `"b"`"
 */
const ERROR_MAP: z.core.$ZodErrorMap = (issue) => {
  if (issue.code === 'invalid_type' || issue.code === 'invalid_value') {
    return `expected ${joinList(getExpected(issue), 'or')}, received ${describeValue(issue.input)}`
  }
  if (issue.code === 'invalid_union') {
    return describeUnion(issue)
  }
  if (issue.code === 'unrecognized_keys') {
    // A record's enum keys; `toMessageItems` gives each key as the subject
    return 'unknown key'
  }
  const message = getEnglishErrorMap()(issue)
  const text = typeof message === 'string' ? message : (message?.message ?? 'invalid value')
  const received = issue.code === 'invalid_format' ? `, received ${describeValue(issue.input)}` : ''
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}${received}`
}

/**
 * What a type-mismatch issue (see {@link isTypeMismatch}) expected, as a list of alternatives
 */
function getExpected(issue: z.core.$ZodRawIssue | z.core.$ZodIssue): Array<string> {
  if (issue.code === 'invalid_type') {
    return [getTypeName(issue.expected)]
  }
  if (issue.code === 'invalid_value') {
    return issue.values.map((value) => describeValue(value))
  }
  if (issue.code === 'custom') {
    const expected: unknown = issue.params?.[TYPE_CHECK_PARAM]
    return typeof expected === 'string' ? [expected] : []
  }
  return issue.code === 'invalid_union'
    ? issue.errors.flatMap((branch) => branch.filter(isTypeMismatch).flatMap(getExpected))
    : []
}

/**
 * The message of a union without its own error: the types of its branches, when they all
 * rejected the value's type. {@link toMessageItems} reports the branches' own issues otherwise
 */
function describeUnion(issue: z.core.$ZodRawIssue<z.core.$ZodIssueInvalidUnion>): string {
  const received = describeValue(issue.input)
  const expected = [...new Set(getExpected(issue))]
  return `expected ${expected.length === 0 ? 'a valid value' : joinList(expected, 'or')}, received ${received}`
}

/**
 * Whether an issue of a union's branch shows that the branch rejected the value's type itself: a
 * Zod type or literal that didn't match, a failed {@link typeCheck}, or a nested union whose
 * branches all rejected it. A branch that took the type but failed a check reports its own reason
 */
function isTypeMismatch(issue: z.core.$ZodIssue): boolean {
  if (issue.path.length > 0) {
    return false
  }

  if (issue.code === 'invalid_type' || issue.code === 'invalid_value') {
    return true
  }
  return issue.code === 'custom'
    ? typeof issue.params?.[TYPE_CHECK_PARAM] === 'string'
    : issue.code === 'invalid_union' && issue.errors.every((branch) => branch.some(isTypeMismatch))
}

/**
 * A failed union gives the issues of the branches that took the value's type, or its own when none
 * did, and unknown keys give one item each
 */
function toMessageItems(
  issues: ReadonlyArray<z.core.$ZodIssue>,
  path: ReadonlyArray<PropertyKey>,
): Array<IssueMessageItem> {
  return issues.flatMap((issue): Array<IssueMessageItem> => {
    const issuePath = [...path, ...issue.path]
    // eslint-disable-next-line unicorn/prefer-switch -- A switch would have to list every other issue code to pass the exhaustiveness check
    if (issue.code === 'invalid_union') {
      const branches = issue.errors.filter((branch) => !branch.some(isTypeMismatch))
      if (branches.length > 0) {
        return branches.flatMap((branch) => toMessageItems(branch, issuePath))
      }
    } else if (issue.code === 'invalid_key' || issue.code === 'invalid_element') {
      return toMessageItems(issue.issues, issuePath)
    } else if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => toMessageItem([...issuePath, key], issue.message))
    }
    return [toMessageItem(issuePath, issue.message)]
  })
}

function toMessageItem(path: ReadonlyArray<PropertyKey>, description: string): IssueMessageItem {
  return { path, subjects: path.length === 0 ? [] : [inBackticks(formatPath(path))], description }
}

/**
 * The most characters of a key that a path shows, as many as `describeValue` shows of a string
 */
const MAX_KEY_LENGTH = 40

/**
 * A path as code writes it: `a.b[0]`, `a["b.c"]` or `a[Symbol(c)]`. Quoted keys and symbol
 * descriptions are escaped as JSON, so the path has no raw control characters
 */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>((text, key) => {
    if (typeof key === 'symbol') {
      const description = JSON.stringify(shorten(key.description ?? '', MAX_KEY_LENGTH))
      return `${text}[Symbol(${description.slice(1, -1)})]`
    }
    if (typeof key !== 'string') {
      return `${text}[${String(key)}]`
    }
    const shortKey = shorten(key, MAX_KEY_LENGTH)
    if (!IDENTIFIER.test(key)) {
      return `${text}[${JSON.stringify(shortKey)}]`
    }
    return text === '' ? shortKey : `${text}.${shortKey}`
  }, '')
}

/**
 * `text` in backticks, with its backticks and control characters escaped but not its backslashes,
 * which {@link formatPath} wrote as JSON escapes already. `formatNames` would double them, as std's
 * `describeValue` doesn't for the same reason
 */
function inBackticks(text: string): string {
  return `\`${escapeControls(text, { keepBackslashes: true }).replaceAll('`', '\\`')}\``
}

const IDENTIFIER = /^[$A-Z_a-z][\w$]*$/u
