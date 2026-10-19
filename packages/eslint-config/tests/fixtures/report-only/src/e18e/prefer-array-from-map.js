// `Array.from(set, fn)` would map the values the mapper adds too, so `[1, 2]` would give
// `[1, 2, 3, 4]`
export function withSuccessors(set) {
  return [...set].map((value) => {
    if (value < 3) {
      set.add(value + 2)
    }
    return value
  })
}
