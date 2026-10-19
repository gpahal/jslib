// `pairs` may hold strings such as `'ab'`, which the loop splits into a key and a value, and for
// which `new Map(pairs)` throws
export function index(pairs) {
  const map = new Map()
  for (const [key, value] of pairs) {
    map.set(key, value)
  }
  return map
}
