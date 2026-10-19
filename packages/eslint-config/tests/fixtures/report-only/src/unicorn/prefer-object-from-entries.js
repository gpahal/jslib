// `object[key] = value` with the key `__proto__` sets the prototype, and `Object.fromEntries` adds
// a property of that name
export function fromPairs(pairs) {
  const object = {}
  for (const [key, value] of pairs) {
    object[key] = value
  }
  return object
}
