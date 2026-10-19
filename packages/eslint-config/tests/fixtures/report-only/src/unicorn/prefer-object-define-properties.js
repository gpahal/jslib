// Merged, `b`'s descriptor reads `object.a` before `a` is defined
export function define(object) {
  Object.defineProperty(object, 'a', { value: 1 })
  Object.defineProperty(object, 'b', { value: object.a + 1 })
  return object
}
