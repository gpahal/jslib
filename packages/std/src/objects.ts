/**
 * Object predicates, copies and the types of copies. Contract: trusted values from the developer's
 * own code, without hostile getters or iterators. The predicates give `false` for a revoked proxy
 */

import { copyArrayItems, copyItemsInPlace, sliceArray } from '@/internal/array-index'
import { code, describeValue } from '@/internal/describe'
import { stdMessage } from '@/internal/message'
import { hasPlainPrototype } from '@/internal/plain-prototype'

/**
 * `T` with its intersections and mapped types expanded into one object type, so editors show its
 * members rather than how it was built
 */
export type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}

declare const nonFunctionBrand: unique symbol

/**
 * What {@link isObject} narrows to, standing in for "an object that isn't a function". It's narrower
 * than `object`, so a `false` result doesn't rule `object` out. Exported for declaration emit
 */
export type NonFunctionObject = object & { readonly [nonFunctionBrand]?: never }

declare const recordBrand: unique symbol

/**
 * What {@link isRecord} and {@link isPlainObject} intersect the members they keep with. It's
 * narrower than an object type, so a `false` result doesn't rule that type out, and a guard on that
 * type isn't flagged as an unnecessary condition. Exported for declaration emit
 */
export type RecordObject = object & { readonly [recordBrand]?: never }

/**
 * Check if a value is an object other than a function. Arrays count
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- `Function` is what removes every function type, whatever its signature
export function isObject<T>(value: T): value is Exclude<T, Function> & NonFunctionObject {
  return value != null && typeof value === 'object'
}

/**
 * What {@link isPlainObject} narrows `T` to: its members that can be plain objects, each intersected
 * with {@link RecordObject}, or a record of unknown values for `unknown`, `object` and `{}`. A
 * structural type an object literal can satisfy, such as `Error`, is kept
 */
export type PlainObjectOf<T> = unknown extends T
  ? Record<PropertyKey, unknown>
  : ToRecord<Exclude<Extract<T, object>, NonPlainMembers<Extract<T, object>>>>

/**
 * The members of `T` that no plain object can have the type of: callable and array types, class
 * instance types with private members, which the mapped copy of a type drops, and types with exactly
 * the keys of a {@link NominalObject}, such as `Map<string, number>`
 */
type NonPlainMembers<T> = T extends
  | ReadonlyArray<unknown>
  | ((...args: never) => unknown)
  | (abstract new (...args: never) => unknown)
  ? T
  : [HasNonPlainShape<T, NominalObject>] extends [never]
    ? { [K in keyof T]: T[K] } extends T
      ? never
      : T
    : T

type HasNonPlainShape<T, N> = N extends unknown
  ? [T, keyof T, keyof N] extends [N, keyof N, keyof T]
    ? true
    : never
  : never

/**
 * A keyless member, such as `object` or `{}`, becomes a record of unknown values so it can be
 * indexed
 */
type ToRecord<T> = T extends unknown
  ? [keyof T] extends [never]
    ? Record<PropertyKey, unknown>
    : T & RecordObject
  : never

/**
 * Check if a value is a plain object: its prototype is `Object.prototype` or `null`, in any realm,
 * and `Object.prototype.toString` gives `[object Object]`, as es-toolkit requires. So an
 * `arguments` object, a module namespace, an object with a `Symbol.toStringTag`,
 * `Object.prototype` itself and a revoked proxy don't count.
 *
 * It narrows a union to its members that can be plain objects, so `Options | Date | string`
 * narrows to `Options`. A `false` result keeps object types, since an interface can describe a
 * class instance too
 */
export function isPlainObject<T>(value: T): value is Extract<PlainObjectOf<T>, T> {
  if (value === null || typeof value !== 'object') {
    return false
  }

  try {
    return Object.prototype.toString.call(value) === '[object Object]' && hasPlainPrototype(value)
  } catch {
    return false
  }
}

/**
 * What {@link isRecord} narrows `T` to: its object members other than arrays and functions, as
 * {@link PlainObjectOf} maps them
 */
export type RecordOf<T> = unknown extends T
  ? Record<PropertyKey, unknown>
  : ToRecord<Exclude<Extract<T, object>, ReadonlyArray<unknown> | ((...args: never) => unknown)>>

/**
 * Check if a value is an object other than an array or a function, including a `Date`, a `Map` or
 * any class instance. Use {@link isPlainObject} for plain objects only. An `unknown` value narrows
 * to `Record<PropertyKey, unknown>`, and `Date | string` narrows to `Date`. A revoked proxy gives
 * `false`
 */
export function isRecord<T>(value: T): value is Extract<RecordOf<T>, T> {
  if (value == null || typeof value !== 'object') {
    return false
  }
  try {
    return !Array.isArray(value)
  } catch {
    return false
  }
}

/**
 * Common built-in object types that a plain object can't be. {@link PlainObjectOf} matches only a
 * type with exactly the keys of one, so the mutable `Map` and `Set` are listed next to their
 * read-only types. `Error` isn't listed: an object literal often stands in for one
 */
type NominalObject =
  | Date
  | RegExp
  | Promise<unknown>
  | Map<unknown, unknown>
  | ReadonlyMap<unknown, unknown>
  | Set<unknown>
  | ReadonlySet<unknown>
  | WeakMap<WeakKey, unknown>
  | WeakSet<WeakKey>
  | WeakRef<WeakKey>
  | ArrayBuffer
  | SharedArrayBuffer
  | ArrayBufferView
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array

/**
 * Objects that {@link omitUndefinedValues} rejects by their type. Any type assignable to one counts,
 * such as `{ name: string; message: string }`
 */
type NonPlainObject =
  | ReadonlyArray<unknown>
  | ((...args: never) => unknown)
  | (abstract new (...args: never) => unknown)
  | Error
  | NominalObject

/**
 * `object` when `T` can be a plain object, `never` when a member is a {@link NonPlainObject} or a
 * class instance with private members. A class with only public members passes here and throws at
 * run time
 */
type PlainObjectConstraint<T> = [Extract<T, NonPlainObject>] extends [never]
  ? { [K in keyof T]: T[K] } extends T
    ? object
    : never
  : never

/**
 * `T` without its `undefined` values: a key whose value can be `undefined` becomes optional, and
 * its value loses `undefined`. Each member of a union is mapped on its own
 */
export type OmitUndefinedValues<T> = T extends unknown
  ? Prettify<
      { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
        [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>
      }
    >
  : never

/**
 * The keys of every member of `T`, not only the shared ones
 */
type KeysOfUnion<T> = T extends unknown ? keyof T : never

/**
 * `Omit` for each member of a union, which `Omit` would merge
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * Copies `o`'s own enumerable properties, string and symbol keyed, without `keys` and without
 * `undefined` values
 */
function copyWithout(caller: string, o: unknown, keys: ReadonlyArray<PropertyKey>): object {
  if (!isPlainObject(o)) {
    throw new TypeError(
      stdMessage(
        [code(caller), '`o`'],
        `expected a plain object, received ${describeValue(o)}. A plain object's prototype is \`Object.prototype\` or \`null\`, and its tag is \`[object Object]\``,
      ),
    )
  }
  checkPickArguments(caller, o, keys)

  // Made with its prototype, as setting it later slows the object down. `__proto__: null` in a
  // literal is `Object.create(null)` without its `any` type
  const clone: Record<PropertyKey, unknown> =
    Object.getPrototypeOf(o) === null ? { __proto__: null } : {}
  // Own keys are strings and symbols, so a number key is compared as the string it names
  const omitted =
    keys.length === 0
      ? undefined
      : new Set(keys.map((key) => (typeof key === 'number' ? String(key) : key)))
  for (const key of getOwnEnumerableKeys(o)) {
    if (omitted?.has(key) === true) {
      continue
    }
    // Calls a getter, as spread does
    const value: unknown = Reflect.get(o, key)
    if (value !== undefined) {
      setValue(clone, key, value)
    }
  }
  return clone
}

/**
 * Return a shallow copy of a plain object without its `undefined` values. Symbol keys are included,
 * and a null-prototype object gives a null-prototype copy. Arrays, built-in objects and class
 * instances with private members are type errors.
 *
 * @throws TypeError if `o` isn't a plain object
 */
export function omitUndefinedValues<T extends PlainObjectConstraint<T>>(
  o: T,
): OmitUndefinedValues<T>
export function omitUndefinedValues(o: object): object {
  return copyWithout('omitUndefinedValues', o, [])
}

/**
 * {@link omitUndefinedValues}, also without `keys`. Each key must be a key of a member of `o`'s
 * type.
 *
 * @throws TypeError if `o` isn't a plain object or `keys` isn't an array
 */
export function omitUndefinedValuesAndKeys<
  T extends PlainObjectConstraint<T>,
  const K extends KeysOfUnion<T>,
>(o: T, keys: ReadonlyArray<K>): OmitUndefinedValues<DistributiveOmit<T, K>>
export function omitUndefinedValuesAndKeys(o: object, keys: ReadonlyArray<PropertyKey>): object {
  return copyWithout('omitUndefinedValuesAndKeys', o, keys)
}

/**
 * The type of {@link clonePlain}'s copy of a `T`:
 *
 * - An array or a tuple keeps its shape and `readonly`, with each item a `PlainClone`. An array with
 *   other keys, or an array subclass, becomes an array of its items' type.
 * - An object type that {@link isPlainObject} keeps maps each property through `PlainClone`,
 *   keeping `readonly` and optional modifiers.
 * - Every other type, such as functions, primitives, `Date` and `Map`, stays as it is.
 */
export type PlainClone<T> = 0 extends 1 & T
  ? T
  : T extends ReadonlyArray<unknown>
    ? PlainCloneOfArray<T>
    : T extends object
      ? [NonPlainMembers<T>] extends [never]
        ? { [K in keyof T]: PlainClone<T[K]> }
        : T
      : T

/**
 * Mapping keeps the shape of an array or tuple type, but turns an intersection or a subclass into an
 * object type, so those become an array of their items' type
 */
type PlainCloneOfArray<T extends ReadonlyArray<unknown>> = {
  [K in keyof T]: PlainClone<T[K]>
} extends infer Mapped
  ? Mapped extends ReadonlyArray<unknown>
    ? Mapped
    : T extends Array<unknown>
      ? Array<PlainClone<T[number]>>
      : ReadonlyArray<PlainClone<T[number]>>
  : never

/**
 * Deep-copy the arrays and plain objects in a value, such as a config's rule options, so changing
 * the copy can't change the original. Plain objects are those {@link isPlainObject} accepts. Every
 * other value, such as a function, a `RegExp` or a class instance, is kept as it is.
 *
 * A copied object keeps its own enumerable string and symbol keys and its null prototype. A copied
 * array keeps its length, holes and items, and drops keys that aren't indexes. A value that appears
 * twice, even in a cycle, is copied once. It copies without recursion, so any depth works
 *
 * @example
 * ```ts
 * import { clonePlain } from '@gpahal/std/objects'
 *
 * const rule = { ignore: ['a'] }
 * const copy = clonePlain(rule)
 * copy.ignore.push('b') // `rule` is unchanged
 * ```
 */
export function clonePlain<T>(value: T): PlainClone<T>
export function clonePlain(value: unknown): unknown {
  const copies = new Map<object, object>()
  // `isSliced` when `sliceArray` already made the target a shallow copy of the source
  const pending: Array<{
    source: object
    target: Record<PropertyKey, unknown> | Array<unknown>
    isSliced: boolean
  }> = []
  const copy = (source: unknown): unknown => {
    if (!Array.isArray(source) && !isPlainObject(source)) {
      return source
    }
    const existing = copies.get(source)
    if (existing !== undefined) {
      return existing
    }

    let target: Record<PropertyKey, unknown> | Array<unknown>
    let isSliced = false
    if (Array.isArray(source)) {
      const sliced = sliceArray(source)
      isSliced = sliced !== undefined
      target = sliced ?? []
    } else {
      target = Object.getPrototypeOf(source) === null ? { __proto__: null } : {}
    }
    copies.set(source, target)
    pending.push({ source, target, isSliced })
    return target
  }

  const result = copy(value)
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    const { source, target, isSliced } = entry
    if (Array.isArray(target)) {
      // Assigned rather than defined, which is many times slower, so an index setter on
      // `Array.prototype` would run. Trusted code doesn't add one
      if (isSliced) {
        copyItemsInPlace(target, copy)
      } else if (Array.isArray(source)) {
        copyArrayItems(source, target, copy)
      }
      continue
    }
    for (const key of getOwnEnumerableKeys(source)) {
      setValue(target, key, copy(Reflect.get(source, key)))
    }
  }
  return result
}

/**
 * The own enumerable keys of `o`, strings then symbols, as `Reflect.ownKeys` orders them.
 * `Object.keys` is many times faster than filtering `Reflect.ownKeys`
 */
function getOwnEnumerableKeys(o: object): Array<string | symbol> {
  const keys: Array<string | symbol> = Object.keys(o)
  for (const symbol of Object.getOwnPropertySymbols(o)) {
    if (Object.prototype.propertyIsEnumerable.call(o, symbol)) {
      keys.push(symbol)
    }
  }
  return keys
}

/**
 * Assigns, which is many times faster than defining, except for `__proto__`, which is defined so it
 * becomes an own property rather than calling the setter
 */
function setValue(target: Record<PropertyKey, unknown>, key: PropertyKey, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  } else {
    target[key] = value
  }
}

function checkPickArguments(caller: string, o: unknown, keys: unknown): void {
  if (typeof o !== 'object' || o === null) {
    throw new TypeError(
      stdMessage([code(caller), '`o`'], `expected an object, received ${describeValue(o)}`),
    )
  }
  if (!Array.isArray(keys)) {
    throw new TypeError(
      stdMessage([code(caller), '`keys`'], `expected an array, received ${describeValue(keys)}`),
    )
  }
}

/**
 * The keys of `T` other than index signatures, such as the `string` of `Record<string, number>`:
 * an empty object type satisfies a record of such a key and no other
 */
type KnownKeys<T> = keyof {
  // eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- The empty object type is the test: only a record of an index signature's key accepts it
  [P in keyof T as Record<never, never> extends Record<P, unknown> ? never : P]: T[P]
}

/**
 * `Pick<T, K>`, with keys that only an index signature names optional
 */
type Picked<T, K extends keyof T> = Prettify<
  Pick<T, Extract<K, KnownKeys<T>>> & Partial<Pick<T, Exclude<K, KnownKeys<T>>>>
>

/**
 * `unknown` for a type without type parameters, and deferred otherwise. Intersected with a
 * parameter's type, it limits an overload to non-generic code, where `Picked` and
 * `DistributiveOmit` don't stay deferred
 */
type Concrete<T> = [T] extends [never] ? never : unknown

/**
 * A new plain object with the own enumerable properties of `o` named in `keys`, string or symbol
 * keyed. An own `__proto__` key is copied as a property. An `o` that isn't an object or `keys` that
 * aren't an array throw a `TypeError`.
 *
 * The type has the members of `T` named in `keys`, optional where only an index signature names
 * them. The type can't tell own properties from inherited ones, so for a class instance it also
 * claims prototype methods and accessors, such as a `URL`'s `href`, which aren't copied
 *
 * @example
 * ```ts
 * import { pick } from '@gpahal/std/objects'
 *
 * pick({ a: 1, b: 2, c: 3 }, ['a', 'c']) // { a: 1, c: 3 }
 * ```
 */
export function pick<T extends object, K extends keyof T>(
  o: T & Concrete<T>,
  keys: ReadonlyArray<K>,
): Picked<T, K>
/**
 * {@link pick} for a generic `T`, typed `Pick<T, K>`
 */
export function pick<T extends object, K extends keyof T>(
  o: T,
  keys: ReadonlyArray<K>,
): Prettify<Pick<T, K>>
export function pick<T extends object, K extends keyof T>(
  o: T,
  keys: ReadonlyArray<K>,
): Picked<T, K> {
  checkPickArguments('pick', o, keys)
  const result: Record<PropertyKey, unknown> = {}
  for (const key of keys) {
    if (Object.prototype.propertyIsEnumerable.call(o, key)) {
      setValue(result, key, o[key])
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- It has each key of `K` that `o` has as its own enumerable property, which is what `Picked` describes
  return result as Picked<T, K>
}

/**
 * A new plain object with the own enumerable properties of `o`, string and symbol keyed, except
 * those named in `keys`. An own `__proto__` key is copied as a property. An `o` that isn't an
 * object or `keys` that aren't an array throw a `TypeError`.
 *
 * Each key must be a key of a member of `o`'s type, and a union keeps its members. As with
 * {@link pick}, the type also claims a class instance's prototype members, which aren't copied
 *
 * @example
 * ```ts
 * import { omit } from '@gpahal/std/objects'
 *
 * omit({ a: 1, b: 2, c: 3 }, ['b']) // { a: 1, c: 3 }
 * ```
 */
export function omit<T extends object, K extends KeysOfUnion<T>>(
  o: T & Concrete<T>,
  keys: ReadonlyArray<K>,
): Prettify<DistributiveOmit<T, K>>
/**
 * {@link omit} for a generic `T`, typed `Omit<T, K>`
 */
export function omit<T extends object, K extends keyof T>(
  o: T,
  keys: ReadonlyArray<K>,
): Prettify<Omit<T, K>>
export function omit<T extends object, K extends KeysOfUnion<T>>(
  o: T,
  keys: ReadonlyArray<K>,
): Prettify<DistributiveOmit<T, K>> {
  checkPickArguments('omit', o, keys)
  // Own keys are strings and symbols, so a number key is compared as the string it names
  const omitted = new Set<PropertyKey>(
    keys.map((key) => (typeof key === 'number' ? String(key) : key)),
  )
  const result: Record<PropertyKey, unknown> = {}
  for (const key of getOwnEnumerableKeys(o)) {
    if (!omitted.has(key)) {
      setValue(result, key, Reflect.get(o, key))
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- It has the own enumerable properties of `o` but `K`, which is what `DistributiveOmit` describes
  return result as Prettify<DistributiveOmit<T, K>>
}
