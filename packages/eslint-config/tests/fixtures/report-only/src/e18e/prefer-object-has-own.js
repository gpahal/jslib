// `Object.hasOwn` throws without an object, where the optional call gives `undefined`
export function hasKey(object) {
  return object?.hasOwnProperty('key') ?? false
}

// The fix writes `Object.hasOwn` of the parameter, which has no `hasOwn`
export function check(Object, value) {
  return value.hasOwnProperty('key')
}
