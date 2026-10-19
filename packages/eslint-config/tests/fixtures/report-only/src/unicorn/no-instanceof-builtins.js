// An array from another realm isn't an `instanceof Array`, but `Array.isArray` is `true` for it
export function isLocalArray(value) {
  return value instanceof Array
}
