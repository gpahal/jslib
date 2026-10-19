/**
 * Whether `object` has its own `key`, `false` without an object. `Object.hasOwn(object, 'key')`
 * would throw on `undefined`
 */
export function hasKey(object: Record<string, unknown> | undefined): boolean {
  return object?.hasOwnProperty('key') ?? false
}

/**
 * Whether `object` has its own `key`, `false` without an object
 */
export function hasKeyByCall(object: Record<string, unknown> | undefined): boolean {
  return object?.hasOwnProperty?.('key') ?? false
}

/**
 * Whether `object` has its own `key`. The rule reports it without a fix, as it does every call
 */
export function hasOwnKey(object: Record<string, unknown>): boolean {
  return object.hasOwnProperty('key')
}
