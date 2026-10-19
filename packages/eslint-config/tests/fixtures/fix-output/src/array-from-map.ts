/**
 * The values of `set`, adding each one's successor to it as it goes. `Array.from(set, fn)` would
 * map the values added too, so `[1, 2]` would give `[1, 2, 3, 4]`
 */
export function withSuccessors(set: Set<number>): Array<number> {
  return [...set].map((value) => {
    if (value < 3) {
      set.add(value + 2)
    }
    return value
  })
}

/**
 * The length of the array a value is mapped from, which `Array.from` doesn't pass
 */
function sizeOf(_value: number, _index: number, all: Array<number> = []): number {
  return all.length
}

/**
 * The size of `set` for each value, which `Array.from(set, sizeOf)` would make `0`
 */
export function sizes(set: Set<number>): Array<number> {
  return [...set].map(sizeOf)
}
