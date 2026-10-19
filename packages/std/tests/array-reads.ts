/**
 * The reads of a {@link trackArrayReads} proxy: `ownKeys` lists its keys, `has` checks a key, as
 * `Object.hasOwn` does, and `get` reads a value
 */
export type ArrayReads = { ownKeys: number; has: number; get: number }

/**
 * A proxy of `list`, which `Array.isArray` accepts, and the counts of its reads, so a test can tell
 * a copy by index from one by own keys
 */
export function trackArrayReads<T>(list: Array<T>): { proxy: Array<T>; reads: ArrayReads } {
  const reads: ArrayReads = { ownKeys: 0, has: 0, get: 0 }
  const proxy = new Proxy(list, {
    ownKeys(target) {
      reads.ownKeys++
      return Reflect.ownKeys(target)
    },
    getOwnPropertyDescriptor(target, key) {
      reads.has++
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    get(target, key, receiver) {
      reads.get++
      return Reflect.get(target, key, receiver) as unknown
    },
  })
  return { proxy, reads }
}
