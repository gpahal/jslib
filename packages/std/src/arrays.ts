/**
 * Array predicates and helpers. Contract: trusted values from the developer's own code, without
 * hostile getters, proxies or iterators
 */

import { copyArrayItems, sliceArray } from '@/internal/array-index'
import { describeValue } from '@/internal/describe'
import { stdMessage } from '@/internal/message'
import { checkNumber } from '@/internal/options'

/**
 * What {@link isArray} narrows `T` to: each member of a union that an array could be. `any`,
 * `unknown`, `object` and `{}` become `Array<unknown>`. An object type an array can be, such as
 * `Iterable<number>`, is intersected with `Array<unknown>`, or `ReadonlyArray<unknown>` when `T` has
 * a readonly array member. A member no array can be, such as a function or `{ length: string }`, is
 * dropped
 */
export type ArrayOf<T> = unknown extends T
  ? Array<unknown>
  : ArrayMemberOf<T, [ReadonlyMembers<T>] extends [never] ? Array<unknown> : ReadonlyArray<unknown>>

type ReadonlyMembers<T> = Exclude<Extract<T, ReadonlyArray<unknown>>, Array<unknown>>

/**
 * `A` is the array type a non-array member is intersected with
 */
type ArrayMemberOf<T, A> =
  T extends ReadonlyArray<unknown>
    ? T
    : T extends object
      ? object extends T
        ? A
        : CanBeArray<T> extends true
          ? T & A
          : never
      : never

/**
 * Whether an array with extra keys can be `T`: `T` isn't callable, and each key it shares with
 * arrays, such as `length`, can hold the array's value
 */
type CanBeArray<T> = T extends
  ((...args: never) => unknown) | (abstract new (...args: never) => unknown)
  ? false
  : [
        {
          [K in keyof T & keyof Array<unknown>]: [T[K] & Array<unknown>[K]] extends [never]
            ? K
            : never
        }[keyof T & keyof Array<unknown>],
      ] extends [never]
    ? true
    : false

/**
 * `Array.isArray`, narrowing to `Array<unknown>` rather than `any[]`. A union narrows to its members
 * that can be arrays, so `ReadonlyArray<string> | string` narrows to `ReadonlyArray<string>`
 */
export function isArray<T>(value: T): value is Extract<ArrayOf<T>, T> {
  return Array.isArray(value)
}

/**
 * What {@link isArrayOf} narrows `T` to when its items are `I`s: {@link ArrayOf}, with each array
 * or tuple type's items intersected with `I`, keeping its shape and `readonly`. Other types are
 * intersected with an array of `I`s
 */
export type ArrayOfItems<T, I> = ArrayItemsOf<ArrayOf<T>, I>

/**
 * Mapping keeps the shape of an array or tuple type, but turns an intersection or a subclass into an
 * object type, so those get the intersection instead
 */
type ArrayItemsOf<A, I> = A extends unknown
  ? { [K in keyof A]: A[K] & I } extends infer Mapped
    ? Mapped extends ReadonlyArray<unknown>
      ? Mapped
      : A & (A extends Array<unknown> ? Array<I> : ReadonlyArray<I>)
    : never
  : never

/**
 * Check if a value is an array whose items all pass `isItem`. It narrows like {@link isArray}, and a
 * type guard as `isItem` narrows the items. A hole is checked as `undefined`
 *
 * @example
 * ```ts
 * import { isArrayOf } from '@gpahal/std/arrays'
 *
 * const value: unknown = ['a', 'b']
 * isArrayOf(value, (item) => typeof item === 'string') // value is Array<string>
 * ```
 */
export function isArrayOf<T, I>(
  value: T,
  isItem: (item: unknown) => item is I,
): value is Extract<ArrayOfItems<T, I>, T>
export function isArrayOf<T>(
  value: T,
  isItem: (item: unknown) => boolean,
): value is Extract<ArrayOf<T>, T>
export function isArrayOf(value: unknown, isItem: (item: unknown) => boolean): boolean {
  if (!Array.isArray(value)) {
    return false
  }
  // Not `every`, which skips holes
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- `for...of` calls the array's iterator, which an own `Symbol.iterator` replaces
  for (let i = 0; i < value.length; i++) {
    if (!isItem(value[i])) {
      return false
    }
  }
  return true
}

/**
 * An array with at least one item
 */
export type NonEmptyArray<T> = [T, ...Array<T>]

/**
 * A readonly array with at least one item
 */
export type ReadonlyNonEmptyArray<T> = readonly [T, ...Array<T>]

/**
 * Check if an array has at least one item, narrowing it so `array[0]` is `T` under
 * `noUncheckedIndexedAccess`. An array whose first item is a hole, such as `[, 'a']`, doesn't count
 */
export function isNonEmpty<T>(array: Array<T>): array is NonEmptyArray<T>
export function isNonEmpty<T>(array: ReadonlyArray<T>): array is ReadonlyNonEmptyArray<T>
export function isNonEmpty(array: ReadonlyArray<unknown>): boolean {
  return array.length > 0 && 0 in array
}

/**
 * A required `never` when an item type is an array, which makes the call a compile error, as the
 * runtime would take the array as the list
 */
type ToArrayItemCheck<T> = [Extract<T, ReadonlyArray<unknown>>] extends [never]
  ? []
  : [itemsCannotBeArrays: never]

type ToArrayItemOf<V> = 0 extends 1 & V ? unknown : V extends ReadonlyArray<infer I> ? I : V

/**
 * A copy of an array, or a single value in a new array. Unlike spread, the copy reads by index, so a
 * custom `Symbol.iterator` doesn't run, and keeps holes. An array is always the list of items, so an
 * item type that is an array, as in `toArray([['a']])`, is a compile error. A type argument is the
 * item type or, when that doesn't fit, the value's type. `number | ReadonlyArray<string>` gives
 * `Array<number | string>`
 *
 * @example
 * ```ts
 * import { toArray } from '@gpahal/std/arrays'
 *
 * toArray('a') // ['a']
 * toArray(['a', 'b']) // ['a', 'b']
 * ```
 */
export function toArray<T>(
  value: T | ReadonlyArray<T>,
  ...check: ToArrayItemCheck<T>
): Array<ToArrayItemOf<T>>
export function toArray<V>(
  value: V,
  ...check: ToArrayItemCheck<ToArrayItemOf<V>>
): Array<ToArrayItemOf<V>>
export function toArray(value: unknown): Array<unknown> {
  if (!isArray(value)) {
    return [value]
  }
  const sliced = sliceArray(value)
  if (sliced !== undefined) {
    return sliced
  }
  const copy: Array<unknown> = []
  copyArrayItems(value, copy, (item) => item)
  return copy
}

/**
 * The items without repeats, in order, keeping the first of equal items. Items compare as in a
 * `Set`, so `NaN` equals `NaN`, and `-0` equals `0` and comes back as `0`
 */
export function unique<T>(items: Iterable<T>): Array<T> {
  return [...new Set(items)]
}

/**
 * The items whose `key` no earlier item has, in order. Keys compare as in a `Set`
 *
 * @example
 * ```ts
 * import { uniqueBy } from '@gpahal/std/arrays'
 *
 * uniqueBy(['Inter', 'inter', 'Arial'], (font) => font.toLowerCase()) // ['Inter', 'Arial']
 * ```
 */
export function uniqueBy<T>(items: Iterable<T>, key: (item: T) => unknown): Array<T> {
  const seen = new Set<unknown>()
  const result: Array<T> = []
  for (const item of items) {
    const itemKey = key(item)
    if (seen.has(itemKey)) {
      continue
    }
    seen.add(itemKey)
    result.push(item)
  }
  return result
}

/**
 * The items in arrays of `size` items, the last one shorter when they don't divide evenly. A `size`
 * that isn't a number throws a `TypeError`, and one that isn't a positive integer a `RangeError`
 *
 * @example
 * ```ts
 * import { chunk } from '@gpahal/std/arrays'
 *
 * chunk(['a', 'b', 'c', 'd', 'e'], 2) // [['a', 'b'], ['c', 'd'], ['e']]
 * ```
 */
export function chunk<T>(items: Iterable<T>, size: number): Array<Array<T>> {
  checkNumber('`chunk`', '`size`', size)
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new RangeError(
      stdMessage(
        ['`chunk`', '`size`'],
        `expected a positive integer, received ${describeValue(size)}`,
      ),
    )
  }
  const chunks: Array<Array<T>> = []
  let current: Array<T> = []
  for (const item of items) {
    current.push(item)
    if (current.length < size) {
      continue
    }
    chunks.push(current)
    current = []
  }
  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}

/**
 * The items split in two, in order: those `predicate` accepts, then the rest. A type guard narrows
 * both arrays
 *
 * @example
 * ```ts
 * import { partition } from '@gpahal/std/arrays'
 *
 * partition([1, 2, 3, 4], (item) => item % 2 === 0) // [[2, 4], [1, 3]]
 * ```
 */
export function partition<T, S extends T>(
  items: Iterable<T>,
  predicate: (item: T, index: number) => item is S,
): [Array<S>, Array<Exclude<T, S>>]
export function partition<T>(
  items: Iterable<T>,
  predicate: (item: T, index: number) => boolean,
): [Array<T>, Array<T>]
export function partition<T>(
  items: Iterable<T>,
  predicate: (item: T, index: number) => boolean,
): [Array<T>, Array<T>] {
  const accepted: Array<T> = []
  const rejected: Array<T> = []
  let index = 0
  for (const item of items) {
    ;(predicate(item, index++) ? accepted : rejected).push(item)
  }
  return [accepted, rejected]
}
