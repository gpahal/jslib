/**
 * Looks up a value's entry in a record, by key rather than by pattern. Contract: trusted values from
 * the developer's own code, without hostile getters, proxies or iterators
 */

import { describeValue } from '@/internal/describe'
import { stdMessage } from '@/internal/message'

type MatchResult<V> = V extends (...args: Array<never>) => infer R ? R : V

/**
 * `A` is inferred from `args` only, since inferring it from the handlers would pick whichever comes
 * first when their arities differ. A class throws when called without `new`, so it can't be an
 * entry, but a callable constructor like `String` is a handler
 */
type MatchCheckedEntry<V, A extends Array<unknown>> = V extends (...args: Array<never>) => unknown
  ? (...args: A) => unknown
  : V extends abstract new (...args: Array<never>) => unknown
    ? never
    : V

/**
 * `L` with a `never` entry for each key that isn't a value of `T`, so an extra key doesn't
 * type-check even in a variable. A numeric key matches the string `T` it's written as
 */
type NoExtraKeys<L, T> = {
  [K in keyof L]: K extends T
    ? unknown
    : K extends number
      ? `${K}` extends T
        ? unknown
        : never
      : never
}

type MatchEntry<L extends Record<T, unknown>, T extends PropertyKey> = string extends T
  ? L[keyof L]
  : number extends T
    ? L[keyof L]
    : L[T]

/**
 * Look up `value` in `lookup`. A function found there is a handler, which `match` calls with `args`
 * and no `this`, returning its result. Anything else is returned as is. To get a function back, use
 * {@link matchValue}.
 *
 * The result type is the union of what each entry gives: `match(s, { a: 'x', b: () => 1 })` is
 * `string | number`. `args` types the handlers' untyped parameters, so
 * `match('a', { a: (x) => x + 1 }, 1)` type-checks. A class can't be an entry. `lookup` must have an
 * entry for each value of `value`'s type and no other key, so a union of literals is matched
 * exhaustively.
 *
 * @throws Error if `lookup` has no own key `value`, listing its first 20 keys
 */
export function match<
  T extends string | number,
  L extends Record<T, unknown>,
  A extends Array<unknown> = [],
>(
  value: T,
  // The last member only gives untyped handler parameters their contextual type. `{}` and the
  // nullish types stand in for other values without adding call signatures
  lookup: L & { [K in T]: MatchCheckedEntry<L[K], NoInfer<A>> } & NoInfer<NoExtraKeys<L, T>> &
    Record<
      T,
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Any value but `null` and `undefined`
      ((...args: NoInfer<A>) => unknown) | {} | null | undefined
    >,
  ...args: A
): string extends T
  ? MatchResult<L[keyof L]>
  : number extends T
    ? MatchResult<L[keyof L]>
    : { [K in T]: MatchResult<L[K]> }[T]
export function match(value: string | number, lookup: object, ...args: Array<unknown>): unknown {
  if (!Object.hasOwn(lookup, value)) {
    throwNoMatch('`match`', value, lookup, match)
  }

  const returnValue: unknown = Reflect.get(lookup, value)
  if (typeof returnValue !== 'function') {
    return returnValue
  }
  const result: unknown = Reflect.apply(returnValue, undefined, args)
  return result
}

/**
 * Look up `value` in `lookup` and return what's there, even a function. `lookup` must have an entry
 * for each value of `value`'s type and no other key, as for {@link match}.
 *
 * @throws Error if `lookup` has no own key `value`, listing its first 20 keys
 */
export function matchValue<T extends string | number, L extends Record<T, unknown>>(
  value: T,
  lookup: L & NoInfer<NoExtraKeys<L, T>>,
): MatchEntry<L, T>
export function matchValue(value: string | number, lookup: object): unknown {
  if (!Object.hasOwn(lookup, value)) {
    throwNoMatch('`matchValue`', value, lookup, matchValue)
  }
  const entry: unknown = Reflect.get(lookup, value)
  return entry
}

const MAX_LISTED_VALUES = 20

function describeValidValues(lookup: object): string {
  const keys = Object.keys(lookup)
  if (keys.length === 0) {
    return 'It has no values'
  }
  const listed = keys
    .slice(0, MAX_LISTED_VALUES)
    .map((key) => describeValue(key))
    .join(', ')
  const others = keys.length - MAX_LISTED_VALUES
  return `Known values: ${listed}${others > 0 ? ` and ${others} ${others === 1 ? 'other' : 'others'}` : ''}`
}

function throwNoMatch(
  name: string,
  value: string | number,
  lookup: object,
  caller: unknown,
): never {
  // As a key, so `2` reads `"2"` like the listed keys
  const error = new Error(
    stdMessage(
      [name],
      `expected a value with an entry in \`lookup\`, received ${describeValue(String(value))}. ${describeValidValues(lookup)}`,
    ),
  )
  // V8-only. Leaves `caller` and what it called out of the stack
  const captureStackTrace: unknown = Reflect.get(Error, 'captureStackTrace')
  if (typeof captureStackTrace === 'function') {
    Reflect.apply(captureStackTrace, Error, [error, caller])
  }
  throw error
}
