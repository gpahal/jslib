const cache = new Map()

export function forget(key) {
  if (cache.has(key)) {
    cache.delete(key)
  }
}
