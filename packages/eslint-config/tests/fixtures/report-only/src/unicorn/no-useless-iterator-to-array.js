// A collection's own `toArray()` copies it to an array, and `new Set` throws for the collection
// when it isn't iterable
export function unique(collection) {
  return new Set(collection.toArray())
}
