/**
 * The prototype check of `isPlainObject`, shared with `describeValue`, which describes an object by
 * its prototype alone
 */

import { lazy } from '@/internal/lazy'

/**
 * Whether `value`'s prototype is `Object.prototype` or `null`, in this realm or another, and
 * `value` isn't an `Object.prototype` itself
 */
export function hasPlainPrototype(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype === null) {
    // `Object.prototype` ends its own chain, but it's the prototype of plain objects, not one
    return value !== Object.prototype && !isForeignObjectPrototype(value)
  }
  return prototype === Object.prototype || isForeignObjectPrototype(prototype)
}

/**
 * The native source of `Object`, the same in every realm
 */
const getObjectConstructorSource = lazy(() => Function.prototype.toString.call(Object))

/**
 * Whether `prototype` is another realm's `Object.prototype`, matched by shape: the end of the chain,
 * with an own `constructor` whose source is the native `Object`'s and whose own `prototype` is
 * `prototype`. Reads descriptors, so no getter runs
 */
function isForeignObjectPrototype(prototype: unknown): boolean {
  if (
    prototype === null ||
    typeof prototype !== 'object' ||
    Object.getPrototypeOf(prototype) !== null
  ) {
    return false
  }
  const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value
  return (
    typeof constructor === 'function' &&
    Function.prototype.toString.call(constructor) === getObjectConstructorSource() &&
    Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value === prototype
  )
}
