// `nextId++` runs only for a missing key once it's in a callback
export function idOf(ids, name, counter) {
  return ids.getOrInsert(name, counter.next++)
}
